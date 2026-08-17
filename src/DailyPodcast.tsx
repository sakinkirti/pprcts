
import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { API_URL } from './config';
import { getBriefingTitle } from './briefing';
import { getPaperSource } from './papers';
import type { Paper, Podcast } from './types';
import SummaryProvenance from './components/SummaryProvenance';
import FailedBriefingCardContent from './components/FailedBriefingCardContent';
import BriefingCardContent from './components/BriefingCardContent';

interface DailyPodcastProps {
    session: Session | null;
    setGlobalAudio: (audio: { url: string; title: string } | null) => void;
    globalAudio: { url: string; title: string } | null;
    isPlaying: boolean;
    onPlayPause: (playing: boolean) => void;
}

export default function DailyPodcast({ session, setGlobalAudio, globalAudio, isPlaying, onPlayPause }: DailyPodcastProps) {
    const [podcast, setPodcast] = useState<Podcast | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);

    useEffect(() => {
        let isStopped = false;
        let pollTimer: ReturnType<typeof setTimeout> | null = null;

        if (!session) {
            setPodcast(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');

        const fetchDailyPodcast = async () => {
            if (!session || isStopped) return;

            try {
                const res = await fetch(`${API_URL}/api/daily-podcast`, {
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`
                    }
                });

                if (res.status === 404) {
                    setPodcast(null);
                    setLoading(false);
                    return;
                }

                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error || `Server error: ${res.status}`);
                }

                const data = await res.json();
                setPodcast(data);

                // Start polling if status is 'generating'
                if (data.status === 'generating' && !isStopped) {
                    pollTimer = setTimeout(fetchDailyPodcast, 10000);
                } else {
                    setLoading(false);
                }
            } catch (caught) {
                const err = caught instanceof Error ? caught : new Error('Could not load the research briefing.');
                console.error('Error loading research briefing:', err);
                setError(err.message || 'Could not load the research briefing.');
                setLoading(false);
            }
        };

        fetchDailyPodcast();

        return () => {
            isStopped = true;
            if (pollTimer) clearTimeout(pollTimer);
        };
    }, [session]);

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

    const handleGenerate = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!session) return;
        setLoading(true);
        setError('');

        const userDate = new Date().toLocaleDateString('en-CA');
        try {
            const res = await fetch(`${API_URL}/api/daily-podcast/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ date: userDate })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Generation failed');
            }

            const data = await res.json();
            setPodcast(data);
        } catch (caught) {
            const err = caught instanceof Error ? caught : new Error('Failed to generate briefing.');
            console.error('Generation error:', err);
            setError(err.message || 'Failed to generate briefing.');
        } finally {
            setLoading(false);
        }
    };

    if (!session) return null;

    const briefingTitle = getBriefingTitle(podcast?.title);
    const userDate = new Date().toLocaleDateString('en-CA');
    const isCurrentBriefing = podcast?.date === userDate;
    const hasFailed = Boolean(error) || podcast?.status === 'failed';

    // If not loaded yet, show nothing or skeleton?
    // If not generated (podcast is null and not loading), show Generate Card


    return (
        <>
            <div
                className="briefing-card daily-podcast-card"
                onClick={() => podcast?.status === 'completed' && setShowModal(true)}
            >
                {/* Rainbow Border Gradient */}
                <div className="briefing-rainbow-bg daily-rainbow-bg" />

                <div className="briefing-card-content">
                    {hasFailed ? (
                        <FailedBriefingCardContent
                            date={podcast?.date || userDate}
                            summary={error || podcast?.summary}
                            retrying={loading}
                            onRetry={handleGenerate}
                        />
                    ) : podcast ? (
                        <BriefingCardContent
                            briefing={podcast}
                            isPlaying={globalAudio?.url === podcast.audio_url && isPlaying}
                            onOpen={podcast.status === 'completed' ? () => setShowModal(true) : undefined}
                            onPlay={() => {
                                if (!podcast.audio_url) return;
                                const isCurrentTrack = globalAudio?.url === podcast.audio_url;
                                if (isCurrentTrack) {
                                    onPlayPause(!isPlaying);
                                } else {
                                    setGlobalAudio({
                                        url: podcast.audio_url,
                                        title: `Research Briefing: ${briefingTitle}`,
                                    });
                                }
                            }}
                            actions={!isCurrentBriefing ? (
                                <button type="button" className="briefing-details-btn" onClick={handleGenerate}>
                                    Generate new briefing
                                </button>
                            ) : undefined}
                        />
                    ) : loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)' }}>
                            <div className="loading-spinner" style={{ width: '16px', height: '16px', border: '2px solid var(--text-secondary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                            <span style={{ fontSize: '0.9rem' }}>Loading...</span>
                        </div>
                    ) : (
                        /* Generate State */
                        <div className="daily-generate-row">
                            <div>
                                <h2 className="daily-briefing-kicker">
                                    Research Briefing
                                </h2>
                                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    Generate a personalized audio update whenever you are ready.
                                </p>
                            </div>
                            <button
                                onClick={handleGenerate}
                                className="action-btn"
                            >
                                Generate
                            </button>
                        </div>
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
                    <div className="modal-content" role="dialog" aria-modal="true" aria-label="Research briefing papers" onClick={e => e.stopPropagation()} style={{
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
                            aria-label="Close research briefing details"
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

                        <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.5rem' }}>Research Briefing Papers</h2>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
                            The following papers were discussed in your research briefing for {new Date(podcast.date + 'T00:00:00').toLocaleDateString()}.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {(podcast.papers_metadata ?? []).map((paper: Paper, idx: number, papers: Paper[]) => (
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

        </>
    );
}
