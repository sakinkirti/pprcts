
import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';

interface DailyPodcastProps {
    session: Session | null;
    setGlobalAudio: (audio: { url: string; title: string } | null) => void;
    globalAudio: { url: string; title: string } | null;
    isPlaying: boolean;
    onPlayPause: (playing: boolean) => void;
}

export default function DailyPodcast({ session, setGlobalAudio, globalAudio, isPlaying, onPlayPause }: DailyPodcastProps) {
    const [podcast, setPodcast] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);

    useEffect(() => {
        const fetchDailyPodcast = async () => {
            if (!session) return;

            // Avoid refetching if already loaded
            if (podcast) return;

            setLoading(true);
            try {
                const res = await fetch('http://localhost:5001/api/daily-podcast', {
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`
                    }
                });

                if (res.status === 404) {
                    setLoading(false);
                    return;
                }

                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error || `Server error: ${res.status}`);
                }

                const data = await res.json();
                setPodcast(data);
            } catch (err: any) {
                console.error('Error loading daily podcast:', err);
                setError(err.message || 'Could not load daily podcast.');
            } finally {
                setLoading(false);
            }
        };

        const timer = setTimeout(() => {
            fetchDailyPodcast();
        }, 2500);

        return () => clearTimeout(timer);
    }, [session]);

    if (!session) return null;
    if (!loading && !podcast && !error) return null;

    return (
        <>
            <div
                className="daily-podcast-card"
                onClick={() => podcast && setShowModal(true)}
                style={{
                    position: 'relative',
                    width: '100%',
                    maxWidth: '700px', // Fill column space
                    background: 'var(--bg-card)',
                    borderRadius: '16px',
                    padding: '2px', // Space for the rainbow border
                    marginBottom: '16px', // Match .result-item margin
                    backgroundClip: 'padding-box',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)', // Match .result-item shadow base
                    overflow: 'hidden',
                    cursor: podcast ? 'pointer' : 'default',
                    transition: 'box-shadow 0.2s ease',
                }}
                onMouseEnter={e => {
                    if (podcast) e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.15)'
                }}
                onMouseLeave={e => {
                    if (podcast) e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
            >
                {/* Rainbow Border Gradient */}
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: '16px',
                    background: 'linear-gradient(45deg, #ff0000, #ff7300, #fffb00, #48ff00, #00ffd5, #002bff, #7a00ff, #ff00c8, #ff0000)',
                    backgroundSize: '400% 400%',
                    animation: 'rainbow-border 10s ease infinite',
                    zIndex: 0
                }} />

                <div style={{
                    position: 'relative',
                    background: 'var(--bg-card)',
                    borderRadius: '14px',
                    padding: '22px 26px', // Match .result-item padding (24-2, 28-2)
                    zIndex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                }}>
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)' }}>
                            <div className="loading-spinner" style={{ width: '16px', height: '16px' }}></div>
                            <span style={{ fontSize: '0.9rem' }}>Curating your daily briefing...</span>
                        </div>
                    ) : error ? (
                        <div style={{ color: 'red', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{error}</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    window.location.reload();
                                }}
                                style={{
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem'
                                }}
                            >
                                Retry
                            </button>
                        </div>
                    ) : (
                        <>
                            <div style={{ paddingRight: '50px' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                                    <h2 style={{
                                        fontSize: '1.1rem', // Match .result-item a
                                        fontWeight: 600, // Slightly bolder but close to 500
                                        margin: 0,
                                        background: 'linear-gradient(90deg, #ff00c8, #7a00ff)',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                    }}>
                                        Daily Briefing /
                                    </h2>
                                    {podcast.title && (
                                        <span style={{ fontSize: '1.1rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                            {podcast.title.replace(/^Daily Research Update: .*$/, 'Wait for generation...').replace(/^Title: /, '') /* Cleanup if generation raw */}
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    {new Date(podcast.date || new Date()).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                                </div>
                                {podcast.summary && (
                                    <p style={{
                                        fontSize: '0.95rem',
                                        color: 'var(--text-primary)',
                                        margin: '12px 0 0 0',
                                        lineHeight: '1.5',
                                        opacity: 0.9
                                    }}>
                                        {podcast.summary}
                                    </p>
                                )}
                            </div>

                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const isCurrentTrack = globalAudio?.url === podcast.audio_url;

                                    if (isCurrentTrack) {
                                        onPlayPause(!isPlaying);
                                    } else {
                                        setGlobalAudio({
                                            url: podcast.audio_url,
                                            title: "Daily Briefing: " + podcast.title
                                        });
                                    }
                                }}
                                style={{
                                    position: 'absolute',
                                    top: '22px',
                                    right: '26px',
                                    width: '48px',
                                    height: '48px',
                                    minWidth: '48px', // Force circle
                                    borderRadius: '50%',
                                    padding: 0, // Remove default padding
                                    background: 'var(--accent)',
                                    border: 'none',
                                    color: 'white',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 10px rgba(59, 130, 246, 0.3)',
                                    zIndex: 10,
                                    fontSize: '1.5rem',
                                    lineHeight: '1',
                                }}
                            >
                                {globalAudio?.url === podcast.audio_url && isPlaying ? '⏸' : '▶'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Papers Modal */}
            {showModal && podcast && (
                <div className="modal-overlay" onClick={() => setShowModal(false)} style={{
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
                            onClick={() => setShowModal(false)}
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
                            The following papers were discussed in your daily briefing for {new Date(podcast.date).toLocaleDateString()}.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {podcast.papers_metadata && podcast.papers_metadata.map((paper: any, idx: number) => (
                                <div key={idx} style={{ paddingBottom: '16px', borderBottom: idx < podcast.papers_metadata.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                    <h3 style={{ fontSize: '1.1rem', marginBottom: '8px', color: 'var(--text-primary)' }}>{paper.title}</h3>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                        {paper.authors?.slice(0, 3).join(', ')}{paper.authors?.length > 3 ? ' et al.' : ''} • {paper.journal}
                                    </div>
                                    <p style={{ fontSize: '0.9rem', lineHeight: '1.5', margin: 0, opacity: 0.9 }}>
                                        {paper.abstract?.slice(0, 200)}...
                                    </p>
                                </div>
                            ))}
                            {!podcast.papers_metadata && (
                                <p>Paper details not available for this episode.</p>
                            )}
                        </div>

                        {podcast.transcript && (
                            <details style={{ marginTop: '24px' }}>
                                <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 500 }}>View Full Transcript</summary>
                                <p style={{ marginTop: '12px', whiteSpace: 'pre-wrap', fontSize: '0.95rem', lineHeight: '1.6', color: 'var(--text-primary)' }}>
                                    {podcast.transcript}
                                </p>
                            </details>
                        )}
                    </div>
                </div>
            )}

            <style>{`
                @keyframes rainbow-border {
                    0% { background-position: 0% 50% }
                    50% { background-position: 100% 50% }
                    100% { background-position: 0% 50% }
                }
            `}</style>
        </>
    );
}
