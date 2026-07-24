import { type ComponentProps, type ReactNode } from 'react'
import { Icon } from 'animal-island-ui'
import { useTheme } from '../theme'

export type AppIconName =
  | 'add'
  | 'image'
  | 'bookmark'
  | 'categories'
  | 'theme'
  | 'account'
  | 'logout'
  | 'search'
  | 'edit'
  | 'delete'
  | 'complete'
  | 'restore'
  | 'close'
  | 'previous'
  | 'next'
  | 'link'
  | 'text'
  | 'star'
  | 'today'
  | 'focus'
  | 'select'
  | 'bulk'
  | 'backup'
  | 'install'
  | 'retry'
  | 'sync'
  | 'warning'
  | 'open'
  | 'skip'
  | 'sort'
  | 'download'
  | 'upload'
  | 'clipboard'
  | 'trash'
  | 'more'
  | 'calendar'
  | 'zoomIn'
  | 'zoomOut'
  | 'memo'
  | 'library'
  | 'background'
  | 'grid'
  | 'dots'
  | 'lines'
  | 'moon'
  | 'sun'
  | 'fullscreen'
  | 'fullscreenExit'
  | 'remove'

const animalIcons: Partial<Record<AppIconName, ComponentProps<typeof Icon>['name']>> = {
  add: 'icon-diy',
  image: 'icon-camera',
  bookmark: 'icon-map',
  categories: 'icon-design',
  theme: 'icon-critterpedia',
  account: 'icon-miles',
  logout: 'icon-helicopter',
  link: 'icon-map',
  text: 'icon-chat',
  focus: 'icon-critterpedia',
  select: 'icon-design',
  bulk: 'icon-shopping',
  backup: 'icon-map',
  install: 'icon-miles',
  sync: 'icon-miles',
  open: 'icon-map',
  clipboard: 'icon-diy',
  trash: 'icon-shopping',
  calendar: 'icon-map',
  memo: 'icon-chat',
  library: 'icon-critterpedia',
  background: 'icon-design',
  grid: 'icon-design',
  dots: 'icon-diy',
  lines: 'icon-map',
  fullscreen: 'icon-variant',
  fullscreenExit: 'icon-variant'
}

function FlatPaths({ name }: { name: AppIconName }) {
  const paths: Record<AppIconName, ReactNode> = {
    add: <><path d="M5 3h9l5 5v13H5z" /><path d="M14 3v5h5M8 14h8M12 10v8" /></>,
    image: <><rect x="3" y="4" width="18" height="16" /><circle cx="8" cy="9" r="1.5" /><path d="m4 18 5-5 3.5 3 3-4 4.5 5" /></>,
    bookmark: <path d="M7 3h10v18l-5-3.5L7 21z" />,
    categories: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
    theme: <><rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="8" /><rect x="3" y="13" width="8" height="8" /><rect x="13" y="13" width="8" height="8" /></>,
    account: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4.6 3.5-7 8-7s7.2 2.4 8 7" /></>,
    logout: <><path d="M10 4H4v16h6M14 8l4 4-4 4M8 12h10" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
    edit: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.5 7l3.5 3.5" /><path d="M4 20h16" /></>,
    delete: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    complete: <><rect x="3" y="3" width="18" height="18" /><path d="m7 12 3.2 3.2L17.5 8" /></>,
    restore: <><path d="M5 8V3M5 8h5" /><path d="M5.5 7.5A8 8 0 1 1 4 15" /></>,
    close: <path d="M5 5l14 14M19 5 5 19" />,
    previous: <path d="m15 4-8 8 8 8" />,
    next: <path d="m9 4 8 8-8 8" />,
    link: <><path d="m9.5 14.5-2 2a3.5 3.5 0 1 1-5-5l4-4a3.5 3.5 0 0 1 5 0" /><path d="m14.5 9.5 2-2a3.5 3.5 0 1 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" /><path d="m8 16 8-8" /></>,
    text: <><path d="M5 4h14M12 4v16M8 20h8" /></>,
    star: <path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" />,
    today: <><rect x="3" y="5" width="18" height="16" /><path d="M7 3v4M17 3v4M3 10h18M8 14h3v3H8z" /></>,
    focus: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" /><circle cx="12" cy="12" r="3" /></>,
    select: <><rect x="3" y="3" width="18" height="18" /><path d="m7 12 3 3 7-7" /></>,
    bulk: <><rect x="6" y="6" width="15" height="15" /><path d="M3 17V3h14M10 11h7M10 15h7" /></>,
    backup: <><path d="M4 8h16v13H4zM7 3h10l3 5H4z" /><path d="M9 13h6M12 10v6" /></>,
    install: <><rect x="5" y="2" width="14" height="20" rx="1" /><path d="M9 5h6M12 8v8M9 13l3 3 3-3M10 19h4" /></>,
    retry: <><path d="M5 8V3M5 8h5" /><path d="M5.5 7.5A8 8 0 1 1 4 15" /></>,
    sync: <><path d="M4 8h12l-3-3M20 16H8l3 3" /><path d="m16 8-3 3M8 16l3-3" /></>,
    warning: <><path d="M12 3 2.5 21h19z" /><path d="M12 9v5M12 17.5v.5" /></>,
    open: <><path d="M13 4h7v7M20 4l-9 9" /><path d="M18 14v6H4V6h6" /></>,
    skip: <><path d="m5 4 9 8-9 8zM18 4v16" /></>,
    sort: <><path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4" /></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M4 20h16" /></>,
    upload: <><path d="M12 21V9M7 14l5-5 5 5M4 4h16" /></>,
    clipboard: <><path d="M8 5H5v16h14V5h-3" /><rect x="8" y="2" width="8" height="5" /><path d="M8 12h8M8 16h6" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
    zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6" /></>,
    zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.5 10.5h6" /></>,
    memo: <><path d="M4 3h16v18H4zM8 3v18M11 8h6M11 12h6M11 16h4" /></>,
    library: <><path d="M4 4h5v16H4zM10 4h5v16h-5zM16 5l4-1 2 15-4 1z" /></>,
    background: <><rect x="3" y="3" width="18" height="18" /><path d="M3 15 15 3M7 21 21 7" /></>,
    grid: <><path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" /></>,
    dots: <><circle cx="5" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="5" cy="19" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="19" r="1" fill="currentColor" stroke="none" /></>,
    lines: <><path d="M3 5h18M3 10h18M3 15h18M3 20h18" /></>,
    moon: <path d="M19.5 15.5A8 8 0 0 1 8.5 4.5 8.5 8.5 0 1 0 19.5 15.5Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
    fullscreen: <path d="M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6" />,
    fullscreenExit: <path d="M3 9h6V3M21 9h-6V3M15 21v-6h6M9 21v-6H3" />,
    remove: <><rect x="3" y="3" width="18" height="18" /><path d="M7 12h10" /></>
  }
  return paths[name]
}

export function AppIcon({
  name,
  size = 24,
  className = ''
}: {
  name: AppIconName
  size?: number
  className?: string
}) {
  const { theme } = useTheme()
  const animalName = animalIcons[name]
  if (theme === 'animal-island' && animalName) {
    return <Icon name={animalName} size={size} className={className} />
  }
  const organic = theme === 'animal-island'
  return (
    <svg
      className={['app-icon', organic ? 'app-icon-animal-custom' : '', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={organic ? 2 : 1.8}
      strokeLinecap={organic ? 'round' : 'square'}
      strokeLinejoin={organic ? 'round' : 'miter'}
      aria-hidden="true"
      focusable="false"
    >
      <FlatPaths name={name} />
    </svg>
  )
}
