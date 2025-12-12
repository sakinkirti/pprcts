import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom'
import './App.css'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'
import Home from './Home'
import Library from './Library'

function AppContent() {
  const [session, setSession] = useState<Session | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate();
  const location = useLocation();

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/library': return 'My Library';
      case '/': return 'Home';
      default: return 'Shortcuts';
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
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
        <h1 style={{ margin: 0 }}>papercuts ✂️</h1>

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
        <Route path="/" element={<Home session={session} />} />
        <Route path="/library" element={<Library session={session} />} />
      </Routes>
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
