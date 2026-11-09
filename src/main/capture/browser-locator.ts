import { spawn as nodeSpawn } from 'node:child_process'
import { childEnvironment } from '../llm/claude-code-protocol'
import type { Rect } from './page-crop'

/** The slice of a child process the locator uses, so tests can supply a fake. */
export interface LocatorChild {
  stdout: NodeJS.ReadableStream
  stdin: { write(text: string): unknown }
  on(event: 'close', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  kill(): unknown
}

export type LocatorSpawn = (command: string, args: string[]) => LocatorChild

export interface BrowserLocatorOptions {
  /** Absolute path to powershell.exe; see `powershellPathFor`. */
  command: string
  /** Our own process id: its windows (the overlay) are never "the window in front". */
  ownPid: number
  spawn?: LocatorSpawn
  timeoutMs?: number
}

/**
 * Runs inside a hidden Windows PowerShell for as long as the app is open. For each request line
 * `<id> <ownPid> <x> <y> <width> <height>` (physical pixels) it finds the front-most window on that
 * display that is not ours, not always-on-top (taskbar, call controls) and not a tool window. If that
 * window belongs to a web browser, UI Automation gives the page (Document) rectangle, and the answer
 * is its top edge: `{"id":<id>,"top":<pixels>}`, or `"top":null` for anything else.
 */
export const LOCATOR_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UndertoneWindows {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  public static void Init() {
    if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetThreadDpiAwarenessContext(new IntPtr(-4));
  }
  public static IntPtr Front(uint own, int x, int y, int w, int h, out uint owner) {
    IntPtr found = IntPtr.Zero; uint foundPid = 0;
    EnumWindows((win, p) => {
      if (!IsWindowVisible(win) || IsIconic(win)) return true;
      uint pid; GetWindowThreadProcessId(win, out pid);
      if (pid == own) return true;
      if ((GetWindowLong(win, -20) & 0x88) != 0) return true;
      int cloaked; if (DwmGetWindowAttribute(win, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      RECT r; if (!GetWindowRect(win, out r)) return true;
      if (Math.Min(r.R, x + w) <= Math.Max(r.L, x) || Math.Min(r.B, y + h) <= Math.Max(r.T, y)) return true;
      found = win; foundPid = pid; return false;
    }, IntPtr.Zero);
    owner = foundPid; return found;
  }
}
'@
[UndertoneWindows]::Init()
$browsers = @('chrome', 'msedge', 'brave', 'chromium', 'firefox', 'opera', 'vivaldi', 'arc', 'zen', 'librewolf', 'waterfox', 'thorium')
$document = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $f = $line.Trim() -split '\s+'
  if ($f.Count -ne 6) { continue }
  $top = 'null'
  try {
    $owner = [uint32]0
    $win = [UndertoneWindows]::Front([uint32]$f[1], [int]$f[2], [int]$f[3], [int]$f[4], [int]$f[5], [ref]$owner)
    if ($win -ne [IntPtr]::Zero -and $browsers -contains [System.Diagnostics.Process]::GetProcessById([int]$owner).ProcessName.ToLowerInvariant()) {
      $page = [System.Windows.Automation.AutomationElement]::FromHandle($win).FindFirst([System.Windows.Automation.TreeScope]::Descendants, $document)
      if ($page) {
        $r = $page.Current.BoundingRectangle
        if (-not $r.IsEmpty -and $r.Height -gt 0) { $top = [string][int][Math]::Round($r.Top) }
      }
    }
  } catch { $top = 'null' }
  [Console]::Out.WriteLine('{"id":' + [int]$f[0] + ',"top":' + $top + '}')
  [Console]::Out.Flush()
}
`

/** PowerShell's -EncodedCommand form: the script as base64 UTF-16LE, so no quoting can break it. */
export const encodeCommand = (script: string): string => Buffer.from(script, 'utf16le').toString('base64')

/** Windows PowerShell from the system folder, so a lookalike earlier on PATH is never run. */
export function powershellPathFor(env: Record<string, string | undefined>): string {
  return `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

const DEFAULT_TIMEOUT_MS = 700
/** An answer is a short JSON line; anything longer is not one. */
const MAX_LINE_CHARS = 10_000

const defaultSpawn: LocatorSpawn = (command, args) => {
  const child = nodeSpawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: childEnvironment(process.env) })
  child.stdin.on('error', () => undefined)
  return child
}

interface Pending {
  id: number
  resolve: (top: number | null) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Tells where the browser's page starts on a display, so screenshots can drop the tabs and address
 * bar. One helper process is kept alive (it takes about a second to load UI Automation) and asked
 * one question at a time; every failure, timeout or non-browser window answers null. The script calls
 * .NET directly rather than cmdlets, which can make PowerShell scan every installed module first.
 */
export class BrowserLocator {
  private child: LocatorChild | null = null
  private buffer = ''
  private nextId = 1
  private pending: Pending | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly options: BrowserLocatorOptions) {}

  /** Starts the helper ahead of the first screenshot. */
  start(): void {
    if (this.disposed || this.child) return
    const spawn = this.options.spawn ?? defaultSpawn
    let child: LocatorChild
    try {
      // No "-ExecutionPolicy Bypass": it does not apply to an encoded command, and next to one it reads as
      // malware to endpoint protection, which can hold the process indefinitely.
      child = spawn(this.options.command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(LOCATOR_SCRIPT)])
    } catch {
      return
    }
    this.child = child
    this.buffer = ''
    child.stdout.on('data', (chunk: Buffer | string) => this.receive(child, chunk.toString()))
    const gone = () => {
      if (this.child !== child) return
      this.child = null
      if (this.pending) this.settle(this.pending.id, null)
    }
    child.on('close', gone)
    child.on('error', gone)
  }

  /** The page's top edge, in the display's physical pixels, or null when no browser is in front. */
  pageTop(display: Rect): Promise<number | null> {
    const answer = this.queue.then(() => this.ask(display))
    this.queue = answer.catch(() => null)
    return answer
  }

  dispose(): void {
    this.disposed = true
    const child = this.child
    this.child = null
    if (this.pending) this.settle(this.pending.id, null)
    child?.kill()
  }

  private ask(display: Rect): Promise<number | null> {
    if (this.disposed) return Promise.resolve(null)
    this.start()
    const child = this.child
    if (!child) return Promise.resolve(null)
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(id, null), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      this.pending = { id, resolve, timer }
      const { x, y, width, height } = display
      try {
        child.stdin.write(`${id} ${this.options.ownPid} ${Math.round(x)} ${Math.round(y)} ${Math.round(width)} ${Math.round(height)}\n`)
      } catch {
        this.settle(id, null)
      }
    })
  }

  private receive(child: LocatorChild, text: string): void {
    if (this.child !== child) return
    this.buffer += text
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      this.answer(line)
      newline = this.buffer.indexOf('\n')
    }
    if (this.buffer.length > MAX_LINE_CHARS) this.buffer = ''
  }

  private answer(line: string): void {
    let payload: unknown
    try {
      payload = JSON.parse(line.trim())
    } catch {
      return
    }
    if (typeof payload !== 'object' || payload === null) return
    const { id, top } = payload as { id?: unknown; top?: unknown }
    if (typeof id !== 'number') return
    if (top === null) this.settle(id, null)
    else if (typeof top === 'number' && Number.isFinite(top)) this.settle(id, top)
  }

  private settle(id: number, top: number | null): void {
    const pending = this.pending
    if (!pending || pending.id !== id) return
    this.pending = null
    clearTimeout(pending.timer)
    pending.resolve(top)
  }
}
