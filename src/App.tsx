import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom'
import './App.css'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'
import Home from './Home'
import Settings from './Settings'
import Library from './Library' // Assuming Library component is needed based on routes
import MiniPlayer from './MiniPlayer'

interface GlobalAudio {
  url: string;
  title: string;
}

function AppContent() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true) // Start loading
  const [globalAudio, setGlobalAudio] = useState<GlobalAudio | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate();
  const location = useLocation();

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/library': return 'My Library';
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
        <h1 style={{ margin: 0 }}>pprcts ✂️</h1>

        <div className="menu-container">
          <button
            className="hamburger-btn"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span>{getPageTitle()}</span>
            <span style={{ fontSize: '1.2rem' }}>☰</span>
          </button>

          {/* Dropdown Menu */}
          {menuOpen && (
            <div className="dropdown-menu">
              <Link to="/" onClick={() => setMenuOpen(false)} className="dropdown-link">Home</Link>

              {session ? (
                <>
                  <Link to="/library" onClick={() => setMenuOpen(false)} className="dropdown-link">My Library</Link>
                  <Link to="/settings" onClick={() => setMenuOpen(false)} className="dropdown-link">Settings</Link>
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
            </div>
          )}
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
