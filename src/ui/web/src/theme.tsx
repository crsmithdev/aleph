import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { findTheme, DEFAULT_DARK, DEFAULT_LIGHT, type ThemeDef } from './themes';

export interface FontDef {
  id: string;
  name: string;
  family: string;
}

// Body + heading fonts share one superset list — sorted alphabetically.
export const fonts: FontDef[] = [
  { id: 'albert-sans', name: 'Albert Sans', family: "'Albert Sans'" },
  { id: 'ar-one-sans', name: 'AR One Sans', family: "'AR One Sans'" },
  { id: 'atkinson', name: 'Atkinson Hyperlegible', family: "'Atkinson Hyperlegible Next'" },
  { id: 'bricolage-grotesque', name: 'Bricolage Grotesque', family: "'Bricolage Grotesque'" },
  { id: 'commissioner', name: 'Commissioner', family: "'Commissioner'" },
  { id: 'dm-sans', name: 'DM Sans', family: "'DM Sans'" },
  { id: 'figtree', name: 'Figtree', family: "'Figtree'" },
  { id: 'funnel-display', name: 'Funnel Display', family: "'Funnel Display'" },
  { id: 'geist', name: 'Geist', family: "'Geist'" },
  { id: 'geologica', name: 'Geologica', family: "'Geologica'" },
  { id: 'lato', name: 'Lato', family: "'Lato'" },
  { id: 'merriweather', name: 'Merriweather', family: "'Merriweather'" },
  { id: 'merriweather-sans', name: 'Merriweather Sans', family: "'Merriweather Sans'" },
  { id: 'mulish', name: 'Mulish', family: "'Mulish'" },
  { id: 'noto-sans', name: 'Noto Sans', family: "'Noto Sans'" },
  { id: 'nunito-sans', name: 'Nunito Sans', family: "'Nunito Sans'" },
  { id: 'rem', name: 'REM', family: "'REM'" },
  { id: 'rethink-sans', name: 'Rethink Sans', family: "'Rethink Sans'" },
  { id: 'rubik', name: 'Rubik', family: "'Rubik'" },
  { id: 'spinnaker', name: 'Spinnaker', family: "'Spinnaker'" },
  { id: 'tasa-orbiter', name: 'TASA Orbiter', family: "'TASA Orbiter'" },
  { id: 'varela', name: 'Varela', family: "'Varela'" },
  { id: 'voces', name: 'Voces', family: "'Voces'" },
  { id: 'work-sans', name: 'Work Sans', family: "'Work Sans'" },
  { id: 'zalando-sans', name: 'Zalando Sans', family: "'Zalando Sans'" },
];

export const headingFonts = fonts;

export const monoFonts: FontDef[] = [
  { id: 'atkinson-mono', name: 'Atkinson Hyperlegible Mono', family: "'Atkinson Hyperlegible Mono'" },
  { id: 'b612-mono', name: 'B612 Mono', family: "'B612 Mono'" },
  { id: 'fira-code', name: 'Fira Code', family: "'Fira Code'" },
  { id: 'noto-sans-mono', name: 'Noto Sans Mono', family: "'Noto Sans Mono'" },
  { id: 'pt-mono', name: 'PT Mono', family: "'PT Mono'" },
  { id: 'source-code-pro', name: 'Source Code Pro', family: "'Source Code Pro'" },
  { id: 'spline-sans-mono', name: 'Spline Sans Mono', family: "'Spline Sans Mono'" },
];

const DEFAULT_FONT = 'noto-sans';
const DEFAULT_HEADING_FONT = 'merriweather-sans';
const DEFAULT_MONO_FONT = 'noto-sans-mono';

const findFont = (id: string) => fonts.find((f) => f.id === id);
const findHeadingFont = (id: string) => headingFonts.find((f) => f.id === id);
const findMonoFont = (id: string) => monoFonts.find((f) => f.id === id);

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
  for (const [key, value] of Object.entries(theme.vars)) {
    el.style.setProperty(key, value);
  }
  el.setAttribute('data-theme', theme.mode);
  el.style.colorScheme = theme.mode;
  localStorage.setItem('aleph-color-scheme', theme.mode);
}

function getInitialFont(key: string, fallbackId: string, find: (id: string) => FontDef | undefined): string {
  if (typeof window === 'undefined') return fallbackId;
  const stored = localStorage.getItem(key);
  return stored && find(stored) ? stored : fallbackId;
}

function applyFont(varName: string, font: FontDef, stack: string) {
  document.documentElement.style.setProperty(varName, `${font.family}, ${stack}`);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState(getInitialThemeId);
  const [fontId, setFontIdState] = useState(() => getInitialFont('fontId', DEFAULT_FONT, findFont));
  const [headingFontId, setHeadingFontIdState] = useState(() => getInitialFont('headingFontId', DEFAULT_HEADING_FONT, findHeadingFont));
  const [monoFontId, setMonoFontIdState] = useState(() => getInitialFont('monoFontId', DEFAULT_MONO_FONT, findMonoFont));

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
    applyFont('--font-sans', font, 'system-ui, sans-serif');
    localStorage.setItem('fontId', fontId);
  }, [fontId, font]);

  useEffect(() => {
    applyFont('--font-heading', headingFont, 'system-ui, sans-serif');
    localStorage.setItem('headingFontId', headingFontId);
  }, [headingFontId, headingFont]);

  useEffect(() => {
    applyFont('--font-mono', monoFont, 'ui-monospace, monospace');
    localStorage.setItem('monoFontId', monoFontId);
  }, [monoFontId, monoFont]);

  const setThemeId = (id: string) => { if (findTheme(id)) setThemeIdState(id); };
  const setFontId = (id: string) => { if (findFont(id)) setFontIdState(id); };
  const setHeadingFontId = (id: string) => { if (findHeadingFont(id)) setHeadingFontIdState(id); };
  const setMonoFontId = (id: string) => { if (findMonoFont(id)) setMonoFontIdState(id); };

  return (
    <ThemeContext.Provider value={{
      themeId, theme, setThemeId,
      fontId, font, setFontId,
      headingFontId, headingFont, setHeadingFontId,
      monoFontId, monoFont, setMonoFontId,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
