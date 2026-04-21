import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { findTheme, DEFAULT_DARK, DEFAULT_LIGHT, type ThemeDef } from './themes';

export interface FontDef {
  id: string;
  name: string;
  family: string;
}

// General-purpose / body fonts — sorted alphabetically.
export const fonts: FontDef[] = [
  { id: 'albert-sans', name: 'Albert Sans', family: "'Albert Sans'" },
  { id: 'ar-one-sans', name: 'AR One Sans', family: "'AR One Sans'" },
  { id: 'atkinson', name: 'Atkinson Hyperlegible', family: "'Atkinson Hyperlegible Next'" },
  { id: 'commissioner', name: 'Commissioner', family: "'Commissioner'" },
  { id: 'dm-sans', name: 'DM Sans', family: "'DM Sans'" },
  { id: 'lato', name: 'Lato', family: "'Lato'" },
  { id: 'mulish', name: 'Mulish', family: "'Mulish'" },
  { id: 'noto-sans', name: 'Noto Sans', family: "'Noto Sans'" },
  { id: 'nunito-sans', name: 'Nunito Sans', family: "'Nunito Sans'" },
  { id: 'rethink-sans', name: 'Rethink Sans', family: "'Rethink Sans'" },
  { id: 'rubik', name: 'Rubik', family: "'Rubik'" },
  { id: 'tasa-orbiter', name: 'TASA Orbiter', family: "'TASA Orbiter'" },
  { id: 'work-sans', name: 'Work Sans', family: "'Work Sans'" },
  { id: 'zalando-sans', name: 'Zalando Sans', family: "'Zalando Sans'" },
];

// Title / heading fonts — sorted alphabetically.
export const headingFonts: FontDef[] = [
  { id: 'ar-one-sans', name: 'AR One Sans', family: "'AR One Sans'" },
  { id: 'atkinson', name: 'Atkinson Hyperlegible', family: "'Atkinson Hyperlegible Next'" },
  { id: 'bricolage-grotesque', name: 'Bricolage Grotesque', family: "'Bricolage Grotesque'" },
  { id: 'figtree', name: 'Figtree', family: "'Figtree'" },
  { id: 'funnel-display', name: 'Funnel Display', family: "'Funnel Display'" },
  { id: 'geist', name: 'Geist', family: "'Geist'" },
  { id: 'geologica', name: 'Geologica', family: "'Geologica'" },
  { id: 'merriweather-sans', name: 'Merriweather Sans', family: "'Merriweather Sans'" },
  { id: 'mulish', name: 'Mulish', family: "'Mulish'" },
  { id: 'noto-sans', name: 'Noto Sans', family: "'Noto Sans'" },
  { id: 'rem', name: 'REM', family: "'REM'" },
  { id: 'spinnaker', name: 'Spinnaker', family: "'Spinnaker'" },
  { id: 'varela', name: 'Varela', family: "'Varela'" },
  { id: 'voces', name: 'Voces', family: "'Voces'" },
];

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
const DEFAULT_HEADING_FONT = 'bricolage-grotesque';
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
  trackingSans: number;
  setTrackingSans: (v: number) => void;
  trackingHeading: number;
  setTrackingHeading: (v: number) => void;
  trackingMono: number;
  setTrackingMono: (v: number) => void;
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
  trackingSans: 0,
  setTrackingSans: () => {},
  trackingHeading: 0,
  setTrackingHeading: () => {},
  trackingMono: 0,
  setTrackingMono: () => {},
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

function getInitialTracking(key: string): number {
  if (typeof window === 'undefined') return 0;
  const stored = localStorage.getItem(key);
  const n = stored == null ? NaN : parseFloat(stored);
  return Number.isFinite(n) ? n : 0;
}

function applyTracking(name: 'sans' | 'heading' | 'mono', value: number) {
  document.documentElement.style.setProperty(`--tracking-${name}`, `${value}em`);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState(getInitialThemeId);
  const [fontId, setFontIdState] = useState(getInitialFontId);
  const [headingFontId, setHeadingFontIdState] = useState(getInitialHeadingFontId);
  const [monoFontId, setMonoFontIdState] = useState(getInitialMonoFontId);
  const [trackingSans, setTrackingSansState] = useState(() => getInitialTracking('trackingSans'));
  const [trackingHeading, setTrackingHeadingState] = useState(() => getInitialTracking('trackingHeading'));
  const [trackingMono, setTrackingMonoState] = useState(() => getInitialTracking('trackingMono'));
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

  useEffect(() => {
    applyTracking('sans', trackingSans);
    localStorage.setItem('trackingSans', String(trackingSans));
  }, [trackingSans]);

  useEffect(() => {
    applyTracking('heading', trackingHeading);
    localStorage.setItem('trackingHeading', String(trackingHeading));
  }, [trackingHeading]);

  useEffect(() => {
    applyTracking('mono', trackingMono);
    localStorage.setItem('trackingMono', String(trackingMono));
  }, [trackingMono]);

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

  const clampTracking = (v: number) => Math.max(-0.04, Math.min(0.12, v));
  const setTrackingSans = (v: number) => setTrackingSansState(clampTracking(v));
  const setTrackingHeading = (v: number) => setTrackingHeadingState(clampTracking(v));
  const setTrackingMono = (v: number) => setTrackingMonoState(clampTracking(v));

  return (
    <ThemeContext.Provider value={{
      themeId, theme, setThemeId,
      fontId, font, setFontId,
      headingFontId, headingFont, setHeadingFontId,
      monoFontId, monoFont, setMonoFontId,
      trackingSans, setTrackingSans,
      trackingHeading, setTrackingHeading,
      trackingMono, setTrackingMono,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
