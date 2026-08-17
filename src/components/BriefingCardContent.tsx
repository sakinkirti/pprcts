import type { ReactNode } from 'react';

import { getBriefingTitle } from '../briefing';
import type { Podcast } from '../types';

interface BriefingCardContentProps {
    briefing: Podcast;
    isPlaying?: boolean;
    onOpen?: () => void;
    onPlay: () => void;
    actions?: ReactNode;
}

export default function BriefingCardContent({
    briefing,
    isPlaying = false,
    onOpen,
    onPlay,
    actions,
}: BriefingCardContentProps) {
    const isCompleted = briefing.status === 'completed';
    const isPlayable = isCompleted && Boolean(briefing.audio_url);
    const title = isCompleted ? getBriefingTitle(briefing.title) : 'Research Briefing';
    const statusLabel = briefing.status === 'queued' || briefing.status === 'generating'
        ? 'Generating…'
        : !briefing.audio_url
            ? 'Audio unavailable'
            : null;

    return (
        <>
            <div className="briefing-copy">
                <div className="briefing-kicker">Research Briefing /</div>
                {isCompleted && onOpen ? (
                    <button
                        type="button"
                        className="briefing-title briefing-title-button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpen();
                        }}
                    >
                        {title}
                    </button>
                ) : (
                    <h2 className="briefing-title briefing-title-static">{title}</h2>
                )}
                <div className="briefing-meta briefing-date">
                    {new Date(`${briefing.date}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                    })}
                </div>
                {statusLabel && <div className="briefing-status">{statusLabel}</div>}
                {briefing.summary && <p>{briefing.summary}</p>}
            </div>
            <button
                type="button"
                className="briefing-play-btn"
                aria-label={!isPlayable
                    ? `${title} audio unavailable`
                    : isPlaying
                        ? `Pause ${title}`
                        : `Play ${title}`}
                disabled={!isPlayable}
                onClick={(event) => {
                    event.stopPropagation();
                    if (isPlayable) onPlay();
                }}
            >
                {isPlaying ? '⏸' : '▶'}
            </button>
            {actions && <div className="briefing-card-actions">{actions}</div>}
        </>
    );
}
