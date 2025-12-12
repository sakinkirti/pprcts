
import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'

interface LibraryProps {
    session: Session | null;
}

export default function Library({ session }: LibraryProps) {
    const [papers, setPapers] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    // Modal State shared with Home? 
    // For simplicity, duplicating modal logic slightly or we could extract a "PaperModal" component. 
    // Let's duplicate for now to keep speed up, but refactor later.
    const [summary, setSummary] = useState('')
    const [showModal, setShowModal] = useState(false)
    const [modalLoading, setModalLoading] = useState(false)
    const [modalError, setModalError] = useState('')
    const [selectedPaper, setSelectedPaper] = useState<any>(null)
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioLoading, setAudioLoading] = useState(false);
    const [audioError, setAudioError] = useState('');

    useEffect(() => {
        if (session?.access_token) {
            fetchLibrary();
        }
    }, [session]);

    const fetchLibrary = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('http://localhost:5001/api/library', {
                headers: {
                    'Authorization': `Bearer ${session?.access_token}`
                }
            });
            if (res.status === 401) {
                setError('Please log in using the menu.');
                return;
            }
            const data = await res.json();
            setPapers(data.library || []);
        } catch (err) {
            setError('Failed to load library.');
        } finally {
            setLoading(false);
        }
    };

    const openPaperModal = (paper: any) => {
        setSelectedPaper(paper);
        setShowModal(true);
        // If it's in library, it MIGHT have a summary already cached locally in the object if we returned it,
        // but our API returns paper.* so it should have 'summary'.
        // Let's check.
        if (paper.summary) {
            setSummary(paper.summary);
            // If it has summary, it might have audio path too, but we need to fetch the actual URL/blob via TTS endpoint or a new audio endpoint?
            // The TTS endpoint handles "if exists download".
            // So we can just trigger the effect by setting summary.
        } else {
            setSummary('');
        }
        setAudioUrl(null);
        setModalError('');
        setAudioError('');
        setModalLoading(false);
    }

    const handleGenerateSummary = async () => {
        if (!selectedPaper) return;
        // ... same logic as Home ...
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

    // Audio Effect
    useEffect(() => {
        if (summary) {
            setAudioLoading(true);
            setAudioError('');
            // If we already have audioUrl from previous render (not applicable here as we reset), 
            // but if we want to optimize:
            // Since TTS endpoint checks FS/Supabase, it's fast.
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
                    if (!res.ok) throw new Error('Failed to fetch audio');
                    const blob = await res.blob();
                    setAudioUrl(URL.createObjectURL(blob));
                })
                .catch(err => setAudioError(err.message))
                .finally(() => setAudioLoading(false));
        }
    }, [summary]);

    if (!session) {
        return <div className="library-container"><p>Please log in to view your library.</p></div>
    }

    return (
        <div className="library-container">

            {loading && <p>Loading library...</p>}
            {error && <p style={{ color: 'red' }}>{error}</p>}
            {!loading && papers.length === 0 && <p>No saved papers yet.</p>}

            <ul className="results-list">
                {papers.map((paper, idx) => (
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
                        {/* Reuse card styles from Home */}
                    </li>
                ))}
            </ul>

            {/* Modal - Duplicate code for now */}
            {showModal && selectedPaper && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
                        <h2>{selectedPaper.title}</h2>

                        <div style={{ marginBottom: '16px', fontSize: '0.98rem', color: 'var(--text-secondary)' }}>
                            <div><strong>Authors:</strong> {selectedPaper.authors?.join(', ') || 'No authors listed'}</div>
                            <div><strong>Journal:</strong> {selectedPaper.journal || 'No journal listed'}</div>
                            <div><strong>Publication Date:</strong> {selectedPaper.publication_date || 'No publication date listed'}</div>
                            <div style={{ marginTop: '10px' }}><strong>Abstract:</strong> {selectedPaper.abstract || 'No abstract listed'}</div>
                        </div>

                        {modalError && <p style={{ color: 'red' }}>{modalError}</p>}
                        {!summary && !modalLoading && (
                            <div className="modal-actions">
                                <button onClick={handleGenerateSummary} className="action-btn">Summarize</button>
                            </div>
                        )}
                        {modalLoading && <p>Loading...</p>}
                        {summary && (
                            <div>
                                <h3>Summary</h3>
                                <div className="summary-text">{summary}</div>
                                {audioError && <p style={{ color: 'red' }}>{audioError}</p>}
                                {audioUrl && <audio controls src={audioUrl} />}
                                {audioLoading && <p>Loading audio...</p>}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
