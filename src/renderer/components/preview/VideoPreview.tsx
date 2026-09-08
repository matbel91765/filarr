/**
 * VideoPreview Component
 *
 * Video player with playback controls.
 * Supports common video formats: mp4, webm, ogg, mov, avi, mkv.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import './FilePreviewPanel.css';

export interface VideoPreviewProps {
  /** Video data as ArrayBuffer (buffered mode; ignored when streamUrl is set) */
  data?: ArrayBuffer;
  /** Direct media URL (e.g. filarr-stream://…) — streamed, no blob URL created */
  streamUrl?: string;
  /** File name */
  fileName: string;
  /** MIME type of the video */
  mimeType: string;
  /** Additional CSS class */
  className?: string;
}

// SVG Icons
const PlayIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
    viewBox="0 0 24 24"
    width="24"
    height="24"
  >
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
    viewBox="0 0 24 24"
    width="24"
    height="24"
  >
    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
  </svg>
);

const VolumeHighIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
    />
  </svg>
);

const VolumeMuteIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
    />
  </svg>
);

const FullscreenIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m10.5-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-10.5 10.5v-4.5m0 4.5h4.5m-4.5 0L9 15m10.5 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15"
    />
  </svg>
);

const SkipBackIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 16.811c0 .864-.933 1.405-1.683.977l-7.108-4.062a1.125 1.125 0 010-1.953l7.108-4.062A1.125 1.125 0 0121 8.688v8.123zM11.25 16.811c0 .864-.933 1.405-1.683.977l-7.108-4.062a1.125 1.125 0 010-1.953L9.567 7.71a1.125 1.125 0 011.683.977v8.123z"
    />
  </svg>
);

const SkipForwardIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062A1.125 1.125 0 013 16.811V8.688zM12.75 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062a1.125 1.125 0 01-1.683-.977V8.688z"
    />
  </svg>
);

const PictureInPictureIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"
    />
  </svg>
);

const SpeedIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

// Playback speed options
const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Format time in seconds to MM:SS or HH:MM:SS
 */
