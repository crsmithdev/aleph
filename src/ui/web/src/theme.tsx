import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { findTheme, DEFAULT_DARK, DEFAULT_LIGHT, type ThemeDef } from './themes';

export interface FontDef {
  id: string;
  name: string;
  family: string;
}

// Unified sans/display font list — used for both body and heading pickers.
// Sorted alphabetically by name.
export const fonts: FontDef[] = [
  { id: 'abeezee', name: 'ABeeZee', family: "'ABeeZee'" },
  { id: 'albert-sans', name: 'Albert Sans', family: "'Albert Sans'" },
  { id: 'alata', name: 'Alata', family: "'Alata'" },
  { id: 'ar-one-sans', name: 'AR One Sans', family: "'AR One Sans'" },
  { id: 'atkinson', name: 'Atkinson Hyperlegible', family: "'Atkinson Hyperlegible Next'" },
  { id: 'b612', name: 'B612', family: "'B612'" },
  { id: 'bricolage-grotesque', name: 'Bricolage Grotesque', family: "'Bricolage Grotesque'" },
  { id: 'cabin', name: 'Cabin', family: "'Cabin'" },
  { id: 'cantarell', name: 'Cantarell', family: "'Cantarell'" },
  { id: 'comfortaa', name: 'Comfortaa', family: "'Comfortaa'" },
  { id: 'comme', name: 'Comme', family: "'Comme'" },
  { id: 'commissioner', name: 'Commissioner', family: "'Commissioner'" },
  { id: 'dm-sans', name: 'DM Sans', family: "'DM Sans'" },
  { id: 'encode-sans-expanded', name: 'Encode Sans Expanded', family: "'Encode Sans Expanded'" },
  { id: 'epilogue', name: 'Epilogue', family: "'Epilogue'" },
  { id: 'figtree', name: 'Figtree', family: "'Figtree'" },
  { id: 'fredoka', name: 'Fredoka', family: "'Fredoka'" },
  { id: 'funnel-display', name: 'Funnel Display', family: "'Funnel Display'" },
  { id: 'funnel-sans', name: 'Funnel Sans', family: "'Funnel Sans'" },
  { id: 'gantari', name: 'Gantari', family: "'Gantari'" },
  { id: 'geist', name: 'Geist', family: "'Geist'" },
  { id: 'geologica', name: 'Geologica', family: "'Geologica'" },
  { id: 'glory', name: 'Glory', family: "'Glory'" },
  { id: 'golos-text', name: 'Golos Text', family: "'Golos Text'" },
  { id: 'hubot-sans', name: 'Hubot Sans', family: "'Hubot Sans'" },
  { id: 'inder', name: 'Inder', family: "'Inder'" },
  { id: 'inria-sans', name: 'Inria Sans', family: "'Inria Sans'" },
  { id: 'instrument-sans', name: 'Instrument Sans', family: "'Instrument Sans'" },
  { id: 'inter', name: 'Inter', family: "'Inter'" },
  { id: 'istok-web', name: 'Istok Web', family: "'Istok Web'" },
  { id: 'karla', name: 'Karla', family: "'Karla'" },
  { id: 'kumbh-sans', name: 'Kumbh Sans', family: "'Kumbh Sans'" },
  { id: 'lato', name: 'Lato', family: "'Lato'" },
  { id: 'lexend', name: 'Lexend', family: "'Lexend'" },
  { id: 'lexend-deca', name: 'Lexend Deca', family: "'Lexend Deca'" },
  { id: 'manrope', name: 'Manrope', family: "'Manrope'" },
  { id: 'maven-pro', name: 'Maven Pro', family: "'Maven Pro'" },
  { id: 'merriweather-sans', name: 'Merriweather Sans', family: "'Merriweather Sans'" },
  { id: 'molengo', name: 'Molengo', family: "'Molengo'" },
  { id: 'mulish', name: 'Mulish', family: "'Mulish'" },
  { id: 'nobile', name: 'Nobile', family: "'Nobile'" },
  { id: 'noto-sans', name: 'Noto Sans', family: "'Noto Sans'" },
  { id: 'noto-sans-display', name: 'Noto Sans Display', family: "'Noto Sans Display'" },
  { id: 'numans', name: 'Numans', family: "'Numans'" },
  { id: 'nunito-sans', name: 'Nunito Sans', family: "'Nunito Sans'" },
  { id: 'onest', name: 'Onest', family: "'Onest'" },
  { id: 'outfit', name: 'Outfit', family: "'Outfit'" },
  { id: 'overpass', name: 'Overpass', family: "'Overpass'" },
  { id: 'oxygen', name: 'Oxygen', family: "'Oxygen'" },
  { id: 'pathway-extreme', name: 'Pathway Extreme', family: "'Pathway Extreme'" },
  { id: 'plus-jakarta', name: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans'" },
  { id: 'pt-sans-caption', name: 'PT Sans Caption', family: "'PT Sans Caption'" },
  { id: 'questrial', name: 'Questrial', family: "'Questrial'" },
  { id: 'radio-canada', name: 'Radio Canada', family: "'Radio Canada'" },
  { id: 'rem', name: 'REM', family: "'REM'" },
  { id: 'rethink-sans', name: 'Rethink Sans', family: "'Rethink Sans'" },
  { id: 'rubik', name: 'Rubik', family: "'Rubik'" },
  { id: 'sansation', name: 'Sansation', family: "'Sansation'" },
  { id: 'schibsted-grotesk', name: 'Schibsted Grotesk', family: "'Schibsted Grotesk'" },
  { id: 'sen', name: 'Sen', family: "'Sen'" },
  { id: 'shanti', name: 'Shanti', family: "'Shanti'" },
  { id: 'sintony', name: 'Sintony', family: "'Sintony'" },
  { id: 'sora', name: 'Sora', family: "'Sora'" },
  { id: 'source-sans-3', name: 'Source Sans 3', family: "'Source Sans 3'" },
  { id: 'space-grotesk', name: 'Space Grotesk', family: "'Space Grotesk'" },
  { id: 'spinnaker', name: 'Spinnaker', family: "'Spinnaker'" },
  { id: 'tasa-orbiter', name: 'TASA Orbiter', family: "'Tasa Orbiter'" },
  { id: 'tauri', name: 'Tauri', family: "'Tauri'" },
  { id: 'telex', name: 'Telex', family: "'Telex'" },
  { id: 'urbanist', name: 'Urbanist', family: "'Urbanist'" },
  { id: 'varela', name: 'Varela', family: "'Varela'" },
  { id: 'voces', name: 'Voces', family: "'Voces'" },
  { id: 'wix-madefor-display', name: 'Wix Madefor Display', family: "'Wix Madefor Display'" },
  { id: 'work-sans', name: 'Work Sans', family: "'Work Sans'" },
  { id: 'zalando-sans', name: 'Zalando Sans', family: "'Zalando Sans'" },
  { id: 'zalando-sans-semi', name: 'Zalando Sans SemiExpanded', family: "'Zalando Sans SemiExpanded'" },
];

// Both body and heading pickers use the same unified list.
export const headingFonts = fonts;

export const monoFonts: FontDef[] = [
  { id: 'atkinson-mono', name: 'Atkinson Hyperlegible Mono', family: "'Atkinson Hyperlegible Mono'" },
  { id: 'b612-mono', name: 'B612 Mono', family: "'B612 Mono'" },
  { id: 'chivo-mono', name: 'Chivo Mono', family: "'Chivo Mono'" },
  { id: 'cousine', name: 'Cousine', family: "'Cousine'" },
  { id: 'fira-code', name: 'Fira Code', family: "'Fira Code'" },
  { id: 'fira-mono', name: 'Fira Mono', family: "'Fira Mono'" },
  { id: 'ibm-plex-mono', name: 'IBM Plex Mono', family: "'IBM Plex Mono'" },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', family: "'JetBrains Mono'" },
  { id: 'noto-sans-mono', name: 'Noto Sans Mono', family: "'Noto Sans Mono'" },
  { id: 'overpass-mono', name: 'Overpass Mono', family: "'Overpass Mono'" },
  { id: 'oxygen-mono', name: 'Oxygen Mono', family: "'Oxygen Mono'" },
  { id: 'pt-mono', name: 'PT Mono', family: "'PT Mono'" },
  { id: 'recursive', name: 'Recursive', family: "'Recursive'" },
  { id: 'source-code-pro', name: 'Source Code Pro', family: "'Source Code Pro'" },
  { id: 'spline-sans-mono', name: 'Spline Sans Mono', family: "'Spline Sans Mono'" },
  { id: 'ubuntu-sans-mono', name: 'Ubuntu Sans Mono', family: "'Ubuntu Sans Mono'" },
];

const DEFAULT_FONT = 'figtree';
const DEFAULT_HEADING_FONT = 'space-grotesk';
const DEFAULT_MONO_FONT = 'noto-sans-mono';

function findFont(id: string): FontDef | undefined {
  return fonts.find((f) => f.id === id);
}

function findHeadingFont(id: string): FontDef | undefined {
  return fonts.find((f) => f.id === id);
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
