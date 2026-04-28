import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../Components/Sidebar';
import Header from '../Components/Header';
import Footer from '../Components/Footer';

/**
 * Shell: sidebar, header, and footer stay fixed in the viewport; only the main pane scrolls.
 */
export default function Layout() {
  return (
    <div className="flex h-dvh max-h-dvh min-h-0 w-full overflow-hidden bg-surface font-sans">
      <div className="sticky top-0 z-30 flex h-full max-h-dvh shrink-0 self-start overflow-y-auto overscroll-y-contain">
        <Sidebar />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="sticky top-0 z-20 shrink-0 bg-surface-container-low">
          <Header />
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-surface-container-low px-6 py-8 md:px-10">
          <Outlet />
        </main>

        <div className="sticky bottom-0 z-20 shrink-0 bg-surface-container-low">
          <Footer />
        </div>
      </div>
    </div>
  );
}
