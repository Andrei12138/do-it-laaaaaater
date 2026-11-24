import { useEffect, type ReactNode } from 'react'
import { AppIcon } from './AppIcon'

export function Modal({
  title,
  onClose,
  wide = false,
  children
}: {
  title: string
  onClose: () => void
  wide?: boolean
  children: ReactNode
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div className="fig-modal-backdrop" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose()
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={wide ? 'fig-modal fig-modal-wide' : 'fig-modal'}
      >
        <header className="fig-modal-header">
          <h2>{title}</h2>
          <button type="button" className="btn btn-icon" aria-label="关闭" onClick={onClose}>
            <AppIcon name="close" size={18} />
          </button>
        </header>
        <div className="fig-modal-body">{children}</div>
      </section>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="fig-empty">
      <div className="fig-empty-icon" aria-hidden="true">
        <AppIcon name="inbox" size={24} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="fig-empty-action">{action}</div>}
    </div>
  )
}
