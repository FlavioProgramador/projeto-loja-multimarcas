import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { NotificationsModal } from '../notifications/NotificationsModal';
import { ActiveModule } from '../../types';

interface AppLayoutProps {
  currentModule: ActiveModule;
  onNavigate: (module: ActiveModule) => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentModule,
  onNavigate,
  children
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <div className="app-layout">
      <Sidebar
        currentModule={currentModule}
        onNavigate={onNavigate}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(prev => !prev)}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="main-wrapper">
        <Header
          onToggleSidebar={() => setSidebarOpen(prev => !prev)}
          onOpenNotifications={() => setNotificationsOpen(true)}
        />

        <main className="page-content">
          {children}
        </main>
      </div>

      <NotificationsModal
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
    </div>
  );
};
