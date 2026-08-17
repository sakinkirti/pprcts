import type { MouseEvent } from 'react';

interface FailedBriefingCardContentProps {
    date?: string;
    summary?: string;
    retrying?: boolean;
    onRetry: (event: MouseEvent<HTMLButtonElement>) => void;
}

export default function FailedBriefingCardContent({
    date,
    summary,
    retrying = false,
    onRetry,
}: FailedBriefingCardContentProps) {
    const briefingDate = date || new Date().toLocaleDateString('en-CA');

    return (
        <>
            <div className="briefing-failed-copy">
                <h2 className="briefing-title briefing-failed-title">Research Briefing</h2>
                <div className="briefing-meta">
                    {new Date(`${briefingDate}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                    })}
                </div>
                <div className="briefing-status">Generation failed</div>
                <p>{summary || 'Generation failed. You can try again.'}</p>
            </div>
            <button
                type="button"
                className="briefing-play-btn"
                aria-label="Research briefing audio unavailable"
                disabled
            >
                ▶
            </button>
            <div className="briefing-card-actions">
                <button
                    type="button"
                    className="briefing-details-btn"
                    disabled={retrying}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRetry(event);
                    }}
                >
                    {retrying ? 'Retrying…' : 'Retry'}
                </button>
            </div>
        </>
    );
}
