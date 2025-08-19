import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalLoading, setModalLoading] = useState(false)
  const [modalError, setModalError] = useState('')
  const [summaryTitle, setSummaryTitle] = useState('')

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResults([])
    try {
      const res = await fetch(`http://localhost:5001/api/search?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      setResults(data.results || [])
    } catch (err: any) {
      setError('Failed to fetch results')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Restore previous search results if available
    if ((window.history.state && window.history.state.usr) && window.history.state.usr.results) {
      setResults(window.history.state.usr.results)
      setQuery(window.history.state.usr.query || '')
    }
  }, [])

  const handleSummary = async (paper: any) => {
    setShowModal(true)
    setModalLoading(true)
    setModalError('')
    setSummary('')
    setSummaryTitle(paper.title)
    try {
      const res = await fetch('http://localhost:5001/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: paper.title,
          abstract: paper.abstract,
          journal: paper.journal,
          authors: paper.authors,
          publication_date: paper.publication_date
        })
      })
      const data = await res.json()
      console.log(data);
      if (data.summary) {
        setSummary(data.summary)
      } else {
        setModalError('No summary returned.')
      }
    } catch {
      setModalError('Error fetching summary.')
    } finally {
      setModalLoading(false)
    }
  }

  return (
    <div className="container">
      <h1>papercuts ✂️</h1>
      <form onSubmit={handleSearch} className="search-form">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Enter keywords, author, or title"
          required
        />
        <button type="submit" disabled={loading}>Search</button>
      </form>
      {loading && <p>Loading...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <ul className="results-list">
        {results.map((paper, idx) => (
          <li key={idx} className="result-item">
            <a
              href="#"
              onClick={e => {
                e.preventDefault();
                handleSummary(paper);
              }}
              style={{
                cursor: 'pointer',
                textDecoration: 'underline',
                fontSize: '1.15rem',
                fontWeight: 600,
                color: '#2a3a5e',
              }}
            >
              {paper.title}
            </a>
            <div className="card-meta" style={{ fontSize: '0.98rem', color: '#444', marginTop: '8px', marginBottom: '4px' }}>
              <div><strong>Authors:</strong> {paper.authors && paper.authors.length > 0 ? paper.authors.join(', ') : 'No authors listed'}</div>
              <div><strong>Journal:</strong> {paper.journal || 'No journal listed'}</div>
              <div><strong>Publication Date:</strong> {paper.publication_date || 'No date listed'}</div>
            </div>
            {paper.abstract && (
              <div className="abstract-hover">{paper.abstract}</div>
            )}
          </li>
        ))}
      </ul>
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
            <h2>Article Summary</h2>
            {/* Show metadata in modal */}
            <div style={{ marginBottom: '16px', fontSize: '0.98rem', color: '#444' }}>
              <div><strong>Title:</strong> {results.find(p => p.title === summaryTitle)?.title || 'No title listed'}</div>
              <div><strong>Authors:</strong> {results.find(p => p.title === summaryTitle)?.authors?.join(', ') || 'No authors listed'}</div>
              <div><strong>Journal:</strong> {results.find(p => p.title === summaryTitle)?.journal || 'No journal listed'}</div>
              <div><strong>Publication Date:</strong> {results.find(p => p.title === summaryTitle)?.publication_date || 'No publication date listed'}</div>
              <div><strong>Abstract:</strong> {results.find(p => p.title === summaryTitle)?.abstract || 'No abstract listed'}</div>
            </div>
            {modalLoading && <p>Loading summary...</p>}
            {modalError && <p style={{ color: 'red' }}>{modalError}</p>}
            {!modalLoading && !modalError && (
              <div style={{ whiteSpace: 'pre-line', fontSize: '1rem', color: '#222' }}>{summary}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
