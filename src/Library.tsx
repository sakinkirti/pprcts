
import { useState, useEffect } from 'react'

import type { Session } from '@supabase/supabase-js'

interface LibraryProps {
    session: Session | null;
    setGlobalAudio: (audio: { url: string; title: string } | null) => void;
}

export default function Library({ session, setGlobalAudio }: LibraryProps) {
    const [papers, setPapers] = useState<any[]>([])
    const [briefings, setBriefings] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [filter, setFilter] = useState<'All' | 'Articles' | 'Briefings'>('All')

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

    // Briefing Modal State
    const [selectedBriefing, setSelectedBriefing] = useState<any>(null);
    const [showBriefingModal, setShowBriefingModal] = useState(false);

    useEffect(() => {
        if (session?.access_token) {
            fetchLibrary();
        }
    }, [session]);

    const fetchLibrary = async () => {
        setLoading(true);
        setError('');
        try {
            const headers = {
                'Authorization': `Bearer ${session?.access_token}`
            };

            const [libRes, briefRes] = await Promise.all([
                fetch('http://localhost:5001/api/library', { headers }),
                fetch('http://localhost:5001/api/briefings/history', { headers })
            ]);

            if (libRes.status === 401 || briefRes.status === 401) {
                setError('Please log in using the menu.');
                return;
            }

            const libData = await libRes.json();
            const briefData = await briefRes.json();

            setPapers(libData.library || []);
            setBriefings(briefData.briefings || []);
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

            if (!res.ok) {
                if (res.status === 401) {
                    setModalError('Please sign in to generate summaries.');
                } else if (res.status === 402) {
                    setModalError('OpenAI account has run out of credits.');
                } else if (res.status === 400 && data.error === 'OpenAI API key not configured') {
                    setModalError('Please configure your OpenAI API Key in Settings.');
                } else {
                    setModalError(data.error || 'Failed to generate summary.');
                }
                return;
            }

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

            {!loading && (
                <div className="filter-bubbles">
                    <button
                        className={`filter-bubble ${filter === 'All' ? 'active' : ''}`}
                        onClick={() => setFilter('All')}
                    >All</button>
                    <button
                        className={`filter-bubble ${filter === 'Articles' ? 'active' : ''}`}
                        onClick={() => setFilter('Articles')}
                    >Articles</button>
                    <button
                        className={`filter-bubble ${filter === 'Briefings' ? 'active' : ''}`}
                        onClick={() => setFilter('Briefings')}
                    >Briefings</button>
                </div>
            )}

            {!loading && papers.length === 0 && briefings.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '40px' }}>
                    <p>No saved papers or briefings yet.</p>
                </div>
            )}

            <ul style={{ marginTop: '-1%' }} className="results-list">
                {/* 
                  Merge and Sort Logic:
                  - Papers have 'saved_at'
                  - Briefings have 'date'
                  - We want to mix them and sort by date descending.
                */}
                {(() => {
                    let items: any[] = [];
                    if (filter === 'All' || filter === 'Articles') {
                        items = items.concat(papers.map(p => ({ ...p, type: 'paper', sortDate: p.saved_at })));
                    }
                    if (filter === 'All' || filter === 'Briefings') {
                        items = items.concat(briefings.map(b => ({ ...b, type: 'briefing', sortDate: b.date })));
                    }

                    items.sort((a, b) => {
                        const dateA = a.type === 'briefing' ? a.sortDate + 'T00:00:00' : a.sortDate;
                        const dateB = b.type === 'briefing' ? b.sortDate + 'T00:00:00' : b.sortDate;
                        return new Date(dateB).getTime() - new Date(dateA).getTime();
                    });

                    return items.map((item, idx) => {
                        if (item.type === 'briefing') {
                            return (
                                <li key={`briefing-${idx}`} className="briefing-card" onClick={() => {
                                    setSelectedBriefing(item);
                                    setShowBriefingModal(true);
                                }}>
                                    <div className="briefing-rainbow-bg"></div>
                                    <div className="briefing-card-content">
                                        <div style={{ paddingRight: '50px' }}>
                                            <div className="briefing-title">
                                                {item.title}
                                            </div>
                                            <div className="briefing-meta" style={{ marginTop: '4px' }}>
                                                {new Date(item.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                                            </div>
                                            {item.summary && (
                                                <p style={{
                                                    fontSize: '0.9rem',
                                                    color: 'var(--text-primary)',
                                                    margin: '8px 0 0 0',
                                                    lineHeight: '1.5',
                                                    opacity: 0.9
                                                }}>
                                                    {item.summary}
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            className="briefing-play-btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                // need to handle playing
                                                setGlobalAudio({
                                                    url: item.audio_url,
                                                    title: item.title
                                                });
                                            }}
                                        >
                                            ▶
                                        </button>
                                    </div>
                                </li>
                            );
                        } else {
                            return (
                                <li key={`paper-${idx}`} className="result-item">
                                    <a
                                        href="#"
                                        onClick={e => {
                                            e.preventDefault();
                                            openPaperModal(item);
                                        }}
                                    >
                                        {item.title}
                                    </a>
                                    <div className="card-meta">
                                        <div><strong>Authors:</strong> {item.authors && item.authors.length > 0 ? item.authors.join(', ') : 'No authors listed'}</div>
                                        <div><strong>Journal:</strong> {item.journal || 'No journal listed'}</div>
                                        <div><strong>Publication Date:</strong> {item.publication_date || 'No date listed'}</div>
                                    </div>
                                </li>
                            );
                        }
                    });
                })()}
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
                                {audioError && <p style={{ color: 'red' }}>{audioError}</p>}
                                {audioUrl && (
                                    <div style={{ marginTop: '20px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                            <h3 style={{ fontSize: '1rem', margin: 0 }}>Audio Summary</h3>
                                            <button
                                                onClick={() => {
                                                    if (selectedPaper && audioUrl) {
                                                        setGlobalAudio({
                                                            url: audioUrl,
                                                            title: selectedPaper.title
                                                        });
                                                        setShowModal(false);
                                                    }
                                                }}
                                                className="action-btn"
                                                style={{ fontSize: '0.85rem', padding: '6px 12px' }}
                                            >
                                                Minimize
                                            </button>
                                        </div>
                                        <audio controls src={audioUrl} />
                                    </div>
                                )}
                                {audioLoading && <p>Loading audio...</p>}
                            </div>
                        )}
                    </div>
                </div>
            )}


            {/* Briefing Modal */}
            {
                showBriefingModal && selectedBriefing && (
                    <div className="modal-overlay" onClick={() => setShowBriefingModal(false)} style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.5)',
                        zIndex: 1000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '20px'
                    }}>
                        <div className="modal-content" onClick={e => e.stopPropagation()} style={{
                            background: 'var(--bg-card)',
                            borderRadius: '24px',
                            padding: '30px',
                            maxWidth: '600px',
                            width: '100%',
                            maxHeight: '85vh',
                            overflowY: 'auto',
                            position: 'relative'
                        }}>
                            <button
                                onClick={() => setShowBriefingModal(false)}
                                style={{
                                    position: 'absolute',
                                    top: '20px',
                                    right: '20px',
                                    background: 'transparent',
                                    border: 'none',
                                    fontSize: '1.5rem',
                                    cursor: 'pointer',
                                    color: 'var(--text-secondary)'
                                }}
                            >&times;</button>

                            <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.5rem' }}>Daily Briefing Papers</h2>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
                                The following papers were discussed in your daily briefing for {new Date(selectedBriefing.date + 'T00:00:00').toLocaleDateString()}.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {selectedBriefing.papers_metadata && selectedBriefing.papers_metadata.map((paper: any, idx: number) => (
                                    <div key={idx} style={{ paddingBottom: '16px', borderBottom: idx < selectedBriefing.papers_metadata.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                        <h3 style={{ fontSize: '1.1rem', marginBottom: '8px', color: 'var(--text-primary)' }}>{paper.title}</h3>
                                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                            {paper.authors?.slice(0, 3).join(', ')}{paper.authors?.length > 3 ? ' et al.' : ''} • {paper.journal}
                                        </div>
                                        <p style={{ fontSize: '0.9rem', lineHeight: '1.5', margin: 0, opacity: 0.9 }}>
                                            {paper.abstract?.slice(0, 200)}...
                                        </p>
                                    </div>
                                ))}
                                {!selectedBriefing.papers_metadata && (
                                    <p>Paper details not available for this episode.</p>
                                )}
                            </div>

                            {selectedBriefing.transcript && (
                                <details style={{ marginTop: '24px' }}>
                                    <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 500 }}>View Full Transcript</summary>
                                    <p style={{ marginTop: '12px', whiteSpace: 'pre-wrap', fontSize: '0.95rem', lineHeight: '1.6', color: 'var(--text-primary)' }}>
                                        {selectedBriefing.transcript}
                                    </p>
                                </details>
                            )}
                        </div>
                    </div>
                )
            }
        </div>
    )
}
