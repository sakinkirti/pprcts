
import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'
import DailyPodcast from './DailyPodcast.tsx';

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

    const [recommendations, setRecommendations] = useState<any[]>([])
    const [recLoading, setRecLoading] = useState(false)
    const [recError, setRecError] = useState('')
    const [recType, setRecType] = useState('Trending Today')

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        setResults([])
        // Clear recommendations when searching
        setRecommendations([])
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

                // Check for Custom Keywords in Supabase via user_settings table
                let customKeywords = '';
                if (session) {
                    try {
                        const { data } = await supabase
                            .from('user_settings')
                            .select('keywords')
                            .eq('user_id', session.user.id)
                            .single();
                        if (data && data.keywords) {
                            customKeywords = data.keywords;
                        }
                    } catch (err) {
                        // Ignore error (e.g. no settings found), fallback to default
                    }
                }

                const res = await fetch(`http://localhost:5001/api/recommendations?keywords=${encodeURIComponent(customKeywords)}`, { headers });
                const data = await res.json();
                setRecommendations(data.results || []);
                if (data.type) setRecType(data.type);
            } catch (err) {
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
        } else {
            // Only fetch recommendations if we aren't restoring a valid search
            // And if the current state is empty (handled by component mount usually)
            fetchRecommendations();
        }
    }, [session, authLoading]); // Re-fetch when auth finishes or session changes

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

            {/* Daily Podcast Feature - Hide when searching/results exist */}
            {results.length === 0 && (
                <DailyPodcast
                    session={session}
                    setGlobalAudio={setGlobalAudio}
                    globalAudio={globalAudio}
                    isPlaying={isPlaying}
                    onPlayPause={setIsPlaying}
                />
            )}

            {/* Recommendations Header */}
            {!loading && !query && results.length === 0 && (
                <div style={{ width: '100%', maxWidth: '700px', marginBottom: '10px' }}>
                    <h2 style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                        {recLoading ? 'Finding articles for you...' : (recError ? 'Error' : recType)}
                    </h2>
                    {recError && <p style={{ color: 'red' }}>{recError}</p>}
                </div>
            )}

            <ul className="results-list">
                {/* Display either search results OR recommendations */}
                {(results.length > 0 ? results : recommendations).map((paper, idx) => (
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
            {!loading && !recLoading && !query && results.length === 0 && recommendations.length === 0 && !recError && (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '40px' }}>
                    <p>No articles found.</p>
                    <p style={{ fontSize: '0.9rem' }}>Try adjusting your keywords in Settings.</p>
                </div>
            )}
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
