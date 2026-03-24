/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BatchProgress } from './BatchProgress.js';
import type { JobStats } from '../types.js';

describe('BatchProgress', () => {
  it('renders "Waiting to start..." when stats is null', () => {
    render(<BatchProgress stats={null} label="My Batch" />);
    
    expect(screen.getByText('My Batch')).toBeInTheDocument();
    expect(screen.getByText('Waiting to start...')).toBeInTheDocument();
    
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '0');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
  });

  it('renders progress correctly based on stats', () => {
    const stats: JobStats = {
      completed: 45,
      failed: 5,
      total: 100,
      elapsedMs: 2000,
      estimatedRemainingMs: 3500,
      currentFeeRateHbar: 0.035,
    };

    render(<BatchProgress stats={stats} />);

    expect(screen.getByText('Batch job')).toBeInTheDocument();
    expect(screen.getByText('45 / 100 entities')).toBeInTheDocument();
    expect(screen.getByText('Est. remaining: 3s')).toBeInTheDocument();
    
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '45');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    
    // Check width of the inner fill div
    const fillDiv = progressbar.firstChild as HTMLElement;
    expect(fillDiv.style.width).toBe('45%');
  });

  it('formats duration correctly including <1s edge case', () => {
    const overrideStats = (ms: number): JobStats => ({
      completed: 10,
      failed: 0,
      total: 100,
      elapsedMs: 100,
      estimatedRemainingMs: ms,
      currentFeeRateHbar: 0.05,
    });

    const { rerender } = render(<BatchProgress stats={overrideStats(500)} />);
    expect(screen.getByText('Est. remaining: <1s')).toBeInTheDocument();

    rerender(<BatchProgress stats={overrideStats(65000)} />);
    expect(screen.getByText('Est. remaining: 1m 5s')).toBeInTheDocument();

    rerender(<BatchProgress stats={overrideStats(120000)} />);
    expect(screen.getByText('Est. remaining: 2m 0s')).toBeInTheDocument();
  });

  it('hides optional elements based on props', () => {
    const stats: JobStats = {
      completed: 10,
      failed: 0,
      total: 100,
      elapsedMs: 1000,
      estimatedRemainingMs: 5000,
      currentFeeRateHbar: 0.05,
    };

    render(
      <BatchProgress 
        stats={stats} 
        showTimeRemaining={false} 
        showFeeRate={true} 
      />
    );

    expect(screen.queryByText(/Est\. remaining/)).not.toBeInTheDocument();
    expect(screen.getByText('Fee rate: 0.0500 HBAR')).toBeInTheDocument();
  });
});
