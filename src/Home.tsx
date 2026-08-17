
import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { API_URL } from './config';
import DailyPodcast from './DailyPodcast.tsx';
import SummaryProvenance from './components/SummaryProvenance';
import { getPaperId, getPaperSource } from './papers';
import type { Paper, SummaryProvenance as SummaryProvenanceData } from './types';

interface HomeProps {
    session: Session | null;
    authLoading: boolean;
    setGlobalAudio: (audio: { url: string; title: string } | null) => void;
    globalAudio: { url: string; title: string } | null;
    isPlaying: boolean;
    setIsPlaying: (playing: boolean) => void;
}

export default function Home({ session, authLoading, setGlobalAudio, globalAudio, isPlaying, setIsPlaying }: HomeProps) {
    const [query, setQuery] = useState('')
    const [searchedQuery, setSearchedQuery] = useState('')
    const [hasSearched, setHasSearched] = useState(false)
    const [results, setResults] = useState<Paper[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    // Modal State
    const [summary, setSummary] = useState('')
    const [showModal, setShowModal] = useState(false)
    const [modalLoading, setModalLoading] = useState(false)
    const [modalError, setModalError] = useState('')
    const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null)
    const [provenance, setProvenance] = useState<SummaryProvenanceData | null>(null)

    // Audio State
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioLoading, setAudioLoading] = useState(false);
    const [audioError, setAudioError] = useState('');

    const [recommendations, setRecommendations] = useState<Paper[]>([])
    const [recLoading, setRecLoading] = useState(false)
    const [recError, setRecError] = useState('')
    const [recType, setRecType] = useState('Trending Today')
    const selectedPaperId = selectedPaper ? getPaperId(selectedPaper) : ''

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault()
        const submittedQuery = query.trim()
        if (!submittedQuery) return
        setHasSearched(true)
        setSearchedQuery(submittedQuery)
        setLoading(true)
        setError('')
        setResults([])
        try {
            const headers: Record<string, string> = {}
            if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
            const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(submittedQuery)}`, { headers })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Search failed')
            setResults(data.results || [])
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Failed to fetch results')
        } finally {
            setLoading(false)
        }
    }

    // Fetch Recommendations on Mount
    useEffect(() => {
        // Wait for auth to initialize before fetching
        if (authLoading) return;

        const fetchRecommendations = async () => {
            setRecLoading(true);
            try {
                const headers: Record<string, string> = {};
                if (session?.access_token) {
                    headers['Authorization'] = `Bearer ${session.access_token}`;
                }

                const res = await fetch(`${API_URL}/api/recommendations`, { headers });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Recommendations could not be loaded.');
                setRecommendations(data.results || []);
                if (data.type) setRecType(data.type);
            } catch {
                console.error('Failed to load recommendations');
                setRecError('Could not load recommendations. Please try again later.');
            } finally {
                setRecLoading(false);
            }
        };

        // Check if we have valid restoration state
        const restoredResults = window.history.state?.usr?.results;
        const restoredQuery = window.history.state?.usr?.query;

        if (restoredResults && restoredResults.length > 0) {
            setResults(restoredResults);
            setQuery(restoredQuery || '');
            setSearchedQuery(restoredQuery || '');
            setHasSearched(true);
        } else {
            // Only fetch recommendations if we aren't restoring a valid search
            // And if the current state is empty (handled by component mount usually)
            fetchRecommendations();
        }
    }, [session, authLoading]); // Re-fetch when auth finishes or user changes

    useEffect(() => {
        if (!showModal) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setShowModal(false);
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [showModal]);


    const openPaperModal = (paper: Paper) => {
        setSelectedPaper(paper);
        setShowModal(true);
        setSummary('');
        setProvenance(null);
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

            fetch(`${API_URL}/api/tts`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ paper_id: selectedPaperId })
            })
                .then(async res => {
                    if (!res.ok) {
                        let errorMsg = 'Failed to fetch audio.';
                        try {
                            const data = await res.json();
                            errorMsg = data.error || errorMsg;
                        } catch {
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
                    } catch {
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
    }, [summary, selectedPaperId, session?.access_token]);

    return (
        <div className="home-container">
            <section className="home-hero" aria-labelledby="home-title">
                <p className="eyebrow">Research intelligence</p>
                <h1 id="home-title">Find the signal in the literature.</h1>
                <p>Search research across disciplines, save what matters, and turn dense papers into concise audio.</p>
            </section>
            <form onSubmit={handleSearch} className="search-form">
                <label className="sr-only" htmlFor="paper-search">Search papers</label>
                <input
                    id="paper-search"
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search by topic, author, title, or DOI"
                    required
                />
                <button type="submit" disabled={loading}>Search</button>
            </form>
            <div className="search-feedback" aria-live="polite">
                {loading && <p>Searching the literature…</p>}
                {error && <p className="notice notice-error" role="alert">{error}</p>}
            </div>

            {/* Daily Podcast Feature - Hide when searching/results exist */}
            {!hasSearched && (
                <DailyPodcast
                    session={session}
                    setGlobalAudio={setGlobalAudio}
                    globalAudio={globalAudio}
                    isPlaying={isPlaying}
                    onPlayPause={setIsPlaying}
                />
            )}

            {/* Recommendations Header */}
            {!loading && !hasSearched && (
                <div className="section-heading">
                    <h2>
                        {recLoading ? 'Finding articles for you...' : (recError ? 'Error' : recType)}
                    </h2>
                    {recError && <p style={{ color: 'red' }}>{recError}</p>}
                </div>
            )}

            {!loading && hasSearched && !error && (
                <div className="section-heading section-heading-row">
                    <h2>{results.length} {results.length === 1 ? 'result' : 'results'} for “{searchedQuery}”</h2>
                    <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                            setHasSearched(false)
                            setSearchedQuery('')
                            setQuery('')
                            setResults([])
                            setError('')
                        }}
                    >
                        Clear search
                    </button>
                </div>
            )}

            <ul className="results-list">
                {/* Display either search results OR recommendations */}
                {(hasSearched ? results : recommendations).map((paper, idx) => (
                    <li key={getPaperId(paper) || `${paper.title}-${idx}`} className="result-item">
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
                            <div><strong>Source:</strong> {getPaperSource(paper) || 'No source listed'}</div>
                            {paper.work_type && <div><strong>Type:</strong> {paper.work_type.replaceAll('-', ' ')}</div>}
                            <div><strong>Publication Date:</strong> {paper.publication_date || 'No date listed'}</div>
                        </div>
                        {paper.abstract && (
                            <div className="abstract-hover">{paper.abstract}</div>
                        )}
                    </li>
                ))}
            </ul>
            {!loading && hasSearched && !error && results.length === 0 && (
                <div className="empty-state compact-empty-state">
                    <p>No research matched “{searchedQuery}”.</p>
                    <p>Try a broader phrase, an author name, or a DOI.</p>
                </div>
            )}
            {!loading && !recLoading && !hasSearched && recommendations.length === 0 && !recError && (
                <div className="empty-state compact-empty-state">
                    <p>No recommendations found.</p>
                    <p>Try adding or broadening your interests in Settings.</p>
                </div>
            )}
            {showModal && selectedPaper && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="paper-dialog-title" onClick={e => e.stopPropagation()}>
                        <button autoFocus className="modal-close" aria-label="Close paper details" onClick={() => setShowModal(false)}>&times;</button>
                        <h2 id="paper-dialog-title">{selectedPaper.title}</h2>

                        <div style={{ marginBottom: '16px', fontSize: '0.98rem', color: 'var(--text-secondary)' }}>
                            <div><strong>Authors:</strong> {selectedPaper.authors?.join(', ') || 'No authors listed'}</div>
                            <div><strong>Source:</strong> {getPaperSource(selectedPaper) || 'No source listed'}</div>
                            {selectedPaper.work_type && <div><strong>Type:</strong> {selectedPaper.work_type.replaceAll('-', ' ')}</div>}
                            <div><strong>Publication Date:</strong> {selectedPaper.publication_date || 'No publication date listed'}</div>
                            <div style={{ marginTop: '10px' }}><strong>Abstract:</strong> {selectedPaper.abstract || 'No abstract listed'}</div>
                        </div>

                        {!summary && !modalLoading && (
                            <div className="modal-actions">
                                <button
                                    onClick={handleGenerateSummary}
                                    className="action-btn"
                                >
                                    Generate Grounded Summary
                                </button>
                            </div>
                        )}

                        {modalLoading && <p>Checking source access and grounding claims...</p>}
                        {modalError && <p style={{ color: 'red' }}>{modalError}</p>}

                        {!modalLoading && !modalError && summary && (
                            <div style={{ marginTop: '16px' }}>
                                {provenance && <SummaryProvenance provenance={provenance} />}
                                {audioLoading && <p>Loading audio...</p>}
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
                                        <audio controls src={audioUrl}>
                                            Your browser does not support the audio element.
                                        </audio>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
