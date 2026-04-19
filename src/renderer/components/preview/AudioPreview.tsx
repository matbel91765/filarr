/**
 * AudioPreview Component
 *
 * Audio player with playback controls and waveform visualization.
 * Supports common audio formats: mp3, wav, ogg, flac, aac, m4a.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import './FilePreviewPanel.css';

export interface AudioPreviewProps {
  /** Audio data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** MIME type of the audio */
  mimeType: string;
  /** Additional CSS class */
  className?: string;
}

// SVG Icons
const PlayIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="32" height="32">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="32" height="32">
    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
  </svg>
);

const VolumeHighIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
  </svg>
);

const VolumeLowIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
  </svg>
);

const VolumeMuteIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
  </svg>
);

const RepeatIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
  </svg>
);

const MusicNoteIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="64" height="64">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
  </svg>
);

const SkipBackIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 16.811c0 .864-.933 1.405-1.683.977l-7.108-4.062a1.125 1.125 0 010-1.953l7.108-4.062A1.125 1.125 0 0121 8.688v8.123zM11.25 16.811c0 .864-.933 1.405-1.683.977l-7.108-4.062a1.125 1.125 0 010-1.953L9.567 7.71a1.125 1.125 0 011.683.977v8.123z" />
  </svg>
);

const SkipForwardIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062A1.125 1.125 0 013 16.811V8.688zM12.75 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062a1.125 1.125 0 01-1.683-.977V8.688z" />
  </svg>
);

/**
 * Format time in seconds to MM:SS
 */
