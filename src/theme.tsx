import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

export type ThemeId = 'flat-2013' | 'animal-island' | 'calm' | 'pinterest'

export interface ThemeDefinition {
  id: ThemeId
  name: string
  shortDescription: string
  credit: string
  license: string
  creditUrl: string
  themeColor: string
  authKicker: string
  authLoginDescription: string
  authRecoveryDescription: string
  dashboardKicker: string
  dashboardDescription: string
}

export const THEME_STORAGE_KEY = 'do-it-laaaaaater.theme.v1'
export const DEFAULT_THEME: ThemeId = 'flat-2013'

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'flat-2013',
    name: 'Flat Design 2013',
    shortDescription: '纯色色块、直角界面与充足留白',
    credit: 'NovusGFX · Retro Design System',
    license: 'MIT',
    creditUrl: 'https://github.com/novusgfx/retro-design-system',
    themeColor: '#34495e',
    authKicker: 'FLAT READING LIST',
    authLoginDescription: '欢迎回来，继续处理稍后内容',
    authRecoveryDescription: '为你的账号设置一个新密码',
    dashboardKicker: 'FLAT READING LIST / 2013',
    dashboardDescription: '把值得处理的网页、文字和图片集中起来'
  },
  {
    id: 'animal-island',
    name: 'Animal Island UI',
    shortDescription: '奶油色卡片、自然纹理与小岛装饰',
    credit: 'guokaigdg · Animal Island UI',
    license: 'CC BY-NC 4.0',
    creditUrl: 'https://github.com/guokaigdg/animal-island-ui',
    themeColor: '#19c8b9',
    authKicker: 'MY ISLAND LIST',
    authLoginDescription: '欢迎回到你的稍后处理小岛',
    authRecoveryDescription: '为你的稍后处理小岛换一把新钥匙',
    dashboardKicker: 'PRIVATE ISLAND LIST',
    dashboardDescription: '把白天发现的好东西带回自己的小岛'
  },
  {
    id: 'calm',
    name: 'Calm Night',
    shortDescription: '雾蓝与暖沙的安宁冥想风，晚间处理护眼',
    credit: 'Calm 风格参考 · refero.design',
    license: '原创主题（参考 calm.com 气质）',
    creditUrl: 'https://refero.design',
    themeColor: '#7fa8b5',
    authKicker: 'CALM READING LIST',
    authLoginDescription: '欢迎回来，安静地处理稍后内容',
    authRecoveryDescription: '为新的一天重置密码',
    dashboardKicker: 'CALM NIGHT / 稍后读',
    dashboardDescription: '柔和低饱和的晚间处理空间'
  },
  {
    id: 'pinterest',
    name: 'Pinterest Wall',
    shortDescription: '瀑布流灵感墙，图片优先的采集感',
    credit: 'Pinterest 风格参考 · refero.design',
    license: '原创主题（参考 pinterest.com 气质）',
    creditUrl: 'https://refero.design',
    themeColor: '#e60023',
    authKicker: 'PIN YOUR IDEAS',
    authLoginDescription: '欢迎回来，继续收集灵感',
    authRecoveryDescription: '重置密码，重新开始采集',
    dashboardKicker: 'IDEAS WALL / 灵感墙',
    dashboardDescription: '把灵感像图钉一样钉在墙上'
  }
] as const

const validThemes = new Set<ThemeId>(THEMES.map((theme) => theme.id))

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && validThemes.has(value as ThemeId)
}

export function getThemeDefinition(theme: ThemeId) {
  return THEMES.find((entry) => entry.id === theme) || THEMES[0]
}

function readInitialTheme(): ThemeId {
  const documentTheme = document.documentElement.dataset.theme
  if (isThemeId(documentTheme)) return documentTheme
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeId(stored)) return stored
  } catch {
    // Browsers can disable storage; the default theme remains fully usable.
  }
  return DEFAULT_THEME
}

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme
  const definition = getThemeDefinition(theme)
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColor && definition) themeColor.content = definition.themeColor
}

interface ThemeContextValue {
  theme: ThemeId
  themes: readonly ThemeDefinition[]
  setTheme: (theme: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme)

  const setTheme = useCallback((nextTheme: ThemeId) => {
    if (!isThemeId(nextTheme)) return
    applyTheme(nextTheme)
    setThemeState(nextTheme)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // Theme switching still works for the current page without storage.
    }
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    function syncTheme(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY || !isThemeId(event.newValue)) return
      applyTheme(event.newValue)
      setThemeState(event.newValue)
    }
    window.addEventListener('storage', syncTheme)
    return () => window.removeEventListener('storage', syncTheme)
  }, [])

  const value = useMemo<ThemeContextValue>(() => ({ theme, themes: THEMES, setTheme }), [setTheme, theme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('ThemeProvider is missing')
  return value
}
