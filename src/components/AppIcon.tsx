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

const animalIcons: Partial<Record<AppIconName, ComponentProps<typeof Icon>['name']>> = {
  add: 'icon-diy',
  image: 'icon-camera',
  bookmark: 'icon-map',
  categories: 'icon-design',
  theme: 'icon-critterpedia',
  account: 'icon-miles',
  logout: 'icon-helicopter',
  link: 'icon-map',
  text: 'icon-chat'
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
    text: <><path d="M5 4h14M12 4v16M8 20h8" /></>
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
  const gridPaper = theme === 'grid-paper'
  return (
    <svg
      className={['app-icon', gridPaper ? 'app-icon-grid-paper' : '', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={gridPaper ? 1.9 : 1.8}
      strokeLinecap={gridPaper ? 'round' : 'square'}
      strokeLinejoin={gridPaper ? 'round' : 'miter'}
      aria-hidden="true"
      focusable="false"
    >
      <FlatPaths name={name} />
    </svg>
  )
}
