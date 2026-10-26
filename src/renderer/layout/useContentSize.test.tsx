// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContentSize } from './useContentSize'

type Callback = (entries: Array<{ target: Element; borderBoxSize?: Array<{ inlineSize: number; blockSize: number }> }>) => void
const observers: Array<{ callback: Callback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []

beforeEach(() => {
  observers.length = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(callback: Callback) {
        observers.push({ callback, observe: this.observe, disconnect: this.disconnect })
      }
    },
  )
})

afterEach(() => vi.unstubAllGlobals())

function Probe({ onSize }: { onSize: (size: { width: number; height: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useContentSize(ref, onSize)
  return <div ref={ref}>content</div>
}

describe('useContentSize', () => {
  it('observes the element and reports rounded-up border box sizes', () => {
    const onSize = vi.fn()
    const { container } = render(<Probe onSize={onSize} />)
    expect(observers).toHaveLength(1)
    expect(observers[0]?.observe).toHaveBeenCalledWith(container.firstChild)
    act(() => observers[0]?.callback([{ target: container.firstChild as Element, borderBoxSize: [{ inlineSize: 410.2, blockSize: 139.6 }] }]))
    expect(onSize).toHaveBeenCalledWith({ width: 411, height: 140 })
  })

  it('does not report unchanged sizes twice', () => {
    const onSize = vi.fn()
    const { container } = render(<Probe onSize={onSize} />)
    const entry = { target: container.firstChild as Element, borderBoxSize: [{ inlineSize: 300, blockSize: 100 }] }
    act(() => observers[0]?.callback([entry]))
    act(() => observers[0]?.callback([entry]))
    expect(onSize).toHaveBeenCalledTimes(1)
  })

  it('disconnects on unmount', () => {
    const { unmount } = render(<Probe onSize={vi.fn()} />)
    unmount()
    expect(observers[0]?.disconnect).toHaveBeenCalled()
  })
})
