import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'

export type MenuItem =
  | { kind: 'check'; label: string; checked: boolean; onSelect(): void }
  | { kind: 'action'; label: string; onSelect(): void }
  | { kind: 'label'; label: string }
  | { kind: 'separator' }

export interface MenuProps {
  /** The button that opens the menu; receives `aria-expanded`. */
  trigger: (props: { onClick(): void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode
  items: MenuItem[]
}

/** A small popover menu: opens from its trigger, closes on a choice, Escape or a click outside. */
export function Menu({ trigger, items }: MenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  const choose = (select: () => void) => {
    setOpen(false)
    select()
  }

  return (
    <div className="menu-anchor" ref={root}>
      {trigger({ onClick: () => setOpen((value) => !value), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <ul className="menu" role="menu">
          {items.map((item, index) => {
            if (item.kind === 'separator') return <li key={index} className="separator" role="separator" />
            if (item.kind === 'label')
              return (
                <li key={index} className="label" role="presentation">
                  {item.label}
                </li>
              )
            if (item.kind === 'check')
              return (
                // Toggles keep the menu open so several can be flipped in one visit; actions close it.
                <li key={index} role="menuitemcheckbox" aria-checked={item.checked} tabIndex={-1} onClick={item.onSelect}>
                  {item.checked ? <Check className="check" aria-hidden="true" /> : <span className="spacer" />}
                  {item.label}
                </li>
              )
            return (
              <li key={index} role="menuitem" tabIndex={-1} onClick={() => choose(item.onSelect)}>
                <span className="spacer" />
                {item.label}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
