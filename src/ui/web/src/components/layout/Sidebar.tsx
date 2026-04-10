import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { Icon } from '../ui/Icon';
import { useTheme, fonts } from '../../theme';
import { darkThemes, lightThemes, allThemes } from '../../themes';

interface NavChild {
  to: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  separator?: 'before';
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  children?: NavChild[];
  disabled?: boolean;
}

const navGroups: NavItem[][] = [
  [
    {
      to: '/summary',
      label: 'Life',
      icon: 'favorite',
      children: [
        { to: '/goals', label: 'Goals', icon: 'target' },
        { to: '/todos', label: 'Todos', icon: 'check_circle' },
        { to: '/habits', label: 'Habits', icon: 'autorenew' },
      ],
    },
  ],
  [
    {
      to: '/research',
      label: 'Research',
      icon: 'search',
      children: [
        { to: '/research/queries', label: 'Queries', icon: 'format_list_bulleted' },
        { to: '/research/monitors', label: 'Monitors', icon: 'notifications' },
      ],
    },
  ],
  [
    {
      to: '/observability',
      label: 'Observability',
      icon: 'visibility',
      children: [
        { to: '/observability/sessions', label: 'Sessions', icon: 'schedule' },
        { to: '/observability/skills', label: 'Skills', icon: 'auto_awesome' },
        { to: '/observability/tools', label: 'Tools', icon: 'build' },
        { to: '/observability/hooks', label: 'Hooks', icon: 'webhook' },
        { to: '/observability/events', label: 'Events', icon: 'event_note' },
        { to: '/observability/compaction', label: 'Compaction', icon: 'compress', disabled: true },
        { to: '/observability/memory', label: 'Memory', icon: 'memory', separator: 'before' },
        { to: '/observability/db', label: 'Database', icon: 'storage' },
      ],
    },
  ],
  [
    {
      to: '/observability/evals',
      label: 'Evals',
      disabled: true,
      icon: 'science',
    },
  ],
];

const settingsItem = {
  to: '/settings',
  label: 'Settings',
  icon: 'settings',
};

function SidebarLink({ to, label, icon, depth = 0, collapsed = false, disabled = false, isGroupHeader = false }: {
  to: string;
  label: string;
  icon?: string;
  depth?: number;
  collapsed?: boolean;
  disabled?: boolean;
  isGroupHeader?: boolean;
}) {
  if (disabled) {
    return (
      <div
        className={clsx(
          'flex items-center gap-2.5 py-1.5 text-base font-sans cursor-not-allowed',
          depth > 0 ? 'pl-5 pr-2.5' : 'pl-2.5 pr-2.5',
          'text-text-muted opacity-40'
        )}
        title={collapsed ? label : undefined}
      >
        {icon && <Icon name={icon} size={depth > 0 ? 'xs' : 'sm'} />}
        {!collapsed && <span className="truncate">{label}</span>}
      </div>
    );
  }

  return (
    <NavLink
      to={to}
      end={depth === 0}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2.5 py-1.5 text-base font-sans transition-colors',
          depth > 0 ? 'pl-5 pr-2.5' : 'pr-2.5',
          isActive
            ? isGroupHeader
              ? 'pl-2.5 text-accent font-medium'
              : depth > 0
                ? 'text-accent font-medium'
                : 'rounded-lg bg-accent text-white font-medium pl-2.5'
            : depth > 0
              ? 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary pl-5'
              : 'pl-2.5 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg'
        )
      }
      title={collapsed ? label : undefined}
    >
      {icon && <Icon name={icon} size={depth > 0 ? 'xs' : 'sm'} />}
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

