
import { useState, useEffect, useCallback } from 'react'

import type { Session } from '@supabase/supabase-js'
import { API_URL } from './config';
import { getBriefingTitle } from './briefing';
import SummaryProvenance from './components/SummaryProvenance';
import FailedBriefingCardContent from './components/FailedBriefingCardContent';
import BriefingCardContent from './components/BriefingCardContent';
import { getPaperId, getPaperSource } from './papers';
import type { Paper, Podcast, SummaryProvenance as SummaryProvenanceData } from './types';

interface LibraryProps {
    session: Session | null;
    setGlobalAudio: (audio: { url: string; title: string } | null) => void;
}

type LibraryPaper = Paper & { type: 'paper'; sortDate: string }
type LibraryBriefing = Podcast & { type: 'briefing'; sortDate: string }
type LibraryItem = LibraryPaper | LibraryBriefing

export default function Library({ session, setGlobalAudio }: LibraryProps) {
    const [papers, setPapers] = useState<Paper[]>([])
    const [briefings, setBriefings] = useState<Podcast[]>([])
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
    const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null)
    const [provenance, setProvenance] = useState<SummaryProvenanceData | null>(null)
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioLoading, setAudioLoading] = useState(false);
    const [audioError, setAudioError] = useState('');

    // Briefing Modal State
    const [selectedBriefing, setSelectedBriefing] = useState<Podcast | null>(null);
    const [showBriefingModal, setShowBriefingModal] = useState(false);
    const [retryingBriefingId, setRetryingBriefingId] = useState<string | null>(null);
    const selectedPaperId = selectedPaper ? getPaperId(selectedPaper) : '';

    const fetchLibrary = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const headers = {
                'Authorization': `Bearer ${session?.access_token}`
            };

            const [libRes, briefRes] = await Promise.all([
                fetch(`${API_URL}/api/library`, { headers }),
                fetch(`${API_URL}/api/briefings/history`, { headers })
            ]);

            if (libRes.status === 401 || briefRes.status === 401) {
                setError('Please log in using the menu.');
                return;
            }

            const libData = await libRes.json();
            const briefData = await briefRes.json();

            setPapers(libData.library || []);
            setBriefings(briefData.briefings || []);
        } catch {
            setError('Failed to load library.');
        } finally {
            setLoading(false);
        }
    }, [session?.access_token]);

    useEffect(() => {
        if (session?.access_token) fetchLibrary();
    }, [fetchLibrary, session?.access_token]);

    useEffect(() => {
        if (!showModal && !showBriefingModal) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setShowModal(false);
            setShowBriefingModal(false);
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [showModal, showBriefingModal]);

    const openPaperModal = (paper: Paper) => {
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
        setProvenance(paper.summary_metadata?.provenance || paper.summary_provenance || null);
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
            const res = await fetch(`${API_URL}/api/summarize`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ paper_id: selectedPaperId })
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
                setProvenance(data.provenance || null)
            } else {
                setModalError('No summary returned.')
            }
        } catch {
            setModalError('Error fetching summary.')
        } finally {
            setModalLoading(false)
        }
    }

    const handleRetryBriefing = async (briefing: Podcast, event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!session) return;
        setRetryingBriefingId(briefing.id);
        setError('');
        try {
            const response = await fetch(`${API_URL}/api/daily-podcast/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ date: briefing.date }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Failed to retry research briefing.');
            await fetchLibrary();
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Failed to retry research briefing.';
            setError(message);
        } finally {
            setRetryingBriefingId(null);
        }
    };

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

            fetch(`${API_URL}/api/tts`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ paper_id: selectedPaperId })
            })
                .then(async res => {
                    if (!res.ok) throw new Error('Failed to fetch audio');
                    const blob = await res.blob();
                    setAudioUrl(URL.createObjectURL(blob));
                })
                .catch(err => setAudioError(err.message))
                .finally(() => setAudioLoading(false));
        }
    }, [summary, selectedPaperId, session?.access_token]);

    if (!session) {
        return <div className="library-container"><p>Please log in to view your library.</p></div>
    }

    return (
        <div className="library-container">
            <section className="page-heading library-heading" aria-labelledby="library-title">
                <p className="eyebrow">Saved intelligence</p>
                <h1 id="library-title">Your research library.</h1>
                <p>Articles and briefings, organized into one working archive.</p>
            </section>

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
                    let items: LibraryItem[] = [];
                    if (filter === 'All' || filter === 'Articles') {
                        items = items.concat(papers.map(p => ({ ...p, type: 'paper' as const, sortDate: p.saved_at || '' })));
                    }
                    if (filter === 'All' || filter === 'Briefings') {
                        items = items.concat(briefings.map(b => ({ ...b, type: 'briefing' as const, sortDate: b.created_at || b.date })));
                    }

                    items.sort((a, b) => {
                        return new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime();
                    });

                    return items.map((item) => {
                        if (item.type === 'briefing') {
                            return (
                                <li key={`briefing-${item.id}`} className="briefing-card" onClick={() => {
                                    if (item.status !== 'completed') return;
                                    setSelectedBriefing(item);
                                    setShowBriefingModal(true);
                                }}>
                                    <div className="briefing-rainbow-bg"></div>
                                    <div className="briefing-card-content">
                                        {item.status === 'failed' ? (
                                            <FailedBriefingCardContent
                                                date={item.date}
                                                summary={item.summary}
                                                retrying={retryingBriefingId === item.id}
                                                onRetry={(event) => handleRetryBriefing(item, event)}
                                            />
                                        ) : (
                                            <BriefingCardContent
                                                briefing={item}
                                                onOpen={() => {
                                                    setSelectedBriefing(item);
                                                    setShowBriefingModal(true);
                                                }}
                                                onPlay={() => {
                                                    if (!item.audio_url) return;
                                                    setGlobalAudio({
                                                        url: item.audio_url,
                                                        title: getBriefingTitle(item.title),
                                                    });
                                                }}
                                            />
                                        )}
                                    </div>
                                </li>
                            );
                        } else {
                            return (
                                <li key={`paper-${getPaperId(item)}`} className="result-item">
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
                                        <div><strong>Source:</strong> {getPaperSource(item) || 'No source listed'}</div>
                                        {item.work_type && <div><strong>Type:</strong> {item.work_type.replaceAll('-', ' ')}</div>}
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
                    <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="library-paper-dialog-title" onClick={e => e.stopPropagation()}>
                        <button autoFocus className="modal-close" aria-label="Close paper details" onClick={() => setShowModal(false)}>&times;</button>
                        <h2 id="library-paper-dialog-title">{selectedPaper.title}</h2>

                        <div style={{ marginBottom: '16px', fontSize: '0.98rem', color: 'var(--text-secondary)' }}>
                            <div><strong>Authors:</strong> {selectedPaper.authors?.join(', ') || 'No authors listed'}</div>
                            <div><strong>Source:</strong> {getPaperSource(selectedPaper) || 'No source listed'}</div>
                            {selectedPaper.work_type && <div><strong>Type:</strong> {selectedPaper.work_type.replaceAll('-', ' ')}</div>}
                            <div><strong>Publication Date:</strong> {selectedPaper.publication_date || 'No publication date listed'}</div>
                            <div style={{ marginTop: '10px' }}><strong>Abstract:</strong> {selectedPaper.abstract || 'No abstract listed'}</div>
                        </div>

                        {modalError && <p style={{ color: 'red' }}>{modalError}</p>}
                        {!summary && !modalLoading && (
                            <div className="modal-actions">
                                <button onClick={handleGenerateSummary} className="action-btn">Generate Grounded Summary</button>
                            </div>
                        )}
                        {modalLoading && <p>Checking source access and grounding claims...</p>}
                        {summary && (
                            <div>
                                {provenance && <SummaryProvenance provenance={provenance} />}
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
                        <div className="modal-content" role="dialog" aria-modal="true" aria-label="Briefing details" onClick={e => e.stopPropagation()} style={{
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
                                autoFocus
                                aria-label="Close briefing details"
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

                            <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.5rem' }}>Research Briefing Papers</h2>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
                                The following papers were discussed in your research briefing for {new Date(selectedBriefing.date + 'T00:00:00').toLocaleDateString()}.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {(selectedBriefing.papers_metadata ?? []).map((paper: Paper, idx: number, papers: Paper[]) => (
                                    <div key={idx} style={{ paddingBottom: '16px', borderBottom: idx < papers.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                        <h3 style={{ fontSize: '1.1rem', marginBottom: '8px', color: 'var(--text-primary)' }}>{paper.title}</h3>
                                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                            {paper.authors?.slice(0, 3).join(', ')}{paper.authors?.length > 3 ? ' et al.' : ''} • {getPaperSource(paper)}
                                        </div>
                                        <p style={{ fontSize: '0.9rem', lineHeight: '1.5', margin: 0, opacity: 0.9 }}>
                                            {paper.abstract?.slice(0, 200)}...
                                        </p>
                                        {paper.summary_provenance && <SummaryProvenance provenance={paper.summary_provenance} compact />}
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
