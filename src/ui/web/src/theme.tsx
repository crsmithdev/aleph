import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { findTheme, DEFAULT_DARK, DEFAULT_LIGHT, type ThemeDef } from './themes';

interface ThemeContextValue {
  themeId: string;
  theme: ThemeDef;
  setThemeId: (id: string) => void;
}

const fallback = findTheme(DEFAULT_DARK)!;

const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_DARK,
  theme: fallback,
  setThemeId: () => {},
});

function getInitialThemeId(): string {
  if (typeof window === 'undefined') return DEFAULT_DARK;
  const stored = localStorage.getItem('themeId');
  if (stored && findTheme(stored)) return stored;
  // Migrate from old light/dark toggle
  const oldTheme = localStorage.getItem('theme');
  if (oldTheme === 'light') return DEFAULT_LIGHT;
  if (oldTheme === 'dark') return DEFAULT_DARK;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? DEFAULT_DARK : DEFAULT_LIGHT;
}

function applyTheme(theme: ThemeDef) {
  const el = document.documentElement;
  for (const [key, value] of Object.entries(theme.vars)) {
    el.style.setProperty(key, value);
  }
  el.setAttribute('data-theme', theme.mode);
  el.style.colorScheme = theme.mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState(getInitialThemeId);
  const theme = findTheme(themeId) ?? fallback;

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('themeId', themeId);
    localStorage.removeItem('theme');
  }, [themeId, theme]);

  const setThemeId = (id: string) => {
    if (findTheme(id)) setThemeIdState(id);
  };

  return (
    <ThemeContext.Provider value={{ themeId, theme, setThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
