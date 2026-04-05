import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  children?: { to: string; label: string }[];
}

const navGroups: NavItem[][] = [
  [
    {
      to: '/summary',
      label: 'Life',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 5.385 6.73 11.25 9 11.25s9-5.865 9-11.25Z" />
        </svg>
      ),
      children: [
        { to: '/goals', label: 'Goals' },
        { to: '/todos', label: 'Todos' },
        { to: '/habits', label: 'Habits' },
      ],
    },
  ],
  [
    {
      to: '/research',
      label: 'Research',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
      ),
      children: [
        { to: '/research', label: 'Sessions' },
        { to: '/research/monitors', label: 'Monitors' },
      ],
    },
  ],
  [
    {
      to: '/observability/overview',
      label: 'Observability',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      ),
      children: [
        { to: '/observability/tools', label: 'Tools' },
        { to: '/observability/hooks', label: 'Scripts' },
        { to: '/observability/skills', label: 'Skills' },
        { to: '/observability/sessions', label: 'Sessions' },
        { to: '/observability/events', label: 'Events' },
        { to: '/observability/memory', label: 'Memory' },
        { to: '/observability/db', label: 'Database' },
      ],
    },
  ],
];

const settingsItem = {
  to: '/settings',
  label: 'Settings',
  icon: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  ),
};

function SidebarLink({ to, label, icon, depth = 0, collapsed = false }: { to: string; label: string; icon?: React.ReactNode; depth?: number; collapsed?: boolean }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2.5 py-1.5 text-sm font-mono transition-colors',
          depth > 0 ? 'pl-9 pr-2.5' : 'pr-2.5',
          isActive
            ? depth > 0
              ? 'text-accent font-medium'
              : 'rounded-lg bg-accent text-white font-medium pl-2.5'
            : depth > 0
              ? 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary pl-9'
              : 'pl-2.5 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg'
        )
      }
      title={collapsed ? label : undefined}
    >
      {icon}
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
          <NavLink to="/" className="font-heading text-xl text-text-primary">
            Construct
          </NavLink>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg className={clsx('h-4 w-4 transition-transform', collapsed && 'rotate-180')} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
          </svg>
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
                  <SidebarLink to={item.to} label={item.label} icon={item.icon} />
                  {item.children && isParentActive && (
                    <div className="mt-0.5 space-y-0.5">
                      {item.children.map((child) => (
                        <SidebarLink key={child.to} to={child.to} label={child.label} depth={1} />
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
                isActive
                  ? 'rounded-lg bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg'
              )
            }
            title={item.label}
          >
            {item.icon}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border-primary px-2 py-2 space-y-0.5">
        <SidebarLink to={settingsItem.to} label={settingsItem.label} icon={settingsItem.icon} collapsed={collapsed} />
        <ThemeToggle collapsed={collapsed} />
      </div>
    </aside>
  );
}
