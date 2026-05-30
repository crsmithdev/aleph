/* ============================================================
   Theme picker — drop-in for any preview/kit.
   Usage:  <script src="../tokens/theme-picker.js"></script>
   Renders a small floating control bottom-right.
   Persists choice in localStorage under "aleph.themeId".
   Defaults to material-palenight (repo DEFAULT_DARK).
   ============================================================ */
(() => {
  const STORAGE_KEY = 'aleph.themeId';
  const DEFAULT_ID = 'material-palenight';

  // Embedded registry — kept in sync with tokens/themes.css
  const THEMES = [
    // Dark
    { id: 'ayu-mirage',           name: 'Ayu Mirage',            mode: 'dark' },
    { id: 'bluloco-dark',         name: 'Bluloco Dark',          mode: 'dark' },
    { id: 'carbon',               name: 'Carbon',                mode: 'dark' },
    { id: 'catppuccin-frappe',    name: 'Catppuccin Frappé',     mode: 'dark' },
    { id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato',  mode: 'dark' },
    { id: 'dracula',              name: 'Dracula',               mode: 'dark' },
    { id: 'fog',                  name: 'Fog',                   mode: 'dark' },
    { id: 'github-dark-dimmed',   name: 'GitHub Dark Dimmed',    mode: 'dark' },
    { id: 'houston',              name: 'Houston',               mode: 'dark' },
    { id: 'ink',                  name: 'Ink',                   mode: 'dark' },
    { id: 'material-darker',      name: 'Material Darker',       mode: 'dark' },
    { id: 'material-palenight',   name: 'Material Palenight',    mode: 'dark' },
    { id: 'moonlight-ii',         name: 'Moonlight II',          mode: 'dark' },
    { id: 'neon-teal',            name: 'Neon Teal',             mode: 'dark' },
    { id: 'nord',                 name: 'Nord',                  mode: 'dark' },
    { id: 'oh-lucy-dark',         name: 'Oh Lucy Dark',          mode: 'dark' },
    { id: 'one-candy-dark',       name: 'One Candy Dark',        mode: 'dark' },
    { id: 'one-dark-pro',         name: 'One Dark Pro',          mode: 'dark' },
    { id: 'one-dark-pro-flat',    name: 'One Dark Pro Flat',     mode: 'dark' },
    { id: 'one-monokai',          name: 'One Monokai',           mode: 'dark' },
    { id: 'palenight',            name: 'Palenight',             mode: 'dark' },
    { id: 'slate',                name: 'Slate',                 mode: 'dark' },
    // Light
    { id: 'atom-one-light',       name: 'Atom One Light',        mode: 'light' },
    { id: 'bluloco-light',        name: 'Bluloco Light',         mode: 'light' },
    { id: 'brackets-light',       name: 'Brackets Light',        mode: 'light' },
    { id: 'catppuccin-latte',     name: 'Catppuccin Latte',      mode: 'light' },
    { id: 'dracula-soft-light',   name: 'Dracula Soft Light',    mode: 'light' },
    { id: 'github-light',         name: 'GitHub Light',          mode: 'light' },
    { id: 'github-light-default', name: 'GitHub Light Default',  mode: 'light' },
    { id: 'graphite',             name: 'Graphite',              mode: 'light' },
    { id: 'houston-light',        name: 'Houston Light',         mode: 'light' },
    { id: 'material-lighter',     name: 'Material Lighter',      mode: 'light' },
    { id: 'nord-light',           name: 'Nord Light',            mode: 'light' },
    { id: 'one-candy-light',      name: 'One Candy Light',       mode: 'light' },
  ];

  function applyTheme(id) {
    const t = THEMES.find(x => x.id === id);
    if (!t) return;
    document.documentElement.setAttribute('data-theme-id', id);
    document.documentElement.setAttribute('data-theme', t.mode);
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  }

  function getInitialId() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && THEMES.some(t => t.id === stored)) return stored;
    } catch {}
    const docDefault = document.documentElement.getAttribute('data-theme-id');
    if (docDefault && THEMES.some(t => t.id === docDefault)) return docDefault;
    return DEFAULT_ID;
  }

  function buildSwatch(id) {
    // Compute swatch by reading vars from a probe element with the theme applied.
    const probe = document.createElement('div');
    probe.setAttribute('data-theme-id', id);
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const colors = [
      cs.getPropertyValue('--bg-primary').trim(),
      cs.getPropertyValue('--bg-secondary').trim(),
      cs.getPropertyValue('--accent').trim(),
      cs.getPropertyValue('--text-primary').trim(),
    ];
    probe.remove();
    return colors;
  }

  function renderPicker() {
    const root = document.createElement('div');
    root.id = 'tp-root';
    root.innerHTML = `
      <style>
        #tp-root { position: fixed; bottom: 20px; right: 20px; z-index: 9999; font-family: var(--font-sans, system-ui); }
        #tp-trigger {
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-secondary); color: var(--text-primary);
          border: 1px solid var(--border, var(--border-primary));
          border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        }
        #tp-trigger:hover { background: var(--bg-tertiary); }
        #tp-trigger .tp-dots { display: inline-flex; gap: 2px; }
        #tp-trigger .tp-dots span { width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--border, var(--border-primary)); }
        #tp-trigger .tp-name { font-weight: 500; }
        #tp-trigger .tp-mode { color: var(--text-muted); font-family: var(--font-mono, monospace); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
        #tp-panel {
          position: absolute; bottom: calc(100% + 8px); right: 0;
          width: 280px; max-height: 60vh; overflow-y: auto;
          background: var(--bg-secondary); border: 1px solid var(--border, var(--border-primary));
          border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,0.4);
          padding: 6px;
        }
        #tp-panel.hidden { display: none; }
        #tp-panel .tp-group { font-family: var(--font-mono, monospace); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 8px 8px 4px; }
        #tp-panel .tp-opt {
          display: flex; align-items: center; gap: 10px;
          padding: 6px 8px; border-radius: 4px; cursor: pointer;
          color: var(--text-secondary); font-size: 12px;
        }
        #tp-panel .tp-opt:hover { background: var(--bg-tertiary); color: var(--text-primary); }
        #tp-panel .tp-opt.active { background: var(--accent-muted, rgba(127,127,127,0.15)); color: var(--accent); }
        #tp-panel .tp-opt .tp-dots { display: inline-flex; gap: 2px; flex-shrink: 0; }
        #tp-panel .tp-opt .tp-dots span { width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--border, var(--border-primary)); }
        #tp-panel .tp-opt .tp-label { flex: 1; }
      </style>
      <button id="tp-trigger" type="button" aria-expanded="false">
        <span class="tp-dots" id="tp-current-dots"></span>
        <span class="tp-name" id="tp-current-name"></span>
        <span class="tp-mode" id="tp-current-mode"></span>
      </button>
      <div id="tp-panel" class="hidden" role="menu"></div>
    `;
    document.body.appendChild(root);

    const trigger = root.querySelector('#tp-trigger');
    const panel = root.querySelector('#tp-panel');
    const currentDots = root.querySelector('#tp-current-dots');
    const currentName = root.querySelector('#tp-current-name');
    const currentMode = root.querySelector('#tp-current-mode');

    function paintCurrent() {
      const id = document.documentElement.getAttribute('data-theme-id') || DEFAULT_ID;
      const t = THEMES.find(x => x.id === id);
      currentName.textContent = t ? t.name : id;
      currentMode.textContent = t ? t.mode : '';
      currentDots.innerHTML = '';
      buildSwatch(id).forEach(c => {
        const s = document.createElement('span');
        s.style.background = c;
        currentDots.appendChild(s);
      });
    }

    function paintPanel() {
      panel.innerHTML = '';
      const sections = [
        { label: 'Dark', items: THEMES.filter(t => t.mode === 'dark') },
        { label: 'Light', items: THEMES.filter(t => t.mode === 'light') },
      ];
      const active = document.documentElement.getAttribute('data-theme-id');
      for (const sec of sections) {
        const h = document.createElement('div');
        h.className = 'tp-group';
        h.textContent = sec.label + ` · ${sec.items.length}`;
        panel.appendChild(h);
        for (const t of sec.items) {
          const row = document.createElement('div');
          row.className = 'tp-opt' + (t.id === active ? ' active' : '');
          row.dataset.id = t.id;
          const dots = document.createElement('span');
          dots.className = 'tp-dots';
          buildSwatch(t.id).forEach(c => {
            const s = document.createElement('span');
            s.style.background = c;
            dots.appendChild(s);
          });
          const label = document.createElement('span');
          label.className = 'tp-label';
          label.textContent = t.name;
          row.appendChild(dots);
          row.appendChild(label);
          row.addEventListener('click', () => {
            applyTheme(t.id);
            paintCurrent();
            panel.querySelectorAll('.tp-opt').forEach(el => el.classList.toggle('active', el.dataset.id === t.id));
          });
          panel.appendChild(row);
        }
      }
    }

    trigger.addEventListener('click', () => {
      const open = panel.classList.toggle('hidden');
      trigger.setAttribute('aria-expanded', String(!open));
      if (!open) paintPanel();
    });

    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) panel.classList.add('hidden');
    });

    paintCurrent();
  }

  // Apply early to avoid FOUC
  applyTheme(getInitialId());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPicker);
  } else {
    renderPicker();
  }
})();
