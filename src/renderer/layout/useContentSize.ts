import { useEffect, useRef, type RefObject } from 'react'

export interface ContentSize {
  width: number
  height: number
}

/** Reports an element's border-box size whenever it changes, rounded up to whole pixels. */
export function useContentSize(ref: RefObject<HTMLElement | null>, onSize: (size: ContentSize) => void): void {
  const latest = useRef(onSize)
  latest.current = onSize
  const last = useRef<ContentSize | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const box = entry.borderBoxSize?.[0]
        const measured = box ? { width: box.inlineSize, height: box.blockSize } : entry.target.getBoundingClientRect()
        const size = { width: Math.ceil(measured.width), height: Math.ceil(measured.height) }
        if (last.current?.width === size.width && last.current.height === size.height) continue
        last.current = size
        latest.current(size)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
}
