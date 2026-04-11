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

export const headingFonts: FontDef[] = [
  { id: 'space-grotesk', name: 'Space Grotesk', family: "'Space Grotesk'" },
  { id: 'sora', name: 'Sora', family: "'Sora'" },
  { id: 'onest', name: 'Onest', family: "'Onest'" },
  { id: 'pathway-extreme', name: 'Pathway Extreme', family: "'Pathway Extreme'" },
  { id: 'glory', name: 'Glory', family: "'Glory'" },
  { id: 'karla-heading', name: 'Karla', family: "'Karla'" },
  { id: 'overpass', name: 'Overpass', family: "'Overpass'" },
  { id: 'noto-sans', name: 'Noto Sans', family: "'Noto Sans'" },
  { id: 'tauri', name: 'Tauri', family: "'Tauri'" },
  { id: 'rem', name: 'REM', family: "'REM'" },
  { id: 'outfit', name: 'Outfit', family: "'Outfit'" },
  { id: 'plus-jakarta', name: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans'" },
  { id: 'manrope', name: 'Manrope', family: "'Manrope'" },
];

export const monoFonts: FontDef[] = [
  { id: 'noto-sans-mono', name: 'Noto Sans Mono', family: "'Noto Sans Mono'" },
  { id: 'fira-code', name: 'Fira Code', family: "'Fira Code'" },
  { id: 'fira-mono', name: 'Fira Mono', family: "'Fira Mono'" },
  { id: 'cousine', name: 'Cousine', family: "'Cousine'" },
  { id: 'overpass-mono', name: 'Overpass Mono', family: "'Overpass Mono'" },
  { id: 'spline-sans-mono', name: 'Spline Sans Mono', family: "'Spline Sans Mono'" },
  { id: 'ubuntu-sans-mono', name: 'Ubuntu Sans Mono', family: "'Ubuntu Sans Mono'" },
  { id: 'pt-mono', name: 'PT Mono', family: "'PT Mono'" },
  { id: 'chivo-mono', name: 'Chivo Mono', family: "'Chivo Mono'" },
  { id: 'oxygen-mono', name: 'Oxygen Mono', family: "'Oxygen Mono'" },
  { id: 'b612-mono', name: 'B612 Mono', family: "'B612 Mono'" },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', family: "'JetBrains Mono'" },
  { id: 'source-code-pro', name: 'Source Code Pro', family: "'Source Code Pro'" },
  { id: 'ibm-plex-mono', name: 'IBM Plex Mono', family: "'IBM Plex Mono'" },
];

const DEFAULT_FONT = 'figtree';
const DEFAULT_HEADING_FONT = 'space-grotesk';
const DEFAULT_MONO_FONT = 'noto-sans-mono';

function findFont(id: string): FontDef | undefined {
  return fonts.find((f) => f.id === id);
}

function findHeadingFont(id: string): FontDef | undefined {
  return headingFonts.find((f) => f.id === id);
}

function findMonoFont(id: string): FontDef | undefined {
  return monoFonts.find((f) => f.id === id);
}

interface ThemeContextValue {
  themeId: string;
  theme: ThemeDef;
  setThemeId: (id: string) => void;
  fontId: string;
  font: FontDef;
  setFontId: (id: string) => void;
  headingFontId: string;
  headingFont: FontDef;
  setHeadingFontId: (id: string) => void;
  monoFontId: string;
  monoFont: FontDef;
  setMonoFontId: (id: string) => void;
}

const fallback = findTheme(DEFAULT_DARK)!;
const fallbackFont = findFont(DEFAULT_FONT)!;
const fallbackHeadingFont = findHeadingFont(DEFAULT_HEADING_FONT)!;
const fallbackMonoFont = findMonoFont(DEFAULT_MONO_FONT)!;

const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_DARK,
  theme: fallback,
  setThemeId: () => {},
  fontId: DEFAULT_FONT,
  font: fallbackFont,
  setFontId: () => {},
  headingFontId: DEFAULT_HEADING_FONT,
  headingFont: fallbackHeadingFont,
  setHeadingFontId: () => {},
  monoFontId: DEFAULT_MONO_FONT,
  monoFont: fallbackMonoFont,
  setMonoFontId: () => {},
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

function getInitialHeadingFontId(): string {
  if (typeof window === 'undefined') return DEFAULT_HEADING_FONT;
  const stored = localStorage.getItem('headingFontId');
  if (stored && findHeadingFont(stored)) return stored;
  return DEFAULT_HEADING_FONT;
}

function getInitialMonoFontId(): string {
  if (typeof window === 'undefined') return DEFAULT_MONO_FONT;
  const stored = localStorage.getItem('monoFontId');
  if (stored && findMonoFont(stored)) return stored;
  return DEFAULT_MONO_FONT;
}

function applyFont(font: FontDef) {
  document.documentElement.style.setProperty('--font-sans', `${font.family}, system-ui, sans-serif`);
}

function applyHeadingFont(font: FontDef) {
  document.documentElement.style.setProperty('--font-heading', `${font.family}, system-ui, sans-serif`);
}

function applyMonoFont(font: FontDef) {
  document.documentElement.style.setProperty('--font-mono', `${font.family}, ui-monospace, monospace`);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState(getInitialThemeId);
  const [fontId, setFontIdState] = useState(getInitialFontId);
  const [headingFontId, setHeadingFontIdState] = useState(getInitialHeadingFontId);
  const [monoFontId, setMonoFontIdState] = useState(getInitialMonoFontId);
  const theme = findTheme(themeId) ?? fallback;
  const font = findFont(fontId) ?? fallbackFont;
  const headingFont = findHeadingFont(headingFontId) ?? fallbackHeadingFont;
  const monoFont = findMonoFont(monoFontId) ?? fallbackMonoFont;

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('themeId', themeId);
    localStorage.removeItem('theme');
  }, [themeId, theme]);

  useEffect(() => {
    applyFont(font);
    localStorage.setItem('fontId', fontId);
  }, [fontId, font]);

  useEffect(() => {
    applyHeadingFont(headingFont);
    localStorage.setItem('headingFontId', headingFontId);
  }, [headingFontId, headingFont]);

  useEffect(() => {
    applyMonoFont(monoFont);
    localStorage.setItem('monoFontId', monoFontId);
  }, [monoFontId, monoFont]);

  const setThemeId = (id: string) => {
    if (findTheme(id)) setThemeIdState(id);
  };

  const setFontId = (id: string) => {
    if (findFont(id)) setFontIdState(id);
  };

  const setHeadingFontId = (id: string) => {
    if (findHeadingFont(id)) setHeadingFontIdState(id);
  };

  const setMonoFontId = (id: string) => {
    if (findMonoFont(id)) setMonoFontIdState(id);
  };

  return (
    <ThemeContext.Provider value={{ themeId, theme, setThemeId, fontId, font, setFontId, headingFontId, headingFont, setHeadingFontId, monoFontId, monoFont, setMonoFontId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
