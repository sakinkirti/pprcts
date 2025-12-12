
import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'

interface HomeProps {
    session: Session | null;
}

export default function Home({ session }: HomeProps) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    // Modal State
    const [summary, setSummary] = useState('')
    const [showModal, setShowModal] = useState(false)
    const [modalLoading, setModalLoading] = useState(false)
    const [modalError, setModalError] = useState('')
    const [selectedPaper, setSelectedPaper] = useState<any>(null)

    // Audio State
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioLoading, setAudioLoading] = useState(false);
    const [audioError, setAudioError] = useState('');

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

    const openPaperModal = (paper: any) => {
        setSelectedPaper(paper);
        setShowModal(true);
        setSummary('');
        setAudioUrl(null);
        setModalError('');
        setAudioError('');
        setModalLoading(false);
    }

    const handleGenerateSummary = async () => {
        if (!selectedPaper) return;
        setModalLoading(true)
        setModalError('')

        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (session?.access_token) {
            headers['Authorization'] = `Bearer ${session.access_token}`
        }

        try {
            const res = await fetch('http://localhost:5001/api/summarize', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    pmid: selectedPaper.pmid,
                    title: selectedPaper.title,
                    abstract: selectedPaper.abstract,
                    journal: selectedPaper.journal,
                    authors: selectedPaper.authors,
                    publication_date: selectedPaper.publication_date
                })
            })
            const data = await res.json()
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

    // Fetch TTS audio when summary is available
    useEffect(() => {
        if (summary) {
            setAudioLoading(true);
            setAudioError('');
            setAudioUrl(null);

            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (session?.access_token) {
                headers['Authorization'] = `Bearer ${session.access_token}`
            }

            const pmid = selectedPaper?.pmid;

            fetch('http://localhost:5001/api/tts', {
                method: 'POST',
                headers,
                body: JSON.stringify({ summary, pmid })
            })
                .then(async res => {
                    if (!res.ok) {
                        let errorMsg = 'Failed to fetch audio.';
                        try {
                            const data = await res.json();
                            errorMsg = data.error || errorMsg;
                        } catch (jsonErr) {
                            errorMsg = 'Audio service returned an invalid response.';
                        }
                        setAudioError(errorMsg);
                        setAudioUrl(null);
                        return;
                    }
                    try {
                        const blob = await res.blob();
                        if (!blob || blob.size === 0) {
                            setAudioError('Received empty audio file.');
                            setAudioUrl(null);
                            return;
                        }
                        setAudioUrl(URL.createObjectURL(blob));
                    } catch (blobErr) {
                        setAudioError('Error processing audio file.');
                        setAudioUrl(null);
                    }
                })
                .catch((err) => {
                    if (err.name === 'TypeError') {
                        setAudioError('Network error: Unable to reach audio service.');
                    } else {
                        setAudioError('Unexpected error: ' + err.message);
                    }
                    setAudioUrl(null);
                })
                .finally(() => setAudioLoading(false));
        } else {
            setAudioUrl(null);
        }
    }, [summary]); // Dependency on summary change

    return (
        <div className="home-container">
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
                                openPaperModal(paper);
                            }}
                        >
                            {paper.title}
                        </a>
                        <div className="card-meta">
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
            {showModal && selectedPaper && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
                        <h2>{selectedPaper.title}</h2>

                        <div style={{ marginBottom: '16px', fontSize: '0.98rem', color: '#444' }}>
                            <div><strong>Authors:</strong> {selectedPaper.authors?.join(', ') || 'No authors listed'}</div>
                            <div><strong>Journal:</strong> {selectedPaper.journal || 'No journal listed'}</div>
                            <div><strong>Publication Date:</strong> {selectedPaper.publication_date || 'No publication date listed'}</div>
                            <div style={{ marginTop: '10px' }}><strong>Abstract:</strong> {selectedPaper.abstract || 'No abstract listed'}</div>
                        </div>

                        {!summary && !modalLoading && (
                            <div className="modal-actions">
                                <button
                                    onClick={handleGenerateSummary}
                                    className="action-btn"
                                >
                                    Summarize & Listen
                                </button>
                            </div>
                        )}

                        {modalLoading && <p>Loading summary...</p>}
                        {modalError && <p style={{ color: 'red' }}>{modalError}</p>}

                        {!modalLoading && !modalError && summary && (
                            <div style={{ marginTop: '16px' }}>
                                <h3>Summary</h3>
                                <div style={{ whiteSpace: 'pre-wrap', maxHeight: '300px', overflowY: 'auto', marginBottom: '16px' }}>
                                    {summary}
                                </div>

                                {audioLoading && <p>Loading audio...</p>}
                                {audioError && <p style={{ color: 'red' }}>{audioError}</p>}
                                {audioUrl && (
                                    <audio controls src={audioUrl} style={{ width: '100%' }}>
                                        Your browser does not support the audio element.
                                    </audio>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
