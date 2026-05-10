import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { Icon } from '../ui/Icon';

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

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Life',
    items: [
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
  },
  {
    label: 'Research',
    items: [
      {
        to: '/research',
        label: 'Research',
        icon: 'search',
        children: [
          { to: '/research/history', label: 'History', icon: 'history' },
          { to: '/research/workers', label: 'Workers', icon: 'engineering' },
          { to: '/research/config', label: 'Providers', icon: 'tune' },
        ],
      },
    ],
  },
  {
    label: 'Observability',
    items: [
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
          { to: '/observability/signals', label: 'Signals', icon: 'bolt', separator: 'before' },
          { to: '/observability/memory', label: 'Memory', icon: 'memory' },
          { to: '/observability/db', label: 'Database', icon: 'storage' },
        ],
      },
    ],
  },
  {
    label: 'Evaluation',
    items: [
      {
        to: '/observability/evals',
        label: 'Evals',
        icon: 'science',
      },
    ],
  },
];

const settingsItem = {
  to: '/settings',
  label: 'Settings',
  icon: 'settings',
};

const ICON_PX = 'text-[20px]';

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
          'flex items-center gap-2.5 min-h-[32px] py-1 text-[14px] font-sans cursor-not-allowed',
          depth > 0 ? 'pl-5 pr-2' : 'pl-2 pr-2',
          'text-text-muted opacity-40'
        )}
        title={collapsed ? label : undefined}
      >
        {icon && <Icon name={icon} className={ICON_PX} />}
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
          'flex items-center gap-2.5 min-h-[32px] py-1 text-[14px] font-sans transition-colors rounded',
          depth > 0 ? 'pl-5 pr-2' : 'pl-2 pr-2',
          isActive
            ? isGroupHeader
              ? 'text-accent font-medium'
              : depth > 0
                ? 'bg-accent/15 text-accent font-medium'
                : 'bg-accent/15 text-accent font-medium'
            : depth > 0
              ? 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
        )
      }
      title={collapsed ? label : undefined}
    >
      {icon && <Icon name={icon} className={ICON_PX} />}
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

function BrandMark() {
  return (
    <div
      className="grid place-items-center w-9 h-9 rounded-md bg-bg-tertiary font-heading font-black text-accent text-lg shrink-0"
      aria-label="Construct"
    >
      C
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const allItems = navGroups.flatMap((g) => g.items);

  return (
    <aside
      className={clsx(
        'flex flex-col border-r border-border-primary bg-bg-secondary transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-[220px]'
      )}
    >
      {/* Header / brand */}
      <div className={clsx(
        'flex h-14 items-center border-b border-border-primary',
        collapsed ? 'flex-col gap-1.5 justify-center px-2' : 'justify-between px-3'
      )}>
        {collapsed ? (
          <NavLink to="/" title="Construct"><BrandMark /></NavLink>
        ) : (
          <NavLink to="/" className="flex items-center gap-2.5 min-w-0">
            <BrandMark />
            <span className="font-heading text-2xl font-bold leading-tight text-text-primary truncate">construct</span>
          </NavLink>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center p-1 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'} size="sm" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {!collapsed && navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-2' : ''}>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted px-2 pt-3 pb-1">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
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
          </div>
        ))}

        {collapsed && (
          <div className="space-y-0.5">
            {allItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center justify-center p-2 rounded transition-colors',
                    item.disabled
                      ? 'text-text-muted opacity-40 cursor-not-allowed pointer-events-none'
                      : isActive
                        ? 'bg-accent/15 text-accent'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                  )
                }
                title={item.label}
              >
                <Icon name={item.icon} className={ICON_PX} />
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-border-primary px-2 py-2">
        <SidebarLink to={settingsItem.to} label={settingsItem.label} icon={settingsItem.icon} collapsed={collapsed} />
      </div>
    </aside>
  );
}
