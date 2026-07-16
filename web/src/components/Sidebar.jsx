import { ScanLine, History, Users, Settings, LogOut, Sun, Moon } from 'lucide-react';
import { motion } from 'framer-motion';

const NAV_ITEMS = [
  { id: 'scanner', label: 'Сканер', icon: ScanLine },
  { id: 'history', label: 'Історія', icon: History },
  { id: 'team', label: 'Команда', icon: Users },
  { id: 'settings', label: 'Налаштування', icon: Settings },
];

export default function Sidebar({ activePage, onNavigate, user, onLogout, theme, onToggleTheme, mobileOpen }) {
  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <span className="logo-text">Parser</span>
        <span className="logo-asterisk">✳︎</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activePage === item.id;
          return (
            <button
              key={item.id}
              className={`sidebar-item ${active ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
              title={item.label}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active-pill"
                  className="sidebar-item-pill"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              <Icon size={18} strokeWidth={1.75} className="sidebar-item-icon" />
              <span className="sidebar-item-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button className="theme-toggle" onClick={onToggleTheme} title="Перемкнути тему">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {user?.picture && <img className="avatar" src={user.picture} alt="" />}
        <span className="nav-user-email">{user?.email}</span>
        <button className="nav-logout-btn" onClick={onLogout} title="Вийти">
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}
