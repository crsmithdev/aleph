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
        { to: '/research/queries', label: 'Queries', icon: 'list' },
        { to: '/research/workers', label: 'Workers', icon: 'engineering' },
        { to: '/research/config', label: 'Providers', icon: 'tune' },
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
        { to: '/observability/signals', label: 'Signals', icon: 'bolt', separator: 'before' },
        { to: '/observability/memory', label: 'Memory', icon: 'memory' },
        { to: '/observability/db', label: 'Database', icon: 'storage' },
      ],
    },
  ],
  [
    {
      to: '/observability/evals',
      label: 'Evals',
      disabled: false,
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
                : 'rounded-lg bg-accent/15 text-accent font-medium pl-2.5'
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
          <NavLink to="/" className="font-heading text-2xl leading-tight font-bold text-text-primary">
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
                    ? 'rounded-lg bg-accent/15 text-accent'
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
      </div>
    </aside>
  );
}
