/**
 * UITour Component
 *
 * Tour interactif avec spotlight qui guide l'utilisateur
 * a travers les elements cles de l'interface.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { setSidebarOpen } from '../../../store/slices/uiSlice';
import type { AppDispatch } from '../../../store';

const TOUR_COMPLETE_KEY = 'filarr-ui-tour-complete';

interface TourStep {
  targetSelector: string;
  titleKey: string;
  descriptionKey: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

const TOUR_STEPS: TourStep[] = [
  {
    targetSelector: '[data-tour-sidebar]',
    titleKey: 'tour.sidebar.title',
    descriptionKey: 'tour.sidebar.description',
    position: 'right',
  },
  {
    targetSelector: '[data-tour-search]',
    titleKey: 'tour.search.title',
    descriptionKey: 'tour.search.description',
    position: 'bottom',
  },
  {
    targetSelector: '[data-tour-new]',
    titleKey: 'tour.newFolder.title',
    descriptionKey: 'tour.newFolder.description',
    position: 'bottom',
  },
  {
    targetSelector: '[data-tour-notes]',
    titleKey: 'tour.notes.title',
    descriptionKey: 'tour.notes.description',
    position: 'right',
  },
  {
    targetSelector: '[data-tour-collections]',
    titleKey: 'tour.collections.title',
    descriptionKey: 'tour.collections.description',
    position: 'right',
  },
  {
    targetSelector: '[data-tour-automation]',
    titleKey: 'tour.automation.title',
    descriptionKey: 'tour.automation.description',
    position: 'right',
  },
  {
    targetSelector: '[data-tour-trash]',
    titleKey: 'tour.trash.title',
    descriptionKey: 'tour.trash.description',
    position: 'right',
  },
  {
    targetSelector: '[data-tour-theme]',
    titleKey: 'tour.theme.title',
    descriptionKey: 'tour.theme.description',
    position: 'bottom',
  },
  {
    targetSelector: '[data-tour-profile]',
    titleKey: 'tour.profile.title',
    descriptionKey: 'tour.profile.description',
    position: 'bottom',
  },
  {
    targetSelector: '[data-tour-settings]',
    titleKey: 'tour.settings.title',
    descriptionKey: 'tour.settings.description',
    position: 'right',
  },
];

interface TooltipPosition {
  top: number;
  left: number;
}

/**
 * Smart tooltip positioning: tries the preferred position first,
 * then falls back to whichever side has the most space.
 * Ensures the tooltip never covers the target element.
 */
function computeTooltipPosition(
  rect: DOMRect,
  preferredPosition: TourStep['position'],
  tooltipWidth: number,
  tooltipHeight: number
): TooltipPosition {
  const gap = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Available space on each side of the target
  const spaceRight = vw - rect.right - gap;
  const spaceLeft = rect.left - gap;
  const spaceBottom = vh - rect.bottom - gap;
  const spaceTop = rect.top - gap;

  // Try positions in order: preferred first, then best available
  const positions: TourStep['position'][] = [preferredPosition];
  // Add fallbacks sorted by available space
  const sides: { pos: TourStep['position']; space: number }[] = [
    { pos: 'right', space: spaceRight },
    { pos: 'bottom', space: spaceBottom },
    { pos: 'left', space: spaceLeft },
    { pos: 'top', space: spaceTop },
  ];
  sides.sort((a, b) => b.space - a.space);
  for (const s of sides) {
    if (s.pos !== preferredPosition) positions.push(s.pos);
  }

  for (const pos of positions) {
    let top: number;
    let left: number;

    switch (pos) {
      case 'right':
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.right + gap;
        if (left + tooltipWidth <= vw - 8) return { top, left };
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.left - tooltipWidth - gap;
        if (left >= 8) return { top, left };
        break;
      case 'bottom':
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        if (top + tooltipHeight <= vh - 8) return { top, left };
        break;
      case 'top':
        top = rect.top - tooltipHeight - gap;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        if (top >= 8) return { top, left };
        break;
    }
  }

  // Last resort: position below the target, clamped
  return {
    top: Math.min(rect.bottom + gap, vh - tooltipHeight - 8),
    left: Math.max(8, Math.min(rect.left, vw - tooltipWidth - 8)),
  };
}

export interface UITourProps {
  /** Force show tour (for relaunching from Settings/Help) */
  forceShow?: boolean;
  onComplete?: () => void;
}

// Selectors that live inside the sidebar
const SIDEBAR_SELECTORS = new Set([
  '[data-tour-sidebar]',
  '[data-tour-notes]',
  '[data-tour-collections]',
  '[data-tour-automation]',
  '[data-tour-trash]',
  '[data-tour-settings]',
]);

