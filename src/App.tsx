import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom'
import './App.css'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'
import Home from './Home'
import Settings from './Settings'
import Library from './Library' // Assuming Library component is needed based on routes
import About from './About'
import MiniPlayer from './MiniPlayer'

interface GlobalAudio {
  url: string;
  title: string;
}

type Theme = 'light' | 'dark'
const THEME_STORAGE_KEY = 'pprcts-theme-v1'

function getInitialTheme(): Theme {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function AppContent() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true) // Start loading
  const [globalAudio, setGlobalAudio] = useState<GlobalAudio | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate();
  const location = useLocation();

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/library': return 'Library';
      case '/about': return 'About';
      case '/settings': return 'Settings';
      case '/': return 'Home';
      default: return 'Shortcuts';
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false) // Finished loading initial session
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      // Note: onAuthStateChange fires immediately too, but getSession handles the initial load check better usually
      setAuthLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return
    const closeMenu = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof MouseEvent && menuRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeMenu)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeMenu)
    }
  }, [menuOpen])

  const handleLogin = async () => {
    const redirectUrl = window.location.origin
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
      },
    })
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setMenuOpen(false)
    navigate('/')
  }

  return (
    <div className="container">
      {/* Header with Hamburger */}
      <header className="header-row">
        <Link to="/" className="brand" aria-label="pprcts home">pprcts <span aria-hidden="true">✂️</span></Link>

        <div className="header-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            <span className="theme-toggle-icon" aria-hidden="true">{theme === 'dark' ? '☀' : '◐'}</span>
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>

          <div className="menu-container" ref={menuRef}>
          <button
            className="hamburger-btn"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            aria-controls="main-menu"
          >
            <span>{getPageTitle()}</span>
            <span aria-hidden="true">☰</span>
          </button>

          {/* Dropdown Menu */}
          {menuOpen && (
            <nav className="dropdown-menu" id="main-menu" aria-label="Main navigation">
              <Link to="/" onClick={() => setMenuOpen(false)} className="dropdown-link">Home</Link>

              {session && (
                <>
                  <Link to="/library" onClick={() => setMenuOpen(false)} className="dropdown-link">Library</Link>
                  <Link to="/settings" onClick={() => setMenuOpen(false)} className="dropdown-link">Settings</Link>
                </>
              )}

              <Link to="/about" onClick={() => setMenuOpen(false)} className="dropdown-link">About</Link>

              {session ? (
                <>
                  <hr className="menu-divider" />
                  <div className="menu-email">{session.user.email}</div>
                  <button
                    onClick={handleLogout}
                    className="logout-btn"
                  >
                    Log Out
                  </button>
                </>
              ) : (
                <button
                  onClick={handleLogin}
                  className="login-btn"
                >
                  Log In / Sign Up
                </button>
              )}
            </nav>
          )}
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Home
          session={session}
          authLoading={authLoading}
          setGlobalAudio={(audio) => {
            setGlobalAudio(audio);
            if (audio) setIsPlaying(true);
          }}
          globalAudio={globalAudio}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
        />} />
        <Route path="/library" element={<Library session={session} setGlobalAudio={(audio) => {
          setGlobalAudio(audio);
          if (audio) setIsPlaying(true);
        }} />} />
        <Route path="/settings" element={<Settings session={session} />} />
        <Route path="/about" element={<About />} />
      </Routes>

      {globalAudio && (
        <MiniPlayer
          audioUrl={globalAudio.url}
          title={globalAudio.title}
          isPlaying={isPlaying}
          onPlayPause={setIsPlaying}
          onClose={() => {
            setGlobalAudio(null);
            setIsPlaying(false);
          }}
        />
      )}

      <footer className="support-footer">
        <a
          href="https://buymeacoffee.com/sakinkirti"
          target="_blank"
          rel="noopener noreferrer"
        >
          If you find this tool useful, consider supporting by buying me a coffee ☕
        </a>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  )
}