function FontSelect({ collapsed }: { collapsed?: boolean }) {
  const { fontId, font, setFontId } = useTheme();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const cycleFont = (direction: 1 | -1) => {
    const idx = fonts.findIndex((f) => f.id === fontId);
    const next = (idx + direction + fonts.length) % fonts.length;
    setFontId(fonts[next].id);
  };

  useEffect(() => {
    if (open && listRef.current) {
      const active = listRef.current.querySelector(`[data-font-id="${fontId}"]`) as HTMLElement | null;
      if (active) active.scrollIntoView({ block: 'center' });
    }
  }, [open, fontId]);

  if (collapsed) {
    return (
      <button
        className="flex items-center justify-center w-full rounded-md px-2 py-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        title={font.name}
        onClick={() => cycleFont(1)}
      >
        <Icon name="text_fields" size="sm" />
      </button>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center">
        <button
          onClick={() => setOpen(!open)}
          className={clsx(
            'flex items-center gap-2.5 flex-1 min-w-0 rounded-md pl-2.5 pr-2 py-1.5 text-base font-sans transition-colors',
            'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
          )}
        >
          <Icon name="text_fields" size="sm" />
          <span className="truncate">{font.name}</span>
        </button>
        <button
          onClick={() => cycleFont(-1)}
          className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          title="Previous font"
        >
          <Icon name="chevron_left" size="xs" />
        </button>
        <button
          onClick={() => cycleFont(1)}
          className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          title="Next font"
        >
          <Icon name="chevron_right" size="xs" />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div ref={listRef} className="absolute bottom-full left-0 mb-1 w-56 max-h-80 overflow-y-auto z-50 rounded-lg border border-border-primary bg-bg-secondary shadow-lg">
            {fonts.map((f) => (
              <button
                key={f.id}
                data-font-id={f.id}
                onClick={() => { setFontId(f.id); setOpen(false); }}
                className={clsx(
                  'flex items-center w-full px-2 py-1.5 text-sm transition-colors',
                  f.id === fontId ? 'text-accent bg-bg-tertiary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                )}
                style={{ fontFamily: `${f.family}, system-ui, sans-serif` }}
              >
                {f.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ThemeSelect({ collapsed }: { collapsed?: boolean }) {
  const { themeId, theme, setThemeId } = useTheme();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const cycleTheme = (direction: 1 | -1) => {
    const idx = allThemes.findIndex((t) => t.id === themeId);
    const next = (idx + direction + allThemes.length) % allThemes.length;
    setThemeId(allThemes[next].id);
  };

  useEffect(() => {
    if (open && listRef.current) {
      const active = listRef.current.querySelector(`[data-theme-id="${themeId}"]`) as HTMLElement | null;
      if (active) active.scrollIntoView({ block: 'center' });
    }
  }, [open, themeId]);

  if (collapsed) {
    return (
      <button
        className="flex items-center justify-center w-full rounded-md px-2 py-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        title={theme.name}
        onClick={() => cycleTheme(1)}
      >
        <Icon name={theme.mode === 'dark' ? 'dark_mode' : 'light_mode'} size="sm" />
      </button>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center">
        <button
          onClick={() => setOpen(!open)}
          className={clsx(
            'flex items-center gap-2.5 flex-1 min-w-0 rounded-md pl-2.5 pr-2 py-1.5 text-base font-sans transition-colors',
            'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
          )}
        >
          <Icon name={theme.mode === 'dark' ? 'dark_mode' : 'light_mode'} size="sm" />
          <span className="truncate">{theme.name}</span>
        </button>
        <button
          onClick={() => cycleTheme(-1)}
          className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          title="Previous theme"
        >
          <Icon name="chevron_left" size="xs" />
        </button>
        <button
          onClick={() => cycleTheme(1)}
          className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          title="Next theme"
        >
          <Icon name="chevron_right" size="xs" />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div ref={listRef} className="absolute bottom-full left-0 mb-1 w-56 max-h-80 overflow-y-auto z-50 rounded-lg border border-border-primary bg-bg-secondary shadow-lg">
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Dark</div>
            {darkThemes.map((t) => (
              <button
                key={t.id}
                data-theme-id={t.id}
                onClick={() => { setThemeId(t.id); setOpen(false); }}
                className={clsx(
                  'flex items-center w-full px-2 py-1.5 text-sm transition-colors',
                  t.id === themeId ? 'text-accent bg-bg-tertiary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                )}
              >
                <span className="flex shrink-0 mr-2 rounded-sm overflow-hidden h-2.5" style={{ width: 20 }}>
                  {[t.vars['--accent'], t.vars['--chart-2'], t.vars['--chart-3'], t.vars['--chart-5']].map((c, i) => (
                    <span key={i} className="h-full" style={{ flex: 1, background: c }} />
                  ))}
                </span>
                {t.name}
              </button>
            ))}
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted border-t border-border-primary mt-1 pt-1.5">Light</div>
            {lightThemes.map((t) => (
              <button
                key={t.id}
                data-theme-id={t.id}
                onClick={() => { setThemeId(t.id); setOpen(false); }}
                className={clsx(
                  'flex items-center w-full px-2 py-1.5 text-sm transition-colors',
                  t.id === themeId ? 'text-accent bg-bg-tertiary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                )}
              >
                <span className="flex shrink-0 mr-2 rounded-sm overflow-hidden h-2.5" style={{ width: 20 }}>
                  {[t.vars['--accent'], t.vars['--chart-2'], t.vars['--chart-3'], t.vars['--chart-5']].map((c, i) => (
                    <span key={i} className="h-full" style={{ flex: 1, background: c }} />
                  ))}
                </span>
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const allItems = navGroups.flat();

  return (
    <aside
      className={clsx(
        'flex flex-col border-r border-border-primary bg-bg-secondary transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-60'
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border-primary px-3">
        {!collapsed && (
          <NavLink to="/" className="font-heading text-2xl leading-none font-bold text-text-primary">
            Construct
          </NavLink>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'} size="sm" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {!collapsed && navGroups.map((group, gi) => (
          <div key={gi}>
            {group.map((item) => {
              const isParentActive = location.pathname === item.to ||
                location.pathname.startsWith(item.to + '/') ||
                item.children?.some((c) => location.pathname === c.to || location.pathname.startsWith(c.to + '/'));
              return (
                <div key={item.to}>
                  <SidebarLink to={item.to} label={item.label} icon={item.icon} disabled={item.disabled} isGroupHeader={!!item.children?.length} />
                  {item.children && isParentActive && (
                    <div className="mt-0.5 space-y-0.5">
                      {item.children.map((child) => (
                        <div key={child.to}>
                          {child.separator === 'before' && <hr className="my-1.5 border-border-primary mx-5" />}
                          <SidebarLink to={child.to} label={child.label} icon={child.icon} depth={1} disabled={child.disabled} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {collapsed && allItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                'flex items-center justify-center p-2 transition-colors',
                item.disabled
                  ? 'text-text-muted opacity-40 cursor-not-allowed pointer-events-none'
                  : isActive
                    ? 'rounded-lg bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg'
              )
            }
            title={item.label}
          >
            <Icon name={item.icon} size="sm" />
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border-primary px-2 py-2 space-y-0.5">
        <SidebarLink to={settingsItem.to} label={settingsItem.label} icon={settingsItem.icon} collapsed={collapsed} />
        <FontSelect collapsed={collapsed} />
        <ThemeSelect collapsed={collapsed} />
      </div>
    </aside>
  );
}
