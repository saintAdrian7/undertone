// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptEntry } from '@shared/state'
import { applyTranscriptOp } from '@shared/transcript'

interface FakeVad {
  options: Record<string, unknown>
  start: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

const vad = vi.hoisted(() => ({ instances: [] as FakeVad[] }))
vi.mock('@ricky0123/vad-web', () => ({
  MicVAD: {
    new: vi.fn(async (options: Record<string, unknown>) => {
      const instance: FakeVad = { options, start: vi.fn(), destroy: vi.fn(async () => undefined) }
      vad.instances.push(instance)
      return instance
    }),
  },
}))

const whisper = vi.hoisted(() => {
  const listeners = new Set<(state: unknown) => void>()
  const provider = {
    state: { status: 'idle', progress: null } as { status: string; progress: unknown },
    preload: vi.fn(async () => undefined),
    status: () => provider.state.status,
    subscribe: vi.fn((listener: (state: unknown) => void) => {
      listeners.add(listener)
      listener(provider.state)
      return () => listeners.delete(listener)
    }),
    publish(state: { status: string; progress: unknown }) {
      provider.state = state
      for (const listener of listeners) listener(state)
    },
    listeners,
  }
  return { provider, getShared: vi.fn(() => provider) }
})
vi.mock('../stt/whisper-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stt/whisper-provider')>()),
  getSharedWhisperProvider: whisper.getShared,
}))

import { startListening, warmSpeechModel, type ListeningOptions } from './listening'

const fakeStream = () => {
  const track = { stop: vi.fn() }
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream }
}

function setup(transcribe = vi.fn(async () => ({ text: 'hello' })), mediaOverrides: Record<string, unknown> = {}) {
  const mic = fakeStream()
  const loopback = fakeStream()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => mic.stream),
      getDisplayMedia: vi.fn(async () => loopback.stream),
      ...mediaOverrides,
    },
  })
  let transcript: TranscriptEntry[] = []
  const options: ListeningOptions = {
    sessionStartedAt: 1_000,
    whisperModel: 'm',
    vadAssetsUrl: './vendor/vad/',
    ortWasmUrl: './vendor/ort/',
    onActivity: vi.fn(),
    onTranscriptOp: vi.fn((op) => {
      transcript = applyTranscriptOp(transcript, op)
    }),
    onError: vi.fn(),
    transcriptionProvider: { transcribe },
  }
  return { options, mic, loopback, transcribe, transcript: () => transcript }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const callbacks = (instance: FakeVad) =>
  instance.options as unknown as {
    onSpeechStart: () => void
    onSpeechEnd: (audio: Float32Array) => void
    onVADMisfire: () => void
  }

beforeEach(() => {
  vad.instances.length = 0
  whisper.provider.listeners.clear()
  whisper.provider.state = { status: 'idle', progress: null }
  whisper.provider.preload.mockClear()
  whisper.getShared.mockClear()
})

describe('warmSpeechModel', () => {
  it('preloads the shared model and forwards its status and download progress until unsubscribed', () => {
    const onModelStatus = vi.fn()
    const onModelProgress = vi.fn()
    const stop = warmSpeechModel({ whisperModel: 'm', ortWasmUrl: './vendor/ort/', transformersWasmUrl: './vendor/ort-transformers/', onModelStatus, onModelProgress })
    expect(whisper.getShared).toHaveBeenCalledWith({ model: 'm', wasmPaths: './vendor/ort-transformers/' })
    expect(whisper.provider.preload).toHaveBeenCalledTimes(1)
    whisper.provider.publish({ status: 'loading', progress: { loaded: 1, total: 4, percent: 25 } })
    expect(onModelStatus).toHaveBeenLastCalledWith('loading')
    expect(onModelProgress).toHaveBeenLastCalledWith({ loaded: 1, total: 4, percent: 25 })
    stop()
    whisper.provider.publish({ status: 'ready', progress: null })
    expect(onModelStatus).not.toHaveBeenCalledWith('ready')
  })

  it('reports a load failure as an error', async () => {
    whisper.provider.preload.mockRejectedValueOnce(new Error('offline'))
    const onError = vi.fn()
    warmSpeechModel({ whisperModel: 'm', ortWasmUrl: './vendor/ort/', onError })
    await flush()
    expect(onError).toHaveBeenCalledWith('Speech model failed to load: offline')
  })
})

describe('startListening with the shared speech model', () => {
  it('reports the model status and download progress to the session callbacks', async () => {
    const { options } = setup()
    delete options.transcriptionProvider
    const onModelStatus = vi.fn()
    const onModelProgress = vi.fn()
    const session = await startListening({ ...options, onModelStatus, onModelProgress })
    expect(whisper.provider.preload).toHaveBeenCalledTimes(1)
    whisper.provider.publish({ status: 'loading', progress: { loaded: 2, total: 4, percent: 50 } })
    expect(onModelStatus).toHaveBeenLastCalledWith('loading')
    expect(onModelProgress).toHaveBeenLastCalledWith({ loaded: 2, total: 4, percent: 50 })
    await session.stop()
    expect(whisper.provider.listeners.size).toBe(0)
  })
})

