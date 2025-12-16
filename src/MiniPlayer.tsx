import { useRef, useEffect, useState } from 'react'

interface MiniPlayerProps {
    audioUrl: string;
    title: string;
    onClose: () => void;
}

export default function MiniPlayer({ audioUrl, title, onClose }: MiniPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.play();
        }
    }, [audioUrl]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const updateTime = () => setCurrentTime(audio.currentTime);
        const updateDuration = () => setDuration(audio.duration);
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        audio.addEventListener('timeupdate', updateTime);
        audio.addEventListener('loadedmetadata', updateDuration);
        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);

        return () => {
            audio.removeEventListener('timeupdate', updateTime);
            audio.removeEventListener('loadedmetadata', updateDuration);
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
        };
    }, []);

    const togglePlayPause = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleAudioEnd = () => {
        onClose();
    };

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!audioRef.current) return;
        const progressBar = e.currentTarget;
        const clickX = e.clientX - progressBar.getBoundingClientRect().left;
        const width = progressBar.offsetWidth;
        const newTime = (clickX / width) * duration;
        audioRef.current.currentTime = newTime;
    };

    const formatTime = (seconds: number) => {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="mini-player">
            <div className="mini-player-title" title={title}>
                {title}
            </div>
            <div className="mini-player-controls">
                <button
                    onClick={togglePlayPause}
                    className="mini-player-play-btn"
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                    {isPlaying ? '⏸' : '▶'}
                </button>
                <div className="mini-player-progress-container">
                    <div
                        className="mini-player-progress-bar"
                        onClick={handleProgressClick}
                    >
                        <div
                            className="mini-player-progress-fill"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className="mini-player-time">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="mini-player-close-btn"
                    aria-label="Close"
                >
                    ✕
                </button>
            </div>
            <audio
                ref={audioRef}
                src={audioUrl}
                onEnded={handleAudioEnd}
            />
        </div>
    );
}
