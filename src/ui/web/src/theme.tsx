import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { findTheme, DEFAULT_DARK, DEFAULT_LIGHT, type ThemeDef } from './themes';

export interface FontDef {
  id: string;
  name: string;
  family: string;
}

export const fonts: FontDef[] = [
  { id: 'figtree', name: 'Figtree', family: "'Figtree'" },
  { id: 'source-sans-3', name: 'Source Sans 3', family: "'Source Sans 3'" },
  { id: 'nunito-sans', name: 'Nunito Sans', family: "'Nunito Sans'" },
  { id: 'instrument-sans', name: 'Instrument Sans', family: "'Instrument Sans'" },
  { id: 'questrial', name: 'Questrial', family: "'Questrial'" },
  { id: 'fredoka', name: 'Fredoka', family: "'Fredoka'" },
  { id: 'comfortaa', name: 'Comfortaa', family: "'Comfortaa'" },
  { id: 'urbanist', name: 'Urbanist', family: "'Urbanist'" },
  { id: 'albert-sans', name: 'Albert Sans', family: "'Albert Sans'" },
  { id: 'atkinson', name: 'Atkinson Hyperlegible', family: "'Atkinson Hyperlegible Next'" },
  { id: 'inter', name: 'Inter', family: "'Inter'" },
  { id: 'dm-sans', name: 'DM Sans', family: "'DM Sans'" },
  { id: 'lexend', name: 'Lexend', family: "'Lexend'" },
  { id: 'karla', name: 'Karla', family: "'Karla'" },
  { id: 'rubik', name: 'Rubik', family: "'Rubik'" },
];

const DEFAULT_FONT = 'figtree';

function findFont(id: string): FontDef | undefined {
  return fonts.find((f) => f.id === id);
}

interface ThemeContextValue {
  themeId: string;
  theme: ThemeDef;
  setThemeId: (id: string) => void;
  fontId: string;
  font: FontDef;
  setFontId: (id: string) => void;
}

const fallback = findTheme(DEFAULT_DARK)!;
const fallbackFont = findFont(DEFAULT_FONT)!;

const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_DARK,
  theme: fallback,
  setThemeId: () => {},
  fontId: DEFAULT_FONT,
  font: fallbackFont,
  setFontId: () => {},
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
  // Set base vars from theme
  for (const [key, value] of Object.entries(theme.vars)) {
    el.style.setProperty(key, value);
  }
  // Set mode for shadow derivation and any mode-conditional CSS
  el.setAttribute('data-theme', theme.mode);
}

function getInitialFontId(): string {
  if (typeof window === 'undefined') return DEFAULT_FONT;
  const stored = localStorage.getItem('fontId');
  if (stored && findFont(stored)) return stored;
  return DEFAULT_FONT;
}

function applyFont(font: FontDef) {
  document.documentElement.style.setProperty('--font-sans', `${font.family}, system-ui, sans-serif`);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState(getInitialThemeId);
  const [fontId, setFontIdState] = useState(getInitialFontId);
  const theme = findTheme(themeId) ?? fallback;
  const font = findFont(fontId) ?? fallbackFont;

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('themeId', themeId);
    localStorage.removeItem('theme');
  }, [themeId, theme]);

  useEffect(() => {
    applyFont(font);
    localStorage.setItem('fontId', fontId);
  }, [fontId, font]);

  const setThemeId = (id: string) => {
    if (findTheme(id)) setThemeIdState(id);
  };

  const setFontId = (id: string) => {
    if (findFont(id)) setFontIdState(id);
  };

  return (
    <ThemeContext.Provider value={{ themeId, theme, setThemeId, fontId, font, setFontId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
