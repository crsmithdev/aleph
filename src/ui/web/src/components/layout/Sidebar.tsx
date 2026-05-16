import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import { Icon } from '../ui/Icon';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  disabled?: boolean;
  separator?: 'before';
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Life',
    items: [
      { to: '/summary', label: 'Overview', icon: 'dashboard' },
      { to: '/goals', label: 'Goals', icon: 'target' },
      { to: '/todos', label: 'Todos', icon: 'check_circle' },
      { to: '/habits', label: 'Habits', icon: 'autorenew' },
    ],
  },
  {
    label: 'Research',
    items: [
      { to: '/research', label: 'Research', icon: 'dashboard' },
      { to: '/research/monitors', label: 'Monitors', icon: 'visibility' },
      { to: '/research/config', label: 'Providers', icon: 'tune' },
    ],
  },
  {
    label: 'Activity',
    items: [
      { to: '/observability', label: 'Overview', icon: 'dashboard' },
      { to: '/observability/sessions', label: 'Sessions', icon: 'schedule' },
      { to: '/observability/events', label: 'Events', icon: 'event_note' },
      { to: '/observability/tokens', label: 'Tokens & cost', icon: 'paid' },
    ],
  },
  {
    label: 'Capabilities',
    items: [
      { to: '/observability/skills', label: 'Skills', icon: 'auto_awesome' },
      { to: '/observability/tools', label: 'Tools', icon: 'build' },
      { to: '/observability/hooks', label: 'Hooks', icon: 'webhook' },
      { to: '/observability/subagents', label: 'Subagents', icon: 'smart_toy' },
      { to: '/observability/learning', label: 'Learning', icon: 'school' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/observability/db', label: 'Database', icon: 'storage' },
      { to: '/observability/memory', label: 'Memory', icon: 'memory' },
    ],
  },
];

const settingsItem: NavItem = {
  to: '/settings',
  label: 'Settings',
  icon: 'settings',
};

const ICON_PX = 'text-[20px]';

function SidebarLink({ to, label, icon, collapsed = false, disabled = false }: {
  to: string;
  label: string;
  icon: string;
  collapsed?: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div
        className="flex items-center gap-2.5 min-h-[32px] py-1 pl-2 pr-2 text-[14px] font-sans cursor-not-allowed text-text-muted opacity-40"
        title={collapsed ? label : undefined}
      >
        <Icon name={icon} className={ICON_PX} />
        {!collapsed && <span className="truncate">{label}</span>}
      </div>
    );
  }

  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2.5 min-h-[32px] py-1 pl-2 pr-2 text-[14px] font-sans transition-colors rounded',
          isActive
            ? 'bg-accent/15 text-accent font-medium'
            : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary',
        )
      }
      title={collapsed ? label : undefined}
    >
      <Icon name={icon} className={ICON_PX} />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

function BrandMark() {
  return (
    <div
      className="grid place-items-center w-8 h-8 rounded-md bg-bg-tertiary font-heading font-black text-accent text-base shrink-0"
      aria-label="Construct"
    >
      C
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const allItems = navGroups.flatMap((g) => g.items);

  return (
    <aside
      className={clsx(
        'flex flex-col border-r border-border-primary bg-bg-secondary transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-[220px]',
      )}
    >
      {/* Header / brand */}
      <div className={clsx(
        'flex items-center border-b border-border-primary',
        collapsed ? 'justify-center py-3 px-2' : 'h-14 px-3',
      )}>
        {collapsed ? (
          <NavLink to="/" title="Construct"><BrandMark /></NavLink>
        ) : (
          <NavLink to="/" className="flex items-center gap-2.5 min-w-0">
            <BrandMark />
            <span className="font-heading text-2xl font-bold leading-tight text-text-primary truncate">Construct</span>
          </NavLink>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {!collapsed && navGroups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-2' : ''}>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted px-2 pt-3 pb-1">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <div key={item.to}>
                  {item.separator === 'before' && <hr className="my-1.5 border-border-primary mx-2" />}
                  <SidebarLink to={item.to} label={item.label} icon={item.icon} disabled={item.disabled} />
                </div>
              ))}
            </div>
          </div>
        ))}

        {collapsed && (
          <div className="space-y-0.5">
            {allItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  clsx(
                    'flex items-center justify-center p-2 rounded transition-colors',
                    item.disabled
                      ? 'text-text-muted opacity-40 cursor-not-allowed pointer-events-none'
                      : isActive
                        ? 'bg-accent/15 text-accent'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary',
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
      <div className={clsx(
        'border-t border-border-primary px-2 py-2 flex gap-1',
        collapsed ? 'flex-col items-center' : 'items-center',
      )}>
        <div className={collapsed ? '' : 'flex-1 min-w-0'}>
          <SidebarLink to={settingsItem.to} label={settingsItem.label} icon={settingsItem.icon} collapsed={collapsed} />
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center min-h-[32px] w-8 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'} className={ICON_PX} />
        </button>
      </div>
    </aside>
  );
}
