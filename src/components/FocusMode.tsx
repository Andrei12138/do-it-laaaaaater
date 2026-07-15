import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Select, Tag, Title } from 'animal-island-ui'
import { chinaToday, plannedState, smartPriority } from '../china-date'
import { itemAgeLabel } from '../item-age'
import { useTheme } from '../theme'
import type { BulkItemChanges, Category, ImageAsset, LibraryItem } from '../types'
import { AppIcon } from './AppIcon'

function manualAssets(item: LibraryItem) {
  return item.assets.filter((asset) => asset.role !== 'web_cover')
}

function focusOrder(items: LibraryItem[]) {
  const today = chinaToday()
  return [...items].sort((left, right) => {
    const priority = smartPriority(left, today) - smartPriority(right, today)
    if (priority) return priority
    return left.createdAt - right.createdAt
  })
}

export function FocusMode({
  items,
  categories,
  now,
  onClose,
  onPatch,
  onEdit,
  onDelete,
  onPreview
}: {
  items: LibraryItem[]
  categories: Category[]
  now: number
  onClose: () => void
  onPatch: (item: LibraryItem, changes: BulkItemChanges, label: string) => Promise<boolean>
  onEdit: (item: LibraryItem) => void
  onDelete: (item: LibraryItem) => Promise<boolean>
  onPreview: (assets: ImageAsset[], index: number) => void
}) {
  const { theme } = useTheme()
  const ordered = useMemo(() => focusOrder(items), [items])
  const [activeId, setActiveId] = useState(() => ordered[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const activeIndex = Math.max(0, ordered.findIndex((item) => item.id === activeId))
  const item = ordered[activeIndex] || ordered[0]

  useEffect(() => {
    if (!ordered.length) {
      setActiveId('')
      return
    }
    if (!ordered.some((entry) => entry.id === activeId)) {
      setActiveId(ordered[Math.min(activeIndex, ordered.length - 1)].id)
    }
  }, [activeId, activeIndex, ordered])

  function move(direction: -1 | 1) {
    if (!ordered.length) return
    const next = (activeIndex + direction + ordered.length) % ordered.length
    setActiveId(ordered[next].id)
  }

  function openItem() {
    if (item?.kind === 'link' && item.url) window.open(item.url, '_blank', 'noopener,noreferrer')
    else if (item?.kind === 'image_group') {
      const assets = manualAssets(item)
      if (assets.length) onPreview(assets, 0)
    }
  }

  async function patch(changes: BulkItemChanges, label: string, advance = false) {
    if (!item || busy) return
    const nextId = ordered[(activeIndex + 1) % Math.max(1, ordered.length)]?.id || ''
    setBusy(true)
    try {
      const success = await onPatch(item, changes, label)
      if (success && advance && ordered.length > 1) setActiveId(nextId)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    function interactive(target: EventTarget | null) {
      return Boolean((target as HTMLElement | null)?.closest('input,textarea,select,[contenteditable="true"]'))
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (interactive(event.target) || !item) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        move(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        move(1)
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        openItem()
      } else if (event.key === ' ') {
        event.preventDefault()
        void patch({ status: item.status === 'pending' ? 'completed' : 'pending' }, item.status === 'pending' ? '已完成' : '已恢复', item.status === 'pending')
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void patch({ isStarred: !item.isStarred }, item.isStarred ? '已取消星标' : '已加星标')
      } else if (event.key.toLowerCase() === 't' && item.status === 'pending') {
        event.preventDefault()
        void patch({ plannedFor: item.plannedFor ? null : chinaToday() }, item.plannedFor ? '已移出今日清单' : '已加入今日清单')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  if (!item) {
    return (
      <div className="focus-mode" role="dialog" aria-modal="true" aria-label="晚间处理模式">
        <Card className="focus-empty" pattern="default">
          <Title size="middle" color="app-teal">当前筛选下已经处理完了</Title>
          <p>可以退出处理模式，换一组筛选条件继续。</p>
          <Button type="primary" onClick={onClose}>返回首页</Button>
        </Card>
      </div>
    )
  }

  const manual = manualAssets(item)
  const cover = item.kind === 'link'
    ? item.assets.find((asset) => asset.role === 'web_cover') || manual[0]
    : item.kind === 'image_group'
      ? manual[0]
      : undefined
  const planState = plannedState(item.plannedFor)

  return (
    <div className="focus-mode" role="dialog" aria-modal="true" aria-label="晚间处理模式">
      <header className="focus-header">
        <div>
          <span className="brand-kicker">EVENING REVIEW</span>
          <h1>晚间处理</h1>
        </div>
        <div className="focus-counter">{activeIndex + 1} / {ordered.length}</div>
        <Button icon={<AppIcon name="close" size={20} />} onClick={onClose}>退出</Button>
      </header>

      <main className="focus-stage">
        <Button className="focus-arrow focus-arrow-left" aria-label="上一条" onClick={() => move(-1)} disabled={ordered.length <= 1}>
          <AppIcon name="previous" size={28} />
        </Button>
        <Card className={cover ? 'focus-card has-cover' : 'focus-card'} pattern="default">
          {cover && (
            <button type="button" className="focus-cover" onClick={() => onPreview(item.kind === 'image_group' ? manual : [cover], 0)}>
              <img src={cover.thumbUrl} alt="" />
              {manual.length > 1 && <span>{manual.length} 张</span>}
            </button>
          )}
          <div className="focus-content">
            <div className="focus-badges">
              <Tag color={item.status === 'pending' ? 'app-yellow' : 'app-green'}>{item.status === 'pending' ? '待处理' : '已完成'}</Tag>
              {item.isStarred && <Tag color="app-yellow"><AppIcon name="star" size={16} />星标</Tag>}
              {planState === 'overdue' && <Tag color="app-red">逾期</Tag>}
              {planState === 'today' && <Tag color="app-teal">今天处理</Tag>}
              <span className="item-age">{itemAgeLabel(item, now)}</span>
            </div>
            <h2>{item.title}</h2>
            {item.url && <p className="focus-url">{item.url}</p>}
            <label className="focus-category">
              <span>类别</span>
              {theme === 'animal-island' ? (
                <Select
                  aria-label="修改当前条目类别"
                  value={item.category?.id || ''}
                  options={[
                    { key: '', label: '未分类' },
                    ...categories.map((category) => ({ key: category.id, label: category.name }))
                  ]}
                  onChange={(value) => void patch({ categoryId: value || null }, '类别已更新')}
                />
              ) : (
                <select
                  aria-label="修改当前条目类别"
                  value={item.category?.id || ''}
                  onChange={(event) => void patch({ categoryId: event.target.value || null }, '类别已更新')}
                >
                  <option value="">未分类</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              )}
            </label>
            <div className="focus-primary-actions">
              <Button
                type="primary"
                size="large"
                disabled={busy}
                icon={<AppIcon name={item.status === 'pending' ? 'complete' : 'restore'} size={22} />}
                onClick={() => void patch(
                  { status: item.status === 'pending' ? 'completed' : 'pending' },
                  item.status === 'pending' ? '已完成' : '已恢复',
                  item.status === 'pending'
                )}
              >
                {item.status === 'pending' ? '完成并到下一条' : '恢复待处理'}
              </Button>
              <Button size="large" disabled={busy} icon={<AppIcon name="skip" size={22} />} onClick={() => move(1)}>跳过</Button>
              {(item.kind === 'link' || item.kind === 'image_group') && (
                <Button size="large" disabled={busy} icon={<AppIcon name="open" size={22} />} onClick={openItem}>
                  {item.kind === 'link' ? '打开原网页' : '查看图片'}
                </Button>
              )}
            </div>
            <div className="focus-secondary-actions">
              <Button disabled={busy} icon={<AppIcon name="star" size={19} />} onClick={() => void patch({ isStarred: !item.isStarred }, item.isStarred ? '已取消星标' : '已加星标')}>
                {item.isStarred ? '取消星标' : '加星标'}
              </Button>
              <Button
                disabled={busy || item.status === 'completed'}
                icon={<AppIcon name="today" size={19} />}
                onClick={() => void patch({ plannedFor: item.plannedFor ? null : chinaToday() }, item.plannedFor ? '已移出今日清单' : '已加入今日清单')}
              >
                {item.plannedFor ? '移出今日' : '今天处理'}
              </Button>
              <Button disabled={busy} icon={<AppIcon name="edit" size={19} />} onClick={() => onEdit(item)}>编辑</Button>
              <Button disabled={busy} danger icon={<AppIcon name="delete" size={19} />} onClick={async () => {
                const nextId = ordered[(activeIndex + 1) % Math.max(1, ordered.length)]?.id || ''
                if (await onDelete(item)) setActiveId(nextId)
              }}>删除</Button>
            </div>
          </div>
        </Card>
        <Button className="focus-arrow focus-arrow-right" aria-label="下一条" onClick={() => move(1)} disabled={ordered.length <= 1}>
          <AppIcon name="next" size={28} />
        </Button>
      </main>
      <footer className="focus-shortcuts" aria-label="键盘快捷键">
        <span>← → 切换</span><span>O 打开</span><span>空格 完成/恢复</span><span>S 星标</span><span>T 今日</span><span>Esc 退出</span>
      </footer>
    </div>
  )
}
