import { useEffect, useState } from 'react'
import { Button, Notification } from 'animal-island-ui'
import { applyPwaUpdate, hasPwaUpdate, subscribePwaUpdate } from '../pwa'
import { useTheme } from '../theme'
import { AppIcon } from './AppIcon'

const UPDATE_NOTICE_KEY = 'do-it-laaaaaater-pwa-update'

export function PwaUpdatePrompt() {
  const { theme } = useTheme()
  const [visible, setVisible] = useState(hasPwaUpdate)

  useEffect(() => subscribePwaUpdate(() => setVisible(true)), [])

  useEffect(() => {
    if (!visible || theme !== 'animal-island') {
      Notification.destroy(UPDATE_NOTICE_KEY)
      return
    }
    Notification.info({
      key: UPDATE_NOTICE_KEY,
      message: '网页已有新版本',
      description: '刷新后即可使用，现有数据不会被清空。',
      duration: 0,
      position: 'bottomRight',
      btn: <Button size="small" type="primary" onClick={applyPwaUpdate}>立即更新</Button>,
      closeIcon: <span aria-label="稍后" onClick={() => setVisible(false)}>×</span>
    })
  }, [theme, visible])

  if (!visible || theme === 'animal-island') return null
  return (
    <div className="pwa-update" role="status">
      <AppIcon name="sync" size={20} />
      <span>网页已有新版本。刷新后即可使用，现有数据不会被清空。</span>
      <button type="button" className="flat-update-button flat-update-primary" onClick={applyPwaUpdate}>立即更新</button>
      <button type="button" className="flat-update-button" onClick={() => setVisible(false)}>稍后</button>
    </div>
  )
}
