import { describe, expect, it, vi } from 'vitest'
import { defaultState } from '@shared/state'
import { createStore } from './store'

describe('createStore', () => {
  it('starts from the given state', () => {
    const store = createStore({ ...defaultState(), showChat: true })
    expect(store.get().showChat).toBe(true)
  })

  it('defaults to the default state', () => {
    expect(createStore().get()).toEqual(defaultState())
  })

  it('applies validated patches and notifies subscribers with next and previous state', () => {
    const store = createStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const next = store.patch({ isInvisible: true })
    expect(next.isInvisible).toBe(true)
    expect(store.get()).toBe(next)
    expect(listener).toHaveBeenCalledWith(next, expect.objectContaining({ isInvisible: false }))
  })

  it('does not notify when a patch changes nothing', () => {
    const store = createStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.patch({ isInvisible: false })
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', () => {
    const store = createStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.patch({ isInvisible: true })
    expect(listener).not.toHaveBeenCalled()
  })

  it('rejects invalid patches without changing state', () => {
    const store = createStore()
    expect(() => store.patch({ screenUse: 'nope' } as never)).toThrow()
    expect(store.get().screenUse).toBe('required')
  })
})