const formatTime = (seconds: number): string => {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  data,
  streamUrl,
  fileName,
  mimeType,
  className,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);

  // Media source: direct streaming URL when provided (filarr-stream://…),
  // otherwise a blob URL built from the in-memory ArrayBuffer.
  const { videoUrl, objectUrl } = useMemo((): {
    videoUrl: string | null;
    objectUrl: string | null;
  } => {
    if (streamUrl) {
      return { videoUrl: streamUrl, objectUrl: null };
    }
    if (!data) {
      return { videoUrl: null, objectUrl: null };
    }
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    return { videoUrl: url, objectUrl: url };
  }, [data, mimeType, streamUrl]);

  // Cleanup on unmount — only revoke blob URLs we created (never the stream URL)
  useEffect(() => {
    if (!objectUrl) return undefined;
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  // Handle video loaded
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  }, []);

  // Handle time update
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  // Handle play/pause
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  }, [isPlaying]);

  // Handle play state changes
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  }, []);

  // Handle error
  const handleError = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    console.error('[VideoPreview] Error loading video:', e);
    setError('Impossible de charger la video');
    setIsLoading(false);
  }, []);

  // Handle mute/unmute
  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;

    const newMuted = !isMuted;
    videoRef.current.muted = newMuted;
    setIsMuted(newMuted);
  }, [isMuted]);

  // Handle volume change
  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVolume = parseFloat(e.target.value);
      setVolume(newVolume);

      if (videoRef.current) {
        videoRef.current.volume = newVolume;
        if (newVolume === 0) {
          setIsMuted(true);
          videoRef.current.muted = true;
        } else if (isMuted) {
          setIsMuted(false);
          videoRef.current.muted = false;
        }
      }
    },
    [isMuted]
  );

  // Handle seek
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  }, []);

  // Skip forward/backward
  const skipForward = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.min(videoRef.current.currentTime + 10, duration);
    }
  }, [duration]);

  const skipBackward = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(videoRef.current.currentTime - 10, 0);
    }
  }, []);

  // Handle fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error('[VideoPreview] Fullscreen error:', err);
    }
  }, []);

  // Handle picture-in-picture
  const togglePiP = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error('[VideoPreview] PiP error:', err);
    }
  }, []);

  // Handle playback speed change
  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setShowSpeedMenu(false);
  }, []);

  // Toggle speed menu
  const toggleSpeedMenu = useCallback(() => {
    setShowSpeedMenu((prev) => !prev);
  }, []);

  // Close speed menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setShowSpeedMenu(false);
      }
    };

    if (showSpeedMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSpeedMenu]);

  // Auto-hide controls
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);

    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }

    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [isPlaying]);

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        skipBackward();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        skipForward();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume((prev) => Math.min(prev + 0.1, 1));
        if (videoRef.current) {
          videoRef.current.volume = Math.min(volume + 0.1, 1);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume((prev) => Math.max(prev - 0.1, 0));
        if (videoRef.current) {
          videoRef.current.volume = Math.max(volume - 0.1, 0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleMute, toggleFullscreen, skipBackward, skipForward, volume]);

  // Progress percentage
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const containerClasses = clsx(
    'video-preview',
    {
      'video-preview--fullscreen': isFullscreen,
      'video-preview--controls-hidden': !showControls && isPlaying,
    },
    className
  );

  if (error || !videoUrl) {
    return (
      <div className={containerClasses}>
        <div className="video-preview__error">
          <span>Impossible de charger la video</span>
          <p className="video-preview__error-message">
            {error ?? 'Aucune source video disponible'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={containerClasses}
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* Video Element */}
      <div className="video-preview__container" onClick={togglePlay}>
        {isLoading && (
          <div className="video-preview__loading">
            <div className="video-preview__spinner" />
            <span>Chargement de la video...</span>
          </div>
        )}
        <video
          ref={videoRef}
          src={videoUrl}
          className="video-preview__video"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onError={handleError}
          preload="metadata"
        />

        {/* Play overlay */}
        {!isPlaying && !isLoading && (
          <div className="video-preview__play-overlay">
            <button className="video-preview__play-button" onClick={togglePlay}>
              <PlayIcon />
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        className={clsx('video-preview__controls', {
          'video-preview__controls--visible': showControls,
        })}
      >
        {/* Progress bar */}
        <div className="video-preview__progress-container">
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={currentTime}
            onChange={handleSeek}
            className="video-preview__progress"
            style={{
              background: `linear-gradient(to right, var(--color-primary-500) ${progressPercent}%, var(--color-neutral-300) ${progressPercent}%)`,
            }}
          />
        </div>

        <div className="video-preview__controls-row">
          {/* Left controls */}
          <div className="video-preview__controls-left">
            <Button
              variant="ghost"
              size="sm"
              onClick={togglePlay}
              title={isPlaying ? 'Pause (Espace)' : 'Lecture (Espace)'}
              aria-label={isPlaying ? 'Pause' : 'Lecture'}
              className="video-preview__control-btn"
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={skipBackward}
              title="Reculer de 10s (Gauche)"
              aria-label="Reculer de 10 secondes"
              className="video-preview__control-btn"
            >
              <SkipBackIcon />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={skipForward}
              title="Avancer de 10s (Droite)"
              aria-label="Avancer de 10 secondes"
              className="video-preview__control-btn"
            >
              <SkipForwardIcon />
            </Button>

            {/* Volume controls */}
            <div className="video-preview__volume">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleMute}
                title={isMuted ? 'Activer le son (M)' : 'Couper le son (M)'}
                aria-label={isMuted ? 'Activer le son' : 'Couper le son'}
                className="video-preview__control-btn"
              >
                {isMuted || volume === 0 ? <VolumeMuteIcon /> : <VolumeHighIcon />}
              </Button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="video-preview__volume-slider"
                title={`Volume: ${Math.round(volume * 100)}%`}
              />
            </div>

            {/* Time display */}
            <span className="video-preview__time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Right controls */}
          <div className="video-preview__controls-right">
            {/* Playback Speed Control */}
            <div className="video-preview__speed-control" ref={speedMenuRef}>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSpeedMenu}
                title="Vitesse de lecture"
                aria-label="Vitesse de lecture"
                className="video-preview__control-btn video-preview__speed-btn"
              >
                <SpeedIcon />
                <span className="video-preview__speed-value">{playbackSpeed}x</span>
              </Button>

              {showSpeedMenu && (
                <div className="video-preview__speed-menu">
                  {PLAYBACK_SPEEDS.map((speed) => (
                    <button
                      key={speed}
                      className={clsx('video-preview__speed-option', {
                        'video-preview__speed-option--active': playbackSpeed === speed,
                      })}
                      onClick={() => handleSpeedChange(speed)}
                    >
                      {speed === 1 ? 'Normal' : `${speed}x`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={togglePiP}
              title="Picture-in-Picture"
              aria-label="Picture-in-Picture"
              className="video-preview__control-btn"
            >
              <PictureInPictureIcon />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFullscreen}
              title="Plein ecran (F)"
              aria-label="Plein ecran"
              className="video-preview__control-btn"
            >
              <FullscreenIcon />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPreview;
