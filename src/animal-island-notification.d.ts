declare module 'animal-island-ui/es/components/Notification/Notification.js' {
  import type { CSSProperties, FC, ReactNode } from 'react'

  interface NotificationItem {
    key: string
    message: ReactNode
    description?: ReactNode
    duration?: number
    type: 'success' | 'info' | 'warning' | 'error'
    position: 'top' | 'topLeft' | 'topRight' | 'bottom' | 'bottomLeft' | 'bottomRight'
    placement: 'top' | 'bottom'
    createdAt: number
    icon?: ReactNode
    btn?: ReactNode
    onClose?: () => void
    onClick?: () => void
    closeIcon?: ReactNode
    className?: string
    style?: CSSProperties
  }

  export const NotificationView: FC<{
    item: NotificationItem
    onRemove: (key: string) => void
  }>
}
