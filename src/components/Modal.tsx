import { type ReactNode } from 'react'
import { Button, Card, Modal as AnimalModal } from 'animal-island-ui'
import { AppIcon } from './AppIcon'

interface ModalProps {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}

export function Modal({ title, children, onClose, wide = false }: ModalProps) {
  return (
    <AnimalModal
      open
      title={(
        <div className="app-modal-title-content">
          <span>{title}</span>
          <Button type="text" size="small" className="app-modal-close" onClick={onClose} aria-label="关闭">
            <AppIcon name="close" size={22} />
          </Button>
        </div>
      )}
      width={wide ? 'min(880px, calc(100vw - 32px))' : 'min(580px, calc(100vw - 32px))'}
      footer={null}
      typewriter={false}
      onClose={onClose}
      className={wide ? 'app-modal app-modal-wide' : 'app-modal'}
    >
      <div className="modal-body">{children}</div>
    </AnimalModal>
  )
}

export function ErrorNotice({ message }: { message: string }) {
  return message ? <div className="notice notice-error" role="alert">{message}</div> : null
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <Card className="empty-state" type="dashed" pattern="default">{children}</Card>
}
