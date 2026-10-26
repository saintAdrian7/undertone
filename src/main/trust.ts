export interface TrustOptions {
  /** The Vite dev server URL in development; undefined in a packaged app. */
  devRendererUrl: string | undefined
  /** `file://` URL of the packaged renderer's index.html. */
  rendererIndexHref: string
}

/**
 * Only our own renderer may use IPC, media permissions or loopback capture. Development compares the
 * exact origin; production compares the exact file path, so a lookalike URL never matches.
 */
export function createTrustedUrlCheck({ devRendererUrl, rendererIndexHref }: TrustOptions): (url: string | undefined) => boolean {
  const devOrigin = devRendererUrl ? new URL(devRendererUrl).origin : null
  const indexPath = new URL(rendererIndexHref).pathname
  return (url) => {
    if (!url) return false
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (devOrigin) return parsed.origin === devOrigin
    return parsed.protocol === 'file:' && parsed.pathname === indexPath
  }
}
