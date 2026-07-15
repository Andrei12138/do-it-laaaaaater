import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

export type ThemeId = 'flat-2013' | 'animal-island'

export interface ThemeDefinition {
  id: ThemeId
  name: string
  shortDescription: string
  credit: string
  license: string
  themeColor: string
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
    themeColor: '#34495e'
  },
  {
    id: 'animal-island',
    name: 'Animal Island UI',
    shortDescription: '奶油色卡片、自然纹理与小岛装饰',
    credit: 'guokaigdg · Animal Island UI',
    license: 'CC BY-NC 4.0',
    themeColor: '#19c8b9'
  }
] as const

const validThemes = new Set<ThemeId>(THEMES.map((theme) => theme.id))

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && validThemes.has(value as ThemeId)
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
  const definition = THEMES.find((entry) => entry.id === theme)
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