export const UITour: React.FC<UITourProps> = ({ forceShow = false, onComplete }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipSize, setTooltipSize] = useState({ width: 320, height: 160 });

  // Check whether tour should show (on mount + after relaunch event)
  const checkAndShowTour = useCallback(() => {
    const onboardingDone = localStorage.getItem('filarr-onboarding-complete');
    const tourDone = localStorage.getItem(TOUR_COMPLETE_KEY);
    if (onboardingDone && !tourDone) {
      setCurrentStep(0);
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (forceShow) {
      setVisible(true);
      setCurrentStep(0);
      return;
    }

    const cleanup = checkAndShowTour();

    // Listen for relaunch from Settings
    const handleRelaunch = () => {
      setTimeout(() => {
        setCurrentStep(0);
        setVisible(true);
      }, 800);
    };
    window.addEventListener('filarr-tour-relaunch', handleRelaunch);

    return () => {
      cleanup?.();
      window.removeEventListener('filarr-tour-relaunch', handleRelaunch);
    };
  }, [forceShow, checkAndShowTour]);

  const finishTour = useCallback(() => {
    setVisible(false);
    localStorage.setItem(TOUR_COMPLETE_KEY, 'true');
    onComplete?.();
  }, [onComplete]);

  // Find the target element for the current step
  useEffect(() => {
    if (!visible) return undefined;

    let retryCount = 0;
    const maxRetries = 10; // retry for up to ~2s (10 × 200ms)
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const findTarget = () => {
      const step = TOUR_STEPS[currentStep];
      if (!step) return;

      // If this step targets a sidebar element, ensure the sidebar is open
      if (SIDEBAR_SELECTORS.has(step.targetSelector)) {
        dispatch(setSidebarOpen(true));
      }

      const el = document.querySelector(step.targetSelector);
      if (el) {
        const rect = el.getBoundingClientRect();
        // Accept if element is visible and within viewport
        if (rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth) {
          setTargetRect(rect);
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          retryCount = maxRetries; // stop retrying
          return;
        }
      }

      // Element not found yet — retry a few times before skipping
      retryCount++;
      if (retryCount < maxRetries) {
        retryTimer = setTimeout(findTarget, 200);
        return;
      }

      // Exhausted retries — show tooltip centered (element not visible at this size)
      setTargetRect(null);
    };

    // Initial delay to let layout settle
    const initialTimer = setTimeout(findTarget, 200);

    // Re-compute position on resize/scroll (only if already found)
    const updatePosition = () => {
      const step = TOUR_STEPS[currentStep];
      if (!step) return;
      const el = document.querySelector(step.targetSelector);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.right > 0) {
          setTargetRect(rect);
        }
      }
    };

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      clearTimeout(initialTimer);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [visible, currentStep, finishTour]);

  // Measure tooltip size for positioning
  useEffect(() => {
    if (tooltipRef.current) {
      const { offsetWidth, offsetHeight } = tooltipRef.current;
      if (offsetWidth && offsetHeight) {
        setTooltipSize({ width: offsetWidth, height: offsetHeight });
      }
    }
  }, [currentStep, visible]);

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      finishTour();
    }
  }, [currentStep, finishTour]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const handleSkip = useCallback(() => {
    finishTour();
  }, [finishTour]);

  if (!visible) return null;

  const step = TOUR_STEPS[currentStep];
  const isLast = currentStep === TOUR_STEPS.length - 1;
  const isFirst = currentStep === 0;

  // Compute spotlight cutout and tooltip position
  const padding = 8;
  const spotlightRect = targetRect
    ? {
        x: targetRect.left - padding,
        y: targetRect.top - padding,
        width: targetRect.width + padding * 2,
        height: targetRect.height + padding * 2,
        rx: 8,
      }
    : null;

  const tooltipPos =
    targetRect && step
      ? computeTooltipPosition(targetRect, step.position, tooltipSize.width, tooltipSize.height)
      : { top: window.innerHeight / 2 - 80, left: window.innerWidth / 2 - 160 };

  // Clamp tooltip to viewport
  const clampedPos = {
    top: Math.max(8, Math.min(tooltipPos.top, window.innerHeight - tooltipSize.height - 8)),
    left: Math.max(8, Math.min(tooltipPos.left, window.innerWidth - tooltipSize.width - 8)),
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    >
      {/* Dark overlay with spotlight cutout using box-shadow */}
      {spotlightRect ? (
        <div
          style={{
            position: 'absolute',
            top: spotlightRect.y,
            left: spotlightRect.x,
            width: spotlightRect.width,
            height: spotlightRect.height,
            borderRadius: spotlightRect.rx,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            pointerEvents: 'auto',
          }}
        />
      )}

      {/* Clickable backdrop (area outside spotlight) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'auto',
        }}
        onClick={(e) => {
          // Only block clicks, don't close the tour
          e.stopPropagation();
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          top: clampedPos.top,
          left: clampedPos.left,
          width: 320,
          pointerEvents: 'auto',
          zIndex: 10001,
        }}
        className="bg-[var(--color-surface)] rounded-xl shadow-2xl border border-[var(--color-border)] p-5"
      >
        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mb-3">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === currentStep
                  ? 'w-6 bg-[var(--color-primary-500)]'
                  : i < currentStep
                    ? 'w-3 bg-[var(--color-primary-300)]'
                    : 'w-3 bg-[var(--color-neutral-200)]'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <h3
          className="text-base font-semibold mb-1.5"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {step ? t(step.titleKey) : ''}
        </h3>
        <p
          className="text-sm leading-relaxed mb-4"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {step ? t(step.descriptionKey) : ''}
        </p>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="text-xs px-2 py-1 rounded-md transition-colors
              text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]
              hover:bg-[var(--color-hover-overlay)]"
          >
            {t('tour.skip', 'Passer')}
          </button>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={handlePrev}
                className="px-3 py-1.5 text-sm rounded-lg border
                  border-[var(--color-border)] text-[var(--color-text-secondary)]
                  hover:bg-[var(--color-hover-overlay)] transition-colors"
              >
                {t('tour.prev', 'Precedent')}
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-1.5 text-sm rounded-lg font-medium text-white
                bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)]
                transition-colors"
            >
              {isLast ? t('tour.finish', 'Terminer') : t('tour.next', 'Suivant')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UITour;
