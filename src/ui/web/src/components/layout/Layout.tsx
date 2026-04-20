import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { CreditExhaustedBanner } from '../research/CreditExhaustedBanner';

export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="px-6 pb-6">
          <div className="pt-4 empty:hidden">
            <CreditExhaustedBanner />
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