describe('startListening', () => {
  it('creates one VAD per speaker from the mic and loopback streams and starts both', async () => {
    const { options } = setup()
    await startListening(options)
    expect(vad.instances).toHaveLength(2)
    expect(vad.instances[0]?.options).toMatchObject({ model: 'v5', baseAssetPath: './vendor/vad/', onnxWASMBasePath: './vendor/ort/' })
    for (const instance of vad.instances) expect(instance.start).toHaveBeenCalledTimes(1)
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true }))
  })

  it('emits add then resolve operations around a transcription', async () => {
    const { options, transcript, transcribe } = setup()
    await startListening(options)
    const them = callbacks(vad.instances[1]!)
    them.onSpeechStart()
    expect(options.onActivity).toHaveBeenCalledWith('them', true)
    them.onSpeechEnd(new Float32Array(16000))
    expect(options.onTranscriptOp).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'add', role: 'them', sessionStartedAt: 1_000 }))
    expect(transcript()[0]).toMatchObject({ role: 'them', status: 'transcribing' })
    await flush()
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 16000 }))
    expect(transcript()[0]).toMatchObject({ status: 'done', text: 'hello' })
  })

  it('drops a microphone utterance that started while the far side was speaking', async () => {
    const { options, transcript, transcribe } = setup()
    await startListening(options)
    const me = callbacks(vad.instances[0]!)
    const them = callbacks(vad.instances[1]!)
    them.onSpeechStart()
    me.onSpeechStart()
    me.onSpeechEnd(new Float32Array(100))
    await flush()
    expect(transcribe).not.toHaveBeenCalled()
    expect(transcript()).toEqual([])
  })

  it('removes the placeholder when transcription returns nothing or fails', async () => {
    const transcribe = vi
      .fn<() => Promise<{ text: string }>>()
      .mockResolvedValueOnce({ text: '' })
      .mockRejectedValueOnce(new Error('model offline'))
    const { options, transcript } = setup(transcribe)
    await startListening(options)
    const them = callbacks(vad.instances[1]!)
    them.onSpeechStart()
    them.onSpeechEnd(new Float32Array(10))
    await flush()
    expect(transcript()).toEqual([])
    them.onSpeechStart()
    them.onSpeechEnd(new Float32Array(10))
    await flush()
    expect(transcript()).toEqual([])
    expect(options.onError).toHaveBeenCalledWith(expect.stringContaining('model offline'))
  })

  it('transcribes one segment at a time, in order, so passes never contend for the model', async () => {
    const gates: Array<(value: { text: string }) => void> = []
    const transcribe = vi.fn(() => new Promise<{ text: string }>((resolve) => gates.push(resolve)))
    const { options, transcript } = setup(transcribe)
    await startListening(options)
    const them = callbacks(vad.instances[1]!)
    them.onSpeechStart()
    them.onSpeechEnd(new Float32Array(10))
    them.onSpeechStart()
    them.onSpeechEnd(new Float32Array(10))
    await flush()
    expect(transcribe).toHaveBeenCalledTimes(1)
    gates[0]!({ text: 'first' })
    await flush()
    expect(transcribe).toHaveBeenCalledTimes(2)
    gates[1]!({ text: 'second' })
    await flush()
    expect(transcript().map((entry) => entry.text)).toEqual(['first', 'second'])
  })

  it('tells the user when transcription is falling behind, and clears the notice when it catches up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const gates: Array<(value: { text: string }) => void> = []
      const transcribe = vi.fn(() => new Promise<{ text: string }>((resolve) => gates.push(resolve)))
      const { options } = setup(transcribe)
      options.onNotice = vi.fn()
      await startListening(options)
      const them = callbacks(vad.instances[1]!)
      them.onSpeechStart()
      them.onSpeechEnd(new Float32Array(10))
      them.onSpeechStart()
      them.onSpeechEnd(new Float32Array(10))
      await flush()
      vi.advanceTimersByTime(31_000)
      gates[0]!({ text: 'first' })
      await flush()
      expect(options.onNotice).toHaveBeenCalledWith(expect.stringMatching(/falling behind/i))
      gates[1]!({ text: 'second' })
      await flush()
      them.onSpeechStart()
      them.onSpeechEnd(new Float32Array(10))
      await flush()
      gates[2]!({ text: 'third' })
      await flush()
      expect(options.onNotice).toHaveBeenLastCalledWith(null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears activity on a misfire', async () => {
    const { options } = setup()
    await startListening(options)
    const me = callbacks(vad.instances[0]!)
    me.onSpeechStart()
    me.onVADMisfire()
    expect(options.onActivity).toHaveBeenLastCalledWith('me', false)
  })

  it('destroys the VADs and stops the tracks on stop, and ignores late segments', async () => {
    const { options, mic, loopback } = setup()
    const session = await startListening(options)
    await session.stop()
    for (const instance of vad.instances) expect(instance.destroy).toHaveBeenCalledTimes(1)
    expect(mic.track.stop).toHaveBeenCalled()
    expect(loopback.track.stop).toHaveBeenCalled()
    const them = callbacks(vad.instances[1]!)
    them.onSpeechStart()
    them.onSpeechEnd(new Float32Array(10))
    expect(options.onTranscriptOp).not.toHaveBeenCalled()
  })

  it('releases the microphone when loopback capture fails', async () => {
    const { options, mic } = setup(undefined, {
      getDisplayMedia: vi.fn(async () => {
        throw new Error('no loopback')
      }),
    })
    await expect(startListening(options)).rejects.toThrow('no loopback')
    expect(mic.track.stop).toHaveBeenCalled()
  })
})
