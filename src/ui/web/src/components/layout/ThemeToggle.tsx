import { useTheme } from '../../theme';
import { clsx } from 'clsx';
import { Icon } from '../ui/Icon';

export function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      className={clsx(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
      )}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} size="sm" />
      {!collapsed && <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>}
    </button>
  );
}
