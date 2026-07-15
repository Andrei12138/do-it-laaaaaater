import { useEffect, useState } from 'react'
import { NotificationView } from 'animal-island-ui/es/components/Notification/Notification.js'
import { AppIcon } from './AppIcon'

type NoticeType = 'success' | 'error'

interface NoticeDetail {
  id: number
  message: string
  type: NoticeType
}

const NOTICE_EVENT = 'do-it-laaaaaater:theme-notice'
let nextNoticeId = 0

export function showThemeNotification(type: NoticeType, message: string) {
  if (typeof document === 'undefined') return
  window.dispatchEvent(new CustomEvent<NoticeDetail>(NOTICE_EVENT, {
    detail: { id: ++nextNoticeId, message, type }
  }))
}

export function ThemeNotificationHost() {
  const [notice, setNotice] = useState<NoticeDetail | null>(null)

  useEffect(() => {
    function onNotice(event: Event) {
      setNotice((event as CustomEvent<NoticeDetail>).detail)
    }
    window.addEventListener(NOTICE_EVENT, onNotice)
    return () => window.removeEventListener(NOTICE_EVENT, onNotice)
  }, [])

  useEffect(() => {
    if (!notice || document.documentElement.dataset.theme === 'animal-island') return
    const timeout = window.setTimeout(() => setNotice((current) => current?.id === notice.id ? null : current),
      notice.type === 'success' ? 3_000 : 4_500)
    return () => window.clearTimeout(timeout)
  }, [notice])

  if (!notice) return null
  if (document.documentElement.dataset.theme === 'animal-island') {
    const key = `theme-notice-${notice.id}`
    return (
      <div className="animal-notification-host" role={notice.type === 'error' ? 'alert' : 'status'}>
        <NotificationView
          key={key}
          item={{
            key,
            message: notice.message,
            type: notice.type,
            position: 'bottom',
            placement: 'bottom',
            duration: notice.type === 'success' ? 3 : 4.5,
            createdAt: Date.now()
          }}
          onRemove={(removedKey) => setNotice((current) => current && `theme-notice-${current.id}` === removedKey ? null : current)}
        />
      </div>
    )
  }
  return (
    <div className={`flat-notification flat-notification-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      <AppIcon name={notice.type === 'error' ? 'warning' : 'complete'} size={22} />
      <span>{notice.message}</span>
      <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>
        <AppIcon name="close" size={17} />
      </button>
    </div>
  )
}
