import { cn } from '../../utils/cn';

export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizes = { sm: 'h-4 w-4 border-[1.5px]', md: 'h-6 w-6 border-2', lg: 'h-8 w-8 border-2' };
  return (
    <span
      className={cn(
        'inline-block animate-spin rounded-full border-accent border-t-transparent',
        sizes[size],
        className
      )}
    />
  );
}

export function PageLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner />
    </div>
  );
}
