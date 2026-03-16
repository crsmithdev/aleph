import { Outlet, Navigate } from 'react-router-dom';
import { useAuthStatus } from '../../api/hooks';

export function AuthGate() {
  const { data, isLoading, error } = useAuthStatus();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !data?.authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
