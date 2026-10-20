import { useCallback, useEffect, useState } from 'react'
import { IPC } from '@shared/ipc'
import type { AppState, AppStatePatch } from '@shared/state'

export interface AppStateHandle {
  /** `null` until the first state arrives from the main process. */
  state: AppState | null
  patch(patch: AppStatePatch): Promise<void>
}

/** Mirrors the main-process state store in the renderer and forwards patches to it. */
export function useAppState(): AppStateHandle {
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    let cancelled = false
    window.ipc.invoke(IPC.getState, undefined).then((initial) => {
      if (!cancelled) setState(initial)
    })
    const unsubscribe = window.ipc.on(IPC.stateUpdated, (next) => setState(next))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const patch = useCallback(async (patch: AppStatePatch) => {
    const next = await window.ipc.invoke(IPC.patchState, patch)
    setState(next)
  }, [])

  return { state, patch }
}
