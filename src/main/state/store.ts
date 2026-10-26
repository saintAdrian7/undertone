import { applyPatch, defaultState, type AppState, type AppStatePatch } from '@shared/state'

export type StoreListener = (next: AppState, prev: AppState) => void

export interface Store {
  get(): AppState
  /** Validates and applies a patch. Returns the resulting state; notifies only when something changed. */
  patch(patch: AppStatePatch): AppState
  subscribe(listener: StoreListener): () => void
}

const sameState = (a: AppState, b: AppState): boolean => JSON.stringify(a) === JSON.stringify(b)

export function createStore(initial: AppState = defaultState()): Store {
  let state = initial
  const listeners = new Set<StoreListener>()

  return {
    get: () => state,
    patch(patch) {
      const next = applyPatch(state, patch)
      if (sameState(next, state)) return state
      const prev = state
      state = next
      for (const listener of listeners) listener(next, prev)
      return next
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
