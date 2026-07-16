import { useState } from 'react';

const LINKS = [
  { label: 'Сканер', href: '#scanner' },
  { label: 'Довідка', href: '#help' },
];

export default function Navbar({ user, onLogout, onOpenSettings }) {
  const [open, setOpen] = useState(false);

  function handleNavClick(href) {
    setOpen(false);
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <>
      <nav className="navbar">
        <div className="logo">
          <span className="logo-text">DOTmed Parser</span>
          <span className="logo-asterisk">✳︎</span>
        </div>

        {user && (
          <div className="nav-links">
            {LINKS.map((l, i) => (
              <a key={l.href} href={l.href} onClick={(e) => { e.preventDefault(); handleNavClick(l.href); }}>
                {l.label}{i < LINKS.length - 1 ? ', ' : ''}
              </a>
            ))}
          </div>
        )}

        {user ? (
          <div className="nav-user">
            <button className="nav-settings-btn" onClick={onOpenSettings}>Налаштування</button>
            {user.picture && <img className="avatar" src={user.picture} alt="" />}
            <span className="nav-user-email">{user.email}</span>
            <button className="nav-logout-btn" onClick={onLogout}>Вийти</button>
          </div>
        ) : (
          <a className="nav-cta" href="mailto:v.zeleniuk.bimedis@gmail.com">Написати нам</a>
        )}

        <button
          className={`hamburger ${open ? 'open' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-label="Меню"
          aria-expanded={open}
        >
          <span />
          <span />
          <span />
        </button>
      </nav>

      <div className={`mobile-overlay ${open ? 'visible' : ''}`}>
        {user && LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={(e) => { e.preventDefault(); handleNavClick(l.href); }}>
            {l.label}
          </a>
        ))}
        {user ? (
          <>
            <a href="#" onClick={(e) => { e.preventDefault(); setOpen(false); onOpenSettings(); }}>Налаштування</a>
            <a href="#" onClick={(e) => { e.preventDefault(); setOpen(false); onLogout(); }}>Вийти</a>
          </>
        ) : (
          <a href="mailto:v.zeleniuk.bimedis@gmail.com" className="mobile-cta">Написати нам</a>
        )}
      </div>
    </>
  );
}
