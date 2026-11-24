import { useEffect, useState } from 'react'
import { applyPwaUpdate, hasPwaUpdate, subscribePwaUpdate } from '../pwa'
import { AppIcon } from './AppIcon'

export function PwaUpdatePrompt() {
  const [visible, setVisible] = useState(hasPwaUpdate)

  useEffect(() => subscribePwaUpdate(() => setVisible(true)), [])

  if (!visible) return null

  return (
    <div className="pwa-update-banner" role="status" aria-live="polite">
      <div className="pwa-update-copy">
        <span className="pwa-update-icon" aria-hidden="true">
          <AppIcon name="sync" size={16} />
        </span>
        <div className="pwa-update-text">
          <strong>网页已有新版本</strong>
          <span>刷新后即可使用，现有数据不会被清空。</span>
        </div>
      </div>
      <div className="pwa-update-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={applyPwaUpdate}>
          立即更新
        </button>
        <button type="button" className="btn btn-subtle btn-sm" onClick={() => setVisible(false)}>
          稍后
        </button>
      </div>
    </div>
  )
}
