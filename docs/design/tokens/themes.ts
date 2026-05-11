export type ThemeMode = 'light' | 'dark';

export interface ThemeDef {
  id: string;
  name: string;
  mode: ThemeMode;
  vars: Record<string, string>;
}

// Base variable keys every theme must define
// The app CSS derives --c-accent, --border-primary, etc. from these base vars.

export const darkThemes: ThemeDef[] = [
  {
    id: 'dracula', name: 'Dracula', mode: 'dark',
    vars: {
      '--bg-primary': '#282a36', '--bg-secondary': '#21222c', '--bg-tertiary': '#343746',
      '--bg-hover': '#343746', '--bg-contrast': '#191a21',
      '--text-primary': '#f8f8f2', '--text-secondary': '#a9b1d6', '--text-muted': '#6272a4', '--text-disabled': '#44475a',
      '--border': '#44475a', '--accent': '#bd93f9', '--success': '#50fa7b', '--warning': '#f1fa8c', '--error': '#ff5555',
      '--chart-1': '#bd93f9', '--chart-2': '#8be9fd', '--chart-3': '#50fa7b', '--chart-4': '#f1fa8c', '--chart-5': '#ff79c6', '--chart-6': '#ffb86c',
      '--chart-grid': '#44475a', '--chart-text': '#6272a4', '--chart-tooltip-bg': '#21222c', '--chart-tooltip-border': '#44475a',
    },
  },
  {
    id: 'one-dark-pro', name: 'One Dark Pro', mode: 'dark',
    vars: {
      '--bg-primary': '#282c34', '--bg-secondary': '#21252b', '--bg-tertiary': '#2c313a',
      '--bg-hover': '#2c313a', '--bg-contrast': '#1e2227',
      '--text-primary': '#abb2bf', '--text-secondary': '#848da0', '--text-muted': '#5c6370', '--text-disabled': '#3e4452',
      '--border': '#3e4452', '--accent': '#c678dd', '--success': '#98c379', '--warning': '#e5c07b', '--error': '#e06c75',
      '--chart-1': '#c678dd', '--chart-2': '#61afef', '--chart-3': '#98c379', '--chart-4': '#e5c07b', '--chart-5': '#e06c75', '--chart-6': '#56b6c2',
      '--chart-grid': '#3e4452', '--chart-text': '#5c6370', '--chart-tooltip-bg': '#21252b', '--chart-tooltip-border': '#3e4452',
    },
  },
  {
    id: 'nord', name: 'Nord', mode: 'dark',
    vars: {
      '--bg-primary': '#2e3440', '--bg-secondary': '#3b4252', '--bg-tertiary': '#434c5e',
      '--bg-hover': '#434c5e', '--bg-contrast': '#272c36',
      '--text-primary': '#d8dee9', '--text-secondary': '#9aa5b4', '--text-muted': '#616e88', '--text-disabled': '#4c566a',
      '--border': '#4c566a', '--accent': '#88c0d0', '--success': '#a3be8c', '--warning': '#ebcb8b', '--error': '#bf616a',
      '--chart-1': '#88c0d0', '--chart-2': '#81a1c1', '--chart-3': '#a3be8c', '--chart-4': '#ebcb8b', '--chart-5': '#bf616a', '--chart-6': '#b48ead',
      '--chart-grid': '#4c566a', '--chart-text': '#616e88', '--chart-tooltip-bg': '#3b4252', '--chart-tooltip-border': '#4c566a',
    },
  },
  {
    id: 'material-palenight', name: 'Material Palenight', mode: 'dark',
    vars: {
      '--bg-primary': '#292d3e', '--bg-secondary': '#2f3347', '--bg-tertiary': '#34394f',
      '--bg-hover': '#34394f', '--bg-contrast': '#232637',
      '--text-primary': '#babed8', '--text-secondary': '#8796b0', '--text-muted': '#676e95', '--text-disabled': '#4b5168',
      '--border': '#383c50', '--accent': '#c792ea', '--success': '#c3e88d', '--warning': '#ffcb6b', '--error': '#f07178',
      '--chart-1': '#c792ea', '--chart-2': '#82aaff', '--chart-3': '#c3e88d', '--chart-4': '#ffcb6b', '--chart-5': '#f07178', '--chart-6': '#89ddff',
      '--chart-grid': '#383c50', '--chart-text': '#676e95', '--chart-tooltip-bg': '#2f3347', '--chart-tooltip-border': '#383c50',
    },
  },
  {
    id: 'bluloco-dark', name: 'Bluloco Dark', mode: 'dark',
    vars: {
      '--bg-primary': '#282c34', '--bg-secondary': '#21252b', '--bg-tertiary': '#2c313c',
      '--bg-hover': '#2c313c', '--bg-contrast': '#1b1f27',
      '--text-primary': '#abb2bf', '--text-secondary': '#8b95a7', '--text-muted': '#636d83', '--text-disabled': '#3e4451',
      '--border': '#3e4451', '--accent': '#3691ff', '--success': '#3fc56b', '--warning': '#f9c859', '--error': '#ff6480',
      '--chart-1': '#3691ff', '--chart-2': '#10b1fe', '--chart-3': '#3fc56b', '--chart-4': '#f9c859', '--chart-5': '#ff6480', '--chart-6': '#ce9887',
      '--chart-grid': '#3e4451', '--chart-text': '#636d83', '--chart-tooltip-bg': '#21252b', '--chart-tooltip-border': '#3e4451',
    },
  },
  {
    id: 'ayu-mirage', name: 'Ayu Mirage', mode: 'dark',
    vars: {
      '--bg-primary': '#1f2430', '--bg-secondary': '#232834', '--bg-tertiary': '#2a2f3c',
      '--bg-hover': '#2a2f3c', '--bg-contrast': '#1a1e29',
      '--text-primary': '#cbccc6', '--text-secondary': '#9a9b95', '--text-muted': '#6c6e74', '--text-disabled': '#464a54',
      '--border': '#33384a', '--accent': '#ffcc66', '--success': '#bae67e', '--warning': '#ffd580', '--error': '#f28779',
      '--chart-1': '#ffcc66', '--chart-2': '#73d0ff', '--chart-3': '#bae67e', '--chart-4': '#ffd580', '--chart-5': '#f28779', '--chart-6': '#d4bfff',
      '--chart-grid': '#33384a', '--chart-text': '#6c6e74', '--chart-tooltip-bg': '#232834', '--chart-tooltip-border': '#33384a',
    },
  },
  {
    id: 'oh-lucy-dark', name: 'Oh Lucy Dark', mode: 'dark',
    vars: {
      '--bg-primary': '#1b1d26', '--bg-secondary': '#232530', '--bg-tertiary': '#2a2c38',
      '--bg-hover': '#2a2c38', '--bg-contrast': '#15171e',
      '--text-primary': '#dfdfe0', '--text-secondary': '#a5a5a6', '--text-muted': '#6e6f73', '--text-disabled': '#44454a',
      '--border': '#353741', '--accent': '#ff7eb6', '--success': '#79dfc1', '--warning': '#ffc799', '--error': '#ff6e6e',
      '--chart-1': '#ff7eb6', '--chart-2': '#78a9ff', '--chart-3': '#79dfc1', '--chart-4': '#ffc799', '--chart-5': '#ff6e6e', '--chart-6': '#d4bbff',
      '--chart-grid': '#353741', '--chart-text': '#6e6f73', '--chart-tooltip-bg': '#232530', '--chart-tooltip-border': '#353741',
    },
  },
  {
    id: 'material-darker', name: 'Material Darker', mode: 'dark',
    vars: {
      '--bg-primary': '#212121', '--bg-secondary': '#1a1a1a', '--bg-tertiary': '#2b2b2b',
      '--bg-hover': '#2b2b2b', '--bg-contrast': '#171717',
      '--text-primary': '#eeffff', '--text-secondary': '#9e9e9e', '--text-muted': '#616161', '--text-disabled': '#424242',
      '--border': '#353535', '--accent': '#82aaff', '--success': '#c3e88d', '--warning': '#ffcb6b', '--error': '#f07178',
      '--chart-1': '#82aaff', '--chart-2': '#89ddff', '--chart-3': '#c3e88d', '--chart-4': '#ffcb6b', '--chart-5': '#f07178', '--chart-6': '#c792ea',
      '--chart-grid': '#353535', '--chart-text': '#616161', '--chart-tooltip-bg': '#1a1a1a', '--chart-tooltip-border': '#353535',
    },
  },
  {
    id: 'houston', name: 'Houston', mode: 'dark',
    vars: {
      '--bg-primary': '#17191e', '--bg-secondary': '#1c1e25', '--bg-tertiary': '#242730',
      '--bg-hover': '#242730', '--bg-contrast': '#111318',
      '--text-primary': '#dee2e6', '--text-secondary': '#8b929a', '--text-muted': '#5c636c', '--text-disabled': '#3a3f48',
      '--border': '#2d3039', '--accent': '#4cc9f0', '--success': '#51cf66', '--warning': '#fcc419', '--error': '#ff6b6b',
      '--chart-1': '#4cc9f0', '--chart-2': '#7950f2', '--chart-3': '#51cf66', '--chart-4': '#fcc419', '--chart-5': '#ff6b6b', '--chart-6': '#f783ac',
      '--chart-grid': '#2d3039', '--chart-text': '#5c636c', '--chart-tooltip-bg': '#1c1e25', '--chart-tooltip-border': '#2d3039',
    },
  },
  {
    id: 'one-candy-dark', name: 'One Candy Dark', mode: 'dark',
    vars: {
      '--bg-primary': '#1e2030', '--bg-secondary': '#232538', '--bg-tertiary': '#2a2c42',
      '--bg-hover': '#2a2c42', '--bg-contrast': '#181a2a',
      '--text-primary': '#c8cedc', '--text-secondary': '#8990a7', '--text-muted': '#5f657a', '--text-disabled': '#414660',
      '--border': '#363a52', '--accent': '#f5a9b8', '--success': '#a6da95', '--warning': '#eed49f', '--error': '#ed8796',
      '--chart-1': '#f5a9b8', '--chart-2': '#8aadf4', '--chart-3': '#a6da95', '--chart-4': '#eed49f', '--chart-5': '#ed8796', '--chart-6': '#c6a0f6',
      '--chart-grid': '#363a52', '--chart-text': '#5f657a', '--chart-tooltip-bg': '#232538', '--chart-tooltip-border': '#363a52',
    },
  },
  {
    id: 'moonlight-ii', name: 'Moonlight II', mode: 'dark',
    vars: {
      '--bg-primary': '#222436', '--bg-secondary': '#1e2030', '--bg-tertiary': '#2f334d',
      '--bg-hover': '#2f334d', '--bg-contrast': '#191a2a',
      '--text-primary': '#c8d3f5', '--text-secondary': '#8b95c9', '--text-muted': '#636da6', '--text-disabled': '#444a73',
      '--border': '#3e4362', '--accent': '#c099ff', '--success': '#c3e88d', '--warning': '#ffc777', '--error': '#ff757f',
      '--chart-1': '#c099ff', '--chart-2': '#82aaff', '--chart-3': '#c3e88d', '--chart-4': '#ffc777', '--chart-5': '#ff757f', '--chart-6': '#86e1fc',
      '--chart-grid': '#3e4362', '--chart-text': '#636da6', '--chart-tooltip-bg': '#1e2030', '--chart-tooltip-border': '#3e4362',
    },
  },
  {
    id: 'one-monokai', name: 'One Monokai', mode: 'dark',
    vars: {
      '--bg-primary': '#282c34', '--bg-secondary': '#21252b', '--bg-tertiary': '#333842',
      '--bg-hover': '#333842', '--bg-contrast': '#1e2127',
      '--text-primary': '#abb2bf', '--text-secondary': '#8c939e', '--text-muted': '#636b78', '--text-disabled': '#434a56',
      '--border': '#3e4452', '--accent': '#e5c07b', '--success': '#98c379', '--warning': '#e5c07b', '--error': '#e06c75',
      '--chart-1': '#e5c07b', '--chart-2': '#61afef', '--chart-3': '#98c379', '--chart-4': '#d19a66', '--chart-5': '#e06c75', '--chart-6': '#c678dd',
      '--chart-grid': '#3e4452', '--chart-text': '#636b78', '--chart-tooltip-bg': '#21252b', '--chart-tooltip-border': '#3e4452',
    },
  },
  {
    id: 'palenight', name: 'Palenight', mode: 'dark',
    vars: {
      '--bg-primary': '#292d3e', '--bg-secondary': '#242837', '--bg-tertiary': '#32374d',
      '--bg-hover': '#32374d', '--bg-contrast': '#1f2233',
      '--text-primary': '#a6accd', '--text-secondary': '#7982a9', '--text-muted': '#5c6393', '--text-disabled': '#444b6e',
      '--border': '#3a3f58', '--accent': '#c792ea', '--success': '#c3e88d', '--warning': '#ffcb6b', '--error': '#ff5370',
      '--chart-1': '#c792ea', '--chart-2': '#82aaff', '--chart-3': '#c3e88d', '--chart-4': '#ffcb6b', '--chart-5': '#ff5370', '--chart-6': '#89ddff',
      '--chart-grid': '#3a3f58', '--chart-text': '#5c6393', '--chart-tooltip-bg': '#242837', '--chart-tooltip-border': '#3a3f58',
    },
  },
  {
    id: 'one-dark-pro-flat', name: 'One Dark Pro Flat', mode: 'dark',
    vars: {
      '--bg-primary': '#282c34', '--bg-secondary': '#282c34', '--bg-tertiary': '#31353f',
      '--bg-hover': '#31353f', '--bg-contrast': '#22262e',
      '--text-primary': '#abb2bf', '--text-secondary': '#848da0', '--text-muted': '#5c6370', '--text-disabled': '#3e4452',
      '--border': '#3e4452', '--accent': '#61afef', '--success': '#98c379', '--warning': '#e5c07b', '--error': '#e06c75',
      '--chart-1': '#61afef', '--chart-2': '#c678dd', '--chart-3': '#98c379', '--chart-4': '#e5c07b', '--chart-5': '#e06c75', '--chart-6': '#56b6c2',
      '--chart-grid': '#3e4452', '--chart-text': '#5c6370', '--chart-tooltip-bg': '#282c34', '--chart-tooltip-border': '#3e4452',
    },
  },
  {
    id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato', mode: 'dark',
    vars: {
      '--bg-primary': '#24273a', '--bg-secondary': '#1e2030', '--bg-tertiary': '#363a4f',
      '--bg-hover': '#363a4f', '--bg-contrast': '#181926',
      '--text-primary': '#cad3f5', '--text-secondary': '#a5adcb', '--text-muted': '#6e738d', '--text-disabled': '#494d64',
      '--border': '#494d64', '--accent': '#c6a0f6', '--success': '#a6da95', '--warning': '#eed49f', '--error': '#ed8796',
      '--chart-1': '#c6a0f6', '--chart-2': '#8aadf4', '--chart-3': '#a6da95', '--chart-4': '#eed49f', '--chart-5': '#ed8796', '--chart-6': '#8bd5ca',
      '--chart-grid': '#494d64', '--chart-text': '#6e738d', '--chart-tooltip-bg': '#1e2030', '--chart-tooltip-border': '#494d64',
    },
  },
  {
    id: 'catppuccin-frappe', name: 'Catppuccin Frapp\u00e9', mode: 'dark',
    vars: {
      '--bg-primary': '#303446', '--bg-secondary': '#292c3c', '--bg-tertiary': '#414559',
      '--bg-hover': '#414559', '--bg-contrast': '#232634',
      '--text-primary': '#c6d0f5', '--text-secondary': '#a5adce', '--text-muted': '#737994', '--text-disabled': '#51576d',
      '--border': '#51576d', '--accent': '#ca9ee6', '--success': '#a6d189', '--warning': '#e5c890', '--error': '#e78284',
      '--chart-1': '#ca9ee6', '--chart-2': '#8caaee', '--chart-3': '#a6d189', '--chart-4': '#e5c890', '--chart-5': '#e78284', '--chart-6': '#81c8be',
      '--chart-grid': '#51576d', '--chart-text': '#737994', '--chart-tooltip-bg': '#292c3c', '--chart-tooltip-border': '#51576d',
    },
  },
  {
    id: 'github-dark-dimmed', name: 'GitHub Dark Dimmed', mode: 'dark',
    vars: {
      '--bg-primary': '#22272e', '--bg-secondary': '#2d333b', '--bg-tertiary': '#373e47',
      '--bg-hover': '#373e47', '--bg-contrast': '#1c2128',
      '--text-primary': '#adbac7', '--text-secondary': '#768390', '--text-muted': '#636e7b', '--text-disabled': '#444c56',
      '--border': '#444c56', '--accent': '#539bf5', '--success': '#57ab5a', '--warning': '#c69026', '--error': '#e5534b',
      '--chart-1': '#539bf5', '--chart-2': '#986ee2', '--chart-3': '#57ab5a', '--chart-4': '#c69026', '--chart-5': '#e5534b', '--chart-6': '#6cb6ff',
      '--chart-grid': '#444c56', '--chart-text': '#636e7b', '--chart-tooltip-bg': '#2d333b', '--chart-tooltip-border': '#444c56',
    },
  },
  {
    id: 'slate', name: 'Slate', mode: 'dark',
    vars: {
      '--bg-primary': '#0f172a', '--bg-secondary': '#1e293b', '--bg-tertiary': '#273548',
      '--bg-hover': '#273548', '--bg-contrast': '#0b1120',
      '--text-primary': '#e2e8f0', '--text-secondary': '#94a3b8', '--text-muted': '#64748b', '--text-disabled': '#475569',
      '--border': '#334155', '--accent': '#60a5fa', '--success': '#4ade80', '--warning': '#fbbf24', '--error': '#f87171',
      '--chart-1': '#60a5fa', '--chart-2': '#f472b6', '--chart-3': '#4ade80', '--chart-4': '#fbbf24', '--chart-5': '#fb923c', '--chart-6': '#a78bfa',
      '--chart-grid': '#334155', '--chart-text': '#64748b', '--chart-tooltip-bg': '#1e293b', '--chart-tooltip-border': '#334155',
    },
  },
  {
    id: 'fog', name: 'Fog', mode: 'dark',
    vars: {
      '--bg-primary': '#111418', '--bg-secondary': '#191d22', '--bg-tertiary': '#22272e',
      '--bg-hover': '#22272e', '--bg-contrast': '#0c0e12',
      '--text-primary': '#d0d7de', '--text-secondary': '#8b949e', '--text-muted': '#636e7b', '--text-disabled': '#444c56',
      '--border': '#2d333b', '--accent': '#90a4ae', '--success': '#57ab5a', '--warning': '#c69026', '--error': '#e5534b',
      '--chart-1': '#6699cc', '--chart-2': '#ee8866', '--chart-3': '#44bb99', '--chart-4': '#eecc66', '--chart-5': '#ee99aa', '--chart-6': '#bbcc33',
      '--chart-grid': '#2d333b', '--chart-text': '#636e7b', '--chart-tooltip-bg': '#191d22', '--chart-tooltip-border': '#2d333b',
    },
  },
  {
    id: 'carbon', name: 'Carbon', mode: 'dark',
    vars: {
      '--bg-primary': '#161616', '--bg-secondary': '#1c1c1c', '--bg-tertiary': '#262626',
      '--bg-hover': '#262626', '--bg-contrast': '#0e0e0e',
      '--text-primary': '#f4f4f4', '--text-secondary': '#a8a8a8', '--text-muted': '#6f6f6f', '--text-disabled': '#525252',
      '--border': '#393939', '--accent': '#0f62fe', '--success': '#24a148', '--warning': '#f1c21b', '--error': '#da1e28',
      '--chart-1': '#4589ff', '--chart-2': '#ee5396', '--chart-3': '#42be65', '--chart-4': '#f1c21b', '--chart-5': '#ff832b', '--chart-6': '#a56eff',
      '--chart-grid': '#393939', '--chart-text': '#6f6f6f', '--chart-tooltip-bg': '#1c1c1c', '--chart-tooltip-border': '#393939',
    },
  },
  {
    id: 'ink', name: 'Ink', mode: 'dark',
    vars: {
      '--bg-primary': '#111217', '--bg-secondary': '#181920', '--bg-tertiary': '#21222c',
      '--bg-hover': '#21222c', '--bg-contrast': '#0b0c10',
      '--text-primary': '#d6d8e1', '--text-secondary': '#8f91a4', '--text-muted': '#5f6178', '--text-disabled': '#404254',
      '--border': '#2c2d3a', '--accent': '#818cf8', '--success': '#6ee7b7', '--warning': '#fcd34d', '--error': '#fca5a5',
      '--chart-1': '#818cf8', '--chart-2': '#f472b6', '--chart-3': '#34d399', '--chart-4': '#fbbf24', '--chart-5': '#fb7185', '--chart-6': '#22d3ee',
      '--chart-grid': '#2c2d3a', '--chart-text': '#5f6178', '--chart-tooltip-bg': '#181920', '--chart-tooltip-border': '#2c2d3a',
    },
  },
  {
    id: 'neon-teal', name: 'Neon Teal', mode: 'dark',
    vars: {
      '--bg-primary': '#090c10', '--bg-secondary': '#0f1318', '--bg-tertiary': '#171c23',
      '--bg-hover': '#171c23', '--bg-contrast': '#05080b',
      '--text-primary': '#cdd6e0', '--text-secondary': '#7e8c9c', '--text-muted': '#546270', '--text-disabled': '#384450',
      '--border': '#1e2830', '--accent': '#22d3ee', '--success': '#4ade80', '--warning': '#fbbf24', '--error': '#f87171',
      '--chart-1': '#22d3ee', '--chart-2': '#a78bfa', '--chart-3': '#4ade80', '--chart-4': '#fbbf24', '--chart-5': '#f87171', '--chart-6': '#f472b6',
      '--chart-grid': '#1e2830', '--chart-text': '#546270', '--chart-tooltip-bg': '#0f1318', '--chart-tooltip-border': '#1e2830',
    },
  },
];

