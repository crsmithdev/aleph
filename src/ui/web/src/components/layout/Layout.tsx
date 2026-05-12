import { Outlet, useLocation, matchPath } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ROUTE_META } from '../../routes-meta';

export function Layout() {
  const { pathname } = useLocation();
  // Match-by-specificity: prefer routes with fewer `:` params so e.g.
  // `/research/config` wins over `/research/:id`.
  const match = ROUTE_META
    .filter(r => matchPath(r.path, pathname))
    .sort((a, b) => (a.path.match(/:/g)?.length ?? 0) - (b.path.match(/:/g)?.length ?? 0))[0];
  const testid = match?.smoke?.testid;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto" data-testid={testid}>
        <div className="px-6 pb-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
