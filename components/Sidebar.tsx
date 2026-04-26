import React from 'react';
import { Library, Disc, Search, LogIn, LogOut, Sun, Moon, GraduationCap, Settings2, Mic2 } from 'lucide-react';
import { View } from '../types';
import { useI18n } from '../context/I18nContext';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  user?: { username: string; isAdmin?: boolean; avatar_url?: string } | null;
  onLogin?: () => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  isOpen?: boolean;
  onToggle?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  theme,
  onToggleTheme,
  user,
  onLogin,
  onLogout,
  onOpenSettings,
  isOpen = true,
  onToggle,
}) => {
  const { t } = useI18n();

  return (
    <>
      {/* Backdrop for mobile - only when expanded */}
      {isOpen && onToggle && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <div className={`
        flex flex-col h-full bg-white dark:bg-suno-sidebar border-r border-zinc-200 dark:border-white/10 flex-shrink-0 py-3 overflow-y-auto scrollbar-hide transition-all duration-300
        fixed left-0 top-0 z-50 md:relative
        ${isOpen ? 'w-[220px]' : 'w-[60px]'}
      `}>
      {/* Logo & Brand */}
      <div className="px-3 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center cursor-pointer shadow-md hover:scale-105 transition-transform flex-shrink-0"
            onClick={() => onNavigate('create')}
            title={t('aceStepUI')}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {isOpen && (
            <span className="text-sm font-bold text-zinc-900 dark:text-white whitespace-nowrap">ACE Step</span>
          )}
        </div>
        {/* Collapse/Expand Button */}
        {onToggle && (
          <button
            onClick={onToggle}
            className="w-6 h-6 rounded-md hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors flex-shrink-0"
            title={isOpen ? t('collapseSidebar') : t('expandSidebar')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              )}
            </svg>
          </button>
        )}
      </div>

      <nav className="flex-1 flex flex-col gap-1.5 w-full px-2">
        <NavItem
          icon={<Disc size={16} />}
          label={t('create')}
          active={currentView === 'create'}
          onClick={() => onNavigate('create')}
          isExpanded={isOpen}
        />
        <NavItem
          icon={<Library size={16} />}
          label={t('library')}
          active={currentView === 'library'}
          onClick={() => onNavigate('library')}
          isExpanded={isOpen}
        />
        <NavItem
          icon={<Search size={16} />}
          label={t('search')}
          active={currentView === 'search'}
          onClick={() => onNavigate('search')}
          isExpanded={isOpen}
        />
        <NavItem
          icon={<GraduationCap size={16} />}
          label={t('training')}
          active={currentView === 'training'}
          onClick={() => onNavigate('training')}
          isExpanded={isOpen}
        />
        <NavItem
          icon={<Mic2 size={16} />}
          label="TTS"
          active={currentView === 'tts'}
          onClick={() => onNavigate('tts')}
          isExpanded={isOpen}
        />
        <NavItem
          icon={<Settings2 size={16} />}
          label="Settings"
          active={currentView === 'settings'}
          onClick={() => onNavigate('settings')}
          isExpanded={isOpen}
        />

        <div className="mt-auto pt-2 border-t border-zinc-100 dark:border-white/5 flex flex-col gap-0.5">
          {user ? (
            <>
              {/* User row: avatar + name + theme toggle */}
              <div className={`flex items-center ${isOpen ? 'gap-2 px-2 py-1.5' : 'flex-col gap-1 py-1'}`}>
                <button
                  onClick={onOpenSettings}
                  className="flex-shrink-0"
                  title={`${user.username} - ${t('settings')}`}
                >
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white text-[9px] font-bold border border-white/20 overflow-hidden">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt={user.username} className="w-full h-full object-cover" />
                    ) : (
                      user.username.charAt(0).toUpperCase()
                    )}
                  </div>
                </button>
                {isOpen && (
                  <button
                    onClick={onOpenSettings}
                    className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 truncate flex-1 text-left hover:text-black dark:hover:text-white transition-colors"
                  >
                    {user.username}
                  </button>
                )}
                <button
                  onClick={onToggleTheme}
                  className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors flex-shrink-0"
                  title={theme === 'dark' ? t('lightMode') : t('darkMode')}
                >
                  {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                </button>
              </div>
              {/* Logout */}
              <button
                onClick={onLogout}
                className={`
                  w-full rounded-lg flex items-center gap-2 transition-all duration-200 text-zinc-400 hover:text-red-500 hover:bg-red-500/10
                  ${isOpen ? 'px-2 py-1.5 justify-start' : 'aspect-square justify-center'}
                `}
                title={t('signOut')}
              >
                <div className="flex-shrink-0"><LogOut size={14} /></div>
                {isOpen && (
                  <span className="text-[11px] font-medium whitespace-nowrap">{t('signOut')}</span>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onToggleTheme}
                className={`
                  w-full rounded-lg flex items-center gap-2 transition-all duration-200 text-zinc-400 hover:text-black dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5
                  ${isOpen ? 'px-2 py-1.5 justify-start' : 'aspect-square justify-center'}
                `}
                title={theme === 'dark' ? t('lightMode') : t('darkMode')}
              >
                <div className="flex-shrink-0">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</div>
                {isOpen && (
                  <span className="text-[11px] font-medium whitespace-nowrap">
                    {theme === 'dark' ? t('lightMode') : t('darkMode')}
                  </span>
                )}
              </button>
              <button
                onClick={onLogin}
                className={`
                  w-full rounded-lg flex items-center gap-2 transition-all duration-200 text-zinc-400 hover:text-pink-500 hover:bg-zinc-100 dark:hover:bg-white/5
                  ${isOpen ? 'px-2 py-1.5 justify-start' : 'aspect-square justify-center'}
                `}
                title={t('signIn')}
              >
                <div className="flex-shrink-0"><LogIn size={14} /></div>
                {isOpen && (
                  <span className="text-[11px] font-medium whitespace-nowrap">{t('signIn')}</span>
                )}
              </button>
            </>
          )}
        </div>
      </nav>
      </div>
    </>
  );
};

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  isExpanded?: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick, isExpanded }) => (
  <button
    onClick={onClick}
    className={`
      w-full rounded-lg flex items-center gap-2.5 transition-all duration-200 group relative overflow-hidden
      ${isExpanded ? 'px-3 py-2 justify-start' : 'aspect-square justify-center'}
      ${active ? 'text-black dark:text-white bg-zinc-100 dark:bg-white/[0.03]' : 'text-zinc-500 hover:text-black dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5'}
    `}
    title={label}
  >
    {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] bg-pink-500 rounded-r-full"></div>}
    <div className="flex-shrink-0">{icon}</div>
    {isExpanded && (
      <span className="text-[11px] font-medium whitespace-nowrap">{label}</span>
    )}
  </button>
);
