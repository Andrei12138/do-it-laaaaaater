import { useState } from 'react'
import { Button } from 'animal-island-ui'
import islandBag from 'animal-island-ui/items/item-022.png'
import animalPreview from '../assets/animal-island/content_bg_pc.jpg'
import flatPreview from '../assets/themes/flat-2013-preview.png'
import gridPaperPreview from '../assets/themes/grid-paper-preview.png'
import { useTheme, type ThemeId } from '../theme'
import { AppIcon } from './AppIcon'
import { Modal } from './Modal'

export function ThemeControl({ placement = 'header' }: { placement?: 'header' | 'auth' }) {
  const [open, setOpen] = useState(false)
  const { theme, themes, setTheme } = useTheme()

  function choose(nextTheme: ThemeId) {
    setTheme(nextTheme)
  }

  return (
    <>
      <Button
        size={placement === 'auth' ? 'small' : 'middle'}
        className={`theme-trigger theme-trigger-${placement}`}
        icon={<AppIcon name="theme" size={placement === 'auth' ? 20 : 26} />}
        onClick={() => setOpen(true)}
      >
        设计风格
      </Button>
      {open && (
        <Modal title="选择设计风格" onClose={() => setOpen(false)} wide>
          <div className="theme-picker" role="radiogroup" aria-label="设计风格">
            {themes.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={theme === entry.id}
                className={`theme-option theme-option-${entry.id}${theme === entry.id ? ' is-selected' : ''}`}
                onClick={() => choose(entry.id)}
              >
                <span className="theme-preview" aria-hidden="true">
                  {entry.id === 'flat-2013' ? (
                    <img src={flatPreview} alt="" />
                  ) : entry.id === 'grid-paper' ? (
                    <img src={gridPaperPreview} alt="" />
                  ) : (
                    <span className="theme-preview-animal" style={{ backgroundImage: `url(${animalPreview})` }}>
                      <img src={islandBag} alt="" />
                    </span>
                  )}
                </span>
                <span className="theme-option-copy">
                  <strong>{entry.name}</strong>
                  <span>{entry.shortDescription}</span>
                  <small>{entry.credit} · {entry.license}</small>
                </span>
                {theme === entry.id && (
                  <span className="theme-selected-mark" aria-hidden="true">
                    <AppIcon name="complete" size={24} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="theme-picker-note">选择会立即生效，并仅保存在当前浏览器中。</p>
        </Modal>
      )}
    </>
  )
}