const formatTime = (seconds: number): string => {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

export const AudioPreview: React.FC<AudioPreviewProps> = ({
  data,
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
  const [isLooping, setIsLooping] = useState(false);
  const [waveformData, setWaveformData] = useState<number[]>([]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  // Convert ArrayBuffer to blob URL
  const audioUrl = useMemo(() => {
    const blob = new Blob([data], { type: mimeType });
    return URL.createObjectURL(blob);
  }, [data, mimeType]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(audioUrl);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [audioUrl]);

  // Generate waveform data from audio
  useEffect(() => {
    const generateWaveform = async () => {
      try {
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(data.slice(0));
        const channelData = audioBuffer.getChannelData(0);

        // Sample the audio data to create waveform bars
        const samples = 100;
        const blockSize = Math.floor(channelData.length / samples);
        const waveform: number[] = [];

        for (let i = 0; i < samples; i++) {
          const start = blockSize * i;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(channelData[start + j] || 0);
          }
          waveform.push(sum / blockSize);
        }

        // Normalize
        const max = Math.max(...waveform);
        const normalized = waveform.map(val => val / max);

        setWaveformData(normalized);
        audioContext.close();
      } catch (err) {
        console.warn('[AudioPreview] Could not generate waveform:', err);
        // Generate placeholder waveform
        setWaveformData(Array(100).fill(0).map(() => 0.3 + Math.random() * 0.7));
      }
    };

    generateWaveform();
  }, [data]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const { width, height } = canvas;
      const barWidth = width / waveformData.length;
      const progressPercent = duration > 0 ? currentTime / duration : 0;
      const progressBars = Math.floor(waveformData.length * progressPercent);

      ctx.clearRect(0, 0, width, height);

      waveformData.forEach((value, index) => {
        const barHeight = value * height * 0.8;
        const x = index * barWidth;
        const y = (height - barHeight) / 2;

        // Use different colors for played vs unplayed portions
        if (index < progressBars) {
          ctx.fillStyle = 'var(--color-primary-500)';
        } else {
          ctx.fillStyle = 'var(--color-neutral-300)';
        }

        ctx.fillRect(x, y, barWidth - 1, barHeight);
      });
    };

    draw();
  }, [waveformData, currentTime, duration]);

  // Handle audio loaded
  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      setIsLoading(false);
    }
  }, []);

  // Handle time update
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  // Handle play/pause
  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  }, [isPlaying]);

  // Handle play state changes
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleEnded = useCallback(() => {
    if (!isLooping) {
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
    }
  }, [isLooping]);

  // Handle error
  const handleError = useCallback(() => {
    setError('Impossible de charger le fichier audio');
    setIsLoading(false);
  }, []);

  // Handle mute/unmute
  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;

    const newMuted = !isMuted;
    audioRef.current.muted = newMuted;
    setIsMuted(newMuted);
  }, [isMuted]);

  // Handle volume change
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);

    if (audioRef.current) {
      audioRef.current.volume = newVolume;
      if (newVolume === 0) {
        setIsMuted(true);
        audioRef.current.muted = true;
      } else if (isMuted) {
        setIsMuted(false);
        audioRef.current.muted = false;
      }
    }
  }, [isMuted]);

  // Handle seek
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  }, []);

  // Handle waveform click
  const handleWaveformClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !audioRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const newTime = percent * duration;

    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  // Skip forward/backward
  const skipForward = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(audioRef.current.currentTime + 10, duration);
    }
  }, [duration]);

  const skipBackward = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(audioRef.current.currentTime - 10, 0);
    }
  }, []);

  // Toggle loop
  const toggleLoop = useCallback(() => {
    if (audioRef.current) {
      const newLooping = !isLooping;
      audioRef.current.loop = newLooping;
      setIsLooping(newLooping);
    }
  }, [isLooping]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'l') {
        e.preventDefault();
        toggleLoop();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        skipBackward();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        skipForward();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleMute, toggleLoop, skipBackward, skipForward]);

  // Progress percentage
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Get volume icon
  const getVolumeIcon = () => {
    if (isMuted || volume === 0) return <VolumeMuteIcon />;
    if (volume < 0.5) return <VolumeLowIcon />;
    return <VolumeHighIcon />;
  };

  const containerClasses = clsx('audio-preview', className);

  if (error) {
    return (
      <div className={containerClasses}>
        <div className="audio-preview__error">
          <MusicNoteIcon />
          <span>Impossible de charger l'audio</span>
          <p className="audio-preview__error-message">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={handleError}
        preload="metadata"
      />

      {/* Artwork / Visualization area */}
      <div className="audio-preview__artwork">
        <div className="audio-preview__icon">
          <MusicNoteIcon />
        </div>
      </div>

      {/* Track info */}
      <div className="audio-preview__track-info">
        <h3 className="audio-preview__track-name" title={fileName}>
          {fileName}
        </h3>
      </div>

      {/* Waveform visualization */}
      <div className="audio-preview__waveform-container">
        <canvas
          ref={canvasRef}
          className="audio-preview__waveform"
          width={400}
          height={80}
          onClick={handleWaveformClick}
        />
      </div>

      {/* Progress bar */}
      <div className="audio-preview__progress-container">
        <span className="audio-preview__time">{formatTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          onChange={handleSeek}
          className="audio-preview__progress"
          style={{
            background: `linear-gradient(to right, var(--color-primary-500) ${progressPercent}%, var(--color-neutral-300) ${progressPercent}%)`,
          }}
        />
        <span className="audio-preview__time">{formatTime(duration)}</span>
      </div>

      {/* Playback controls */}
      <div className="audio-preview__controls">
        <Button
          variant="ghost"
          size="sm"
          onClick={skipBackward}
          title="Reculer de 10s (Gauche)"
          aria-label="Reculer de 10 secondes"
          className="audio-preview__control-btn"
        >
          <SkipBackIcon />
        </Button>

        <button
          className={clsx('audio-preview__play-btn', { 'audio-preview__play-btn--playing': isPlaying })}
          onClick={togglePlay}
          disabled={isLoading}
          title={isPlaying ? 'Pause (Espace)' : 'Lecture (Espace)'}
          aria-label={isPlaying ? 'Pause' : 'Lecture'}
        >
          {isLoading ? (
            <div className="audio-preview__spinner-small" />
          ) : isPlaying ? (
            <PauseIcon />
          ) : (
            <PlayIcon />
          )}
        </button>

        <Button
          variant="ghost"
          size="sm"
          onClick={skipForward}
          title="Avancer de 10s (Droite)"
          aria-label="Avancer de 10 secondes"
          className="audio-preview__control-btn"
        >
          <SkipForwardIcon />
        </Button>
      </div>

      {/* Secondary controls */}
      <div className="audio-preview__secondary-controls">
        {/* Loop button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLoop}
          title={isLooping ? 'Desactiver la repetition (L)' : 'Activer la repetition (L)'}
          aria-label={isLooping ? 'Desactiver la repetition' : 'Activer la repetition'}
          className={clsx('audio-preview__control-btn', { 'audio-preview__control-btn--active': isLooping })}
        >
          <RepeatIcon />
        </Button>

        {/* Volume controls */}
        <div className="audio-preview__volume">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMute}
            title={isMuted ? 'Activer le son (M)' : 'Couper le son (M)'}
            aria-label={isMuted ? 'Activer le son' : 'Couper le son'}
            className="audio-preview__control-btn"
          >
            {getVolumeIcon()}
          </Button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="audio-preview__volume-slider"
            title={`Volume: ${Math.round(volume * 100)}%`}
          />
        </div>
      </div>
    </div>
  );
};

export default AudioPreview;