export const lightThemes: ThemeDef[] = [
  {
    id: 'github-light', name: 'GitHub Light', mode: 'light',
    vars: {
      '--bg-primary': '#ffffff', '--bg-secondary': '#f6f8fa', '--bg-tertiary': '#eef1f5',
      '--bg-hover': '#eef1f5', '--bg-contrast': '#dfe3e8',
      '--text-primary': '#24292f', '--text-secondary': '#57606a', '--text-muted': '#8b949e', '--text-disabled': '#c5cdd5',
      '--border': '#d0d7de', '--accent': '#0969da', '--success': '#1a7f37', '--warning': '#9a6700', '--error': '#cf222e',
      '--chart-1': '#0969da', '--chart-2': '#8250df', '--chart-3': '#1a7f37', '--chart-4': '#bf8700', '--chart-5': '#cf222e', '--chart-6': '#0550ae',
      '--chart-grid': '#d8dee4', '--chart-text': '#8b949e', '--chart-tooltip-bg': '#ffffff', '--chart-tooltip-border': '#d0d7de',
    },
  },
  {
    id: 'atom-one-light', name: 'Atom One Light', mode: 'light',
    vars: {
      '--bg-primary': '#fafafa', '--bg-secondary': '#f0f0f0', '--bg-tertiary': '#e5e5e5',
      '--bg-hover': '#e5e5e5', '--bg-contrast': '#dbdbdb',
      '--text-primary': '#383a42', '--text-secondary': '#696c77', '--text-muted': '#a0a1a7', '--text-disabled': '#c8c8cc',
      '--border': '#d3d3d6', '--accent': '#4078f2', '--success': '#50a14f', '--warning': '#c18401', '--error': '#e45649',
      '--chart-1': '#4078f2', '--chart-2': '#a626a4', '--chart-3': '#50a14f', '--chart-4': '#c18401', '--chart-5': '#e45649', '--chart-6': '#0184bc',
      '--chart-grid': '#d3d3d6', '--chart-text': '#a0a1a7', '--chart-tooltip-bg': '#ffffff', '--chart-tooltip-border': '#d3d3d6',
    },
  },
  {
    id: 'brackets-light', name: 'Brackets Light', mode: 'light',
    vars: {
      '--bg-primary': '#f8f8f8', '--bg-secondary': '#ffffff', '--bg-tertiary': '#eeeeee',
      '--bg-hover': '#eeeeee', '--bg-contrast': '#e3e3e3',
      '--text-primary': '#333333', '--text-secondary': '#666666', '--text-muted': '#999999', '--text-disabled': '#cccccc',
      '--border': '#d9d9d9', '--accent': '#446fbd', '--success': '#409b41', '--warning': '#b58900', '--error': '#dc3032',
      '--chart-1': '#446fbd', '--chart-2': '#8757ad', '--chart-3': '#409b41', '--chart-4': '#b58900', '--chart-5': '#dc3032', '--chart-6': '#1d99c7',
      '--chart-grid': '#e0e0e0', '--chart-text': '#999999', '--chart-tooltip-bg': '#ffffff', '--chart-tooltip-border': '#d9d9d9',
    },
  },
  {
    id: 'bluloco-light', name: 'Bluloco Light', mode: 'light',
    vars: {
      '--bg-primary': '#f9f9f9', '--bg-secondary': '#f0f2f5', '--bg-tertiary': '#e4e7ed',
      '--bg-hover': '#e4e7ed', '--bg-contrast': '#d9dce3',
      '--text-primary': '#373737', '--text-secondary': '#626262', '--text-muted': '#9a9a9a', '--text-disabled': '#c8c8c8',
      '--border': '#d4d5d6', '--accent': '#275fe4', '--success': '#23974a', '--warning': '#c4760d', '--error': '#d52753',
      '--chart-1': '#275fe4', '--chart-2': '#7c4dff', '--chart-3': '#23974a', '--chart-4': '#c4760d', '--chart-5': '#d52753', '--chart-6': '#0099e1',
      '--chart-grid': '#d8d9da', '--chart-text': '#9a9a9a', '--chart-tooltip-bg': '#ffffff', '--chart-tooltip-border': '#d4d5d6',
    },
  },
  {
    id: 'material-lighter', name: 'Material Lighter', mode: 'light',
    vars: {
      '--bg-primary': '#fafafa', '--bg-secondary': '#ffffff', '--bg-tertiary': '#eef0f2',
      '--bg-hover': '#eef0f2', '--bg-contrast': '#e3e5e8',
      '--text-primary': '#546e7a', '--text-secondary': '#7b8c98', '--text-muted': '#a0adb6', '--text-disabled': '#c8d0d5',
      '--border': '#d5dbe0', '--accent': '#7c4dff', '--success': '#91b859', '--warning': '#f6a434', '--error': '#e53935',
      '--chart-1': '#7c4dff', '--chart-2': '#39adb5', '--chart-3': '#91b859', '--chart-4': '#f6a434', '--chart-5': '#e53935', '--chart-6': '#6182b8',
      '--chart-grid': '#dde1e5', '--chart-text': '#a0adb6', '--chart-tooltip-bg': '#ffffff', '--chart-tooltip-border': '#d5dbe0',
    },
  },
  {
    id: 'catppuccin-latte', name: 'Catppuccin Latte', mode: 'light',
    vars: {
      '--bg-primary': '#eff1f5', '--bg-secondary': '#e6e9ef', '--bg-tertiary': '#dce0e8',
      '--bg-hover': '#dce0e8', '--bg-contrast': '#ccd0da',
      '--text-primary': '#4c4f69', '--text-secondary': '#6c6f85', '--text-muted': '#9ca0b0', '--text-disabled': '#bcc0cc',
      '--border': '#ccd0da', '--accent': '#8839ef', '--success': '#40a02b', '--warning': '#df8e1d', '--error': '#d20f39',
      '--chart-1': '#8839ef', '--chart-2': '#1e66f5', '--chart-3': '#40a02b', '--chart-4': '#df8e1d', '--chart-5': '#d20f39', '--chart-6': '#179299',
      '--chart-grid': '#ccd0da', '--chart-text': '#9ca0b0', '--chart-tooltip-bg': '#eff1f5', '--chart-tooltip-border': '#ccd0da',
    },
  },
  {
    id: 'dracula-soft-light', name: 'Dracula Soft Light', mode: 'light',
    vars: {
      '--bg-primary': '#f5f2f8', '--bg-secondary': '#ece8f2', '--bg-tertiary': '#e0dce9',
      '--bg-hover': '#e0dce9', '--bg-contrast': '#d5d0de',
      '--text-primary': '#44405a', '--text-secondary': '#6e6a82', '--text-muted': '#9a96ad', '--text-disabled': '#bfbccc',
      '--border': '#d0cce0', '--accent': '#8c6ec7', '--success': '#50a87b', '--warning': '#c4a23e', '--error': '#c4525a',
      '--chart-1': '#8c6ec7', '--chart-2': '#5aaab8', '--chart-3': '#50a87b', '--chart-4': '#c4a23e', '--chart-5': '#c4525a', '--chart-6': '#c77fa0',
      '--chart-grid': '#d0cce0', '--chart-text': '#9a96ad', '--chart-tooltip-bg': '#f5f2f8', '--chart-tooltip-border': '#d0cce0',
    },
  },
  {
    id: 'nord-light', name: 'Nord Light', mode: 'light',
    vars: {
      '--bg-primary': '#eceff4', '--bg-secondary': '#e5e9f0', '--bg-tertiary': '#d8dee9',
      '--bg-hover': '#d8dee9', '--bg-contrast': '#cdd3de',
      '--text-primary': '#3b4252', '--text-secondary': '#5e6a82', '--text-muted': '#8892a4', '--text-disabled': '#b0b7c4',
      '--border': '#c8ced9', '--accent': '#5e81ac', '--success': '#6a9e5a', '--warning': '#bf8c2e', '--error': '#a84a52',
      '--chart-1': '#5e81ac', '--chart-2': '#6ba0b0', '--chart-3': '#6a9e5a', '--chart-4': '#bf8c2e', '--chart-5': '#a84a52', '--chart-6': '#8e6da0',
      '--chart-grid': '#c8ced9', '--chart-text': '#8892a4', '--chart-tooltip-bg': '#eceff4', '--chart-tooltip-border': '#c8ced9',
    },
  },
  {
    id: 'github-light-default', name: 'GitHub Light Default', mode: 'light',
    vars: {
      '--bg-primary': '#f6f8fa', '--bg-secondary': '#ffffff', '--bg-tertiary': '#eaeef2',
      '--bg-hover': '#eaeef2', '--bg-contrast': '#d8dee4',
      '--text-primary': '#1f2328', '--text-secondary': '#656d76', '--text-muted': '#8c959f', '--text-disabled': '#bcc3cb',
      '--border': '#d1d9e0', '--accent': '#0969da', '--success': '#1a7f37', '--warning': '#9a6700', '--error': '#d1242f',
      '--chart-1': '#0969da', '--chart-2': '#8250df', '--chart-3': '#1a7f37', '--chart-4': '#bf8700', '--chart-5': '#d1242f', '--chart-6': '#0550ae',
      '--chart-grid': '#d8dee4', '--chart-text': '#8c959f', '--chart-tooltip-bg': '#ffffff', '--chart-tooltip-border': '#d1d9e0',
    },
  },
  {
    id: 'houston-light', name: 'Houston Light', mode: 'light',
    vars: {
      '--bg-primary': '#f2f3f5', '--bg-secondary': '#e9eaed', '--bg-tertiary': '#dddee2',
      '--bg-hover': '#dddee2', '--bg-contrast': '#d0d1d6',
      '--text-primary': '#2c2e33', '--text-secondary': '#5c5f68', '--text-muted': '#8a8d96', '--text-disabled': '#b5b7bc',
      '--border': '#c8c9cf', '--accent': '#2ba5c7', '--success': '#38a64f', '--warning': '#c4960d', '--error': '#c44a4a',
      '--chart-1': '#2ba5c7', '--chart-2': '#5e3dc7', '--chart-3': '#38a64f', '--chart-4': '#c4960d', '--chart-5': '#c44a4a', '--chart-6': '#c75a8a',
      '--chart-grid': '#c8c9cf', '--chart-text': '#8a8d96', '--chart-tooltip-bg': '#f2f3f5', '--chart-tooltip-border': '#c8c9cf',
    },
  },
  {
    id: 'one-candy-light', name: 'One Candy Light', mode: 'light',
    vars: {
      '--bg-primary': '#eff1f5', '--bg-secondary': '#e6e8ee', '--bg-tertiary': '#dcdee6',
      '--bg-hover': '#dcdee6', '--bg-contrast': '#d0d2db',
      '--text-primary': '#3e4058', '--text-secondary': '#6a6c82', '--text-muted': '#9698ae', '--text-disabled': '#babccc',
      '--border': '#cccee0', '--accent': '#c05a82', '--success': '#5a9e40', '--warning': '#bf8a2b', '--error': '#bf4a55',
      '--chart-1': '#c05a82', '--chart-2': '#5580c4', '--chart-3': '#5a9e40', '--chart-4': '#bf8a2b', '--chart-5': '#bf4a55', '--chart-6': '#8a6aaa',
      '--chart-grid': '#cccee0', '--chart-text': '#9698ae', '--chart-tooltip-bg': '#eff1f5', '--chart-tooltip-border': '#cccee0',
    },
  },
  {
    id: 'graphite', name: 'Graphite', mode: 'light',
    vars: {
      '--bg-primary': '#f1f3f5', '--bg-secondary': '#f8f9fa', '--bg-tertiary': '#e5e7eb',
      '--bg-hover': '#e5e7eb', '--bg-contrast': '#d1d5db',
      '--text-primary': '#1f2937', '--text-secondary': '#4b5563', '--text-muted': '#6b7280', '--text-disabled': '#9ca3af',
      '--border': '#d1d5db', '--accent': '#4b5563', '--success': '#16a34a', '--warning': '#ca8a04', '--error': '#dc2626',
      '--chart-1': '#4e79a7', '--chart-2': '#e15759', '--chart-3': '#59a14f', '--chart-4': '#f28e2c', '--chart-5': '#af7aa1', '--chart-6': '#76b7b2',
      '--chart-grid': '#d1d5db', '--chart-text': '#9ca3af', '--chart-tooltip-bg': '#f8f9fa', '--chart-tooltip-border': '#d1d5db',
    },
  },
];

const byName = (a: ThemeDef, b: ThemeDef) => a.name.localeCompare(b.name);
darkThemes.sort(byName);
lightThemes.sort(byName);

export const allThemes: ThemeDef[] = [...darkThemes, ...lightThemes];

export function findTheme(id: string): ThemeDef | undefined {
  return allThemes.find((t) => t.id === id);
}

export const DEFAULT_DARK = 'material-palenight';
export const DEFAULT_LIGHT = 'github-light';
