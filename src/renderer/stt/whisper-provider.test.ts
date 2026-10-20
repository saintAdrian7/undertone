import { describe, expect, it, vi } from 'vitest'
import { WhisperProvider, getSharedWhisperProvider, disposeSharedWhisperProvider, type AsrPipeline, type AsrPipelineFactory } from './whisper-provider'

const samples = new Float32Array(16000)

describe('shared WhisperProvider', () => {
  it('returns one instance per model and reloads only after dispose', async () => {
    const factory = vi.fn<AsrPipelineFactory>(async () => async () => ({ text: 'ok' }))
    const a = getSharedWhisperProvider({ model: 'm', pipelineFactory: factory })
    const b = getSharedWhisperProvider({ model: 'm', pipelineFactory: factory })
    expect(a).toBe(b)
    await a.preload()
    await b.preload()
    expect(factory).toHaveBeenCalledTimes(1)
    await disposeSharedWhisperProvider()
    const c = getSharedWhisperProvider({ model: 'm', pipelineFactory: factory })
    expect(c).not.toBe(a)
    await c.preload()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('creates a new instance when the model changes', async () => {
    await disposeSharedWhisperProvider()
    const a = getSharedWhisperProvider({ model: 'one', pipelineFactory: async () => async () => ({ text: '' }) })
    const b = getSharedWhisperProvider({ model: 'two', pipelineFactory: async () => async () => ({ text: '' }) })
    expect(a).not.toBe(b)
  })

  it('reports its load status', async () => {
    let resolve!: (p: AsrPipeline) => void
    const provider = new WhisperProvider({ model: 'm', pipelineFactory: () => new Promise((r) => (resolve = r)) })
    expect(provider.status()).toBe('idle')
    const loading = provider.preload()
    expect(provider.status()).toBe('loading')
    resolve(async () => ({ text: 'x' }))
    await loading
    expect(provider.status()).toBe('ready')
    await provider.dispose()
    expect(provider.status()).toBe('idle')
  })
})

describe('WhisperProvider', () => {
  it('loads the pipeline once and reuses it', async () => {
    const run: AsrPipeline = vi.fn(async () => ({ text: ' hello world ' }))
    const factory: AsrPipelineFactory = vi.fn(async () => run)
    const provider = new WhisperProvider({ model: 'onnx-community/whisper-base', pipelineFactory: factory })
    await provider.transcribe({ samples, sampleRate: 16000 })
    await provider.transcribe({ samples, sampleRate: 16000 })
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith('onnx-community/whisper-base')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('returns trimmed text', async () => {
    const provider = new WhisperProvider({ model: 'm', pipelineFactory: async () => async () => ({ text: '  Yes.  ' }) })
    expect(await provider.transcribe({ samples, sampleRate: 16000 })).toEqual({ text: 'Yes.' })
  })

  it('passes the language hint through when given', async () => {
    const run: AsrPipeline = vi.fn(async () => ({ text: 'ok' }))
    const provider = new WhisperProvider({ model: 'm', pipelineFactory: async () => run })
    await provider.transcribe({ samples, sampleRate: 16000, language: 'en' })
    expect(run).toHaveBeenCalledWith(samples, expect.objectContaining({ language: 'en' }))
  })

  it('rejects audio that is not 16 kHz', async () => {
    const provider = new WhisperProvider({ model: 'm', pipelineFactory: async () => async () => ({ text: 'x' }) })
    await expect(provider.transcribe({ samples, sampleRate: 48000 })).rejects.toThrow(/16000/)
  })

  it('surfaces a load failure once and allows a retry', async () => {
    const factory = vi
      .fn<AsrPipelineFactory>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(async () => ({ text: 'later' }))
    const provider = new WhisperProvider({ model: 'm', pipelineFactory: factory })
    await expect(provider.transcribe({ samples, sampleRate: 16000 })).rejects.toThrow('offline')
    expect(await provider.transcribe({ samples, sampleRate: 16000 })).toEqual({ text: 'later' })
  })
})
