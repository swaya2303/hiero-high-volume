import React from 'react';
import type { JobStats } from '../types.js';

export interface BatchProgressProps {
  /** Statistics object emitted by the batch creation job, or null if not started/reset. */
  stats: JobStats | null;
  /** Label describing the progress bar. Defaults to "Batch job". */
  label?: string;
  /** Whether to show estimated time remaining. Defaults to true. */
  showTimeRemaining?: boolean;
  /** Whether to show the current transaction fee rate in HBAR/s. Defaults to false. */
  showFeeRate?: boolean;
}

const CONTAINER_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  fontFamily: 'var(--font-family-base, inherit)',
  fontSize: 'var(--font-size-base, 14px)',
  color: 'var(--color-text, inherit)',
};

const HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
};

const LABEL_STYLE: React.CSSProperties = {
  fontWeight: 'var(--font-weight-medium, 500)',
};

const DETAILS_STYLE: React.CSSProperties = {
  color: 'var(--color-text-muted, #666)',
  fontSize: 'var(--font-size-sm, 12px)',
};

const TRACK_STYLE: React.CSSProperties = {
  width: '100%',
  height: 'var(--progress-height, 12px)',
  backgroundColor: 'var(--color-progress-track, #e2e8f0)',
  borderRadius: 'var(--border-radius-base, 6px)',
  overflow: 'hidden',
};

const FOOTER_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  color: 'var(--color-text-muted, #666)',
  fontSize: 'var(--font-size-sm, 12px)',
};

// Extracted helper function
export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${String(minutes)}m ${String(seconds)}s` : `${String(seconds)}s`;
}

export function BatchProgress({
  stats,
  label = 'Batch job',
  showTimeRemaining = true,
  showFeeRate = false,
}: BatchProgressProps): React.ReactElement | null {
  if (!stats) {
    return (
      <div style={CONTAINER_STYLE}>
        <div style={HEADER_STYLE}>
          <span style={LABEL_STYLE}>{label}</span>
          <span style={DETAILS_STYLE}>Waiting to start...</span>
        </div>
        <div
          style={TRACK_STYLE}
          role="progressbar"
          aria-valuenow={0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            style={{
              height: '100%',
              backgroundColor: 'var(--color-progress-fill, #3b82f6)',
              width: '0%',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>
    );
  }

  const { completed, total, estimatedRemainingMs, currentFeeRateHbar } = stats;
  // Guard against divide-by-zero if total is 0
  const percentage = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div style={CONTAINER_STYLE}>
      <div style={HEADER_STYLE}>
        <span style={LABEL_STYLE}>{label}</span>
        <span style={DETAILS_STYLE}>
          {String(completed)} / {String(total)} entities
        </span>
      </div>
      <div
        style={TRACK_STYLE}
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div
          style={{
            height: '100%',
            backgroundColor: 'var(--color-progress-fill, #3b82f6)',
            width: `${percentage}%`,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div style={FOOTER_STYLE}>
        <span>
          {showTimeRemaining && estimatedRemainingMs > 0
            ? `Est. remaining: ${formatDuration(estimatedRemainingMs)}`
            : ''}
        </span>
        <span>
          {showFeeRate && currentFeeRateHbar > 0
            ? `Fee rate: ${currentFeeRateHbar.toFixed(4)} HBAR`
            : ''}
        </span>
      </div>
    </div>
  );
}
