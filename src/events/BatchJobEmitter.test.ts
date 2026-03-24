import {
  TypedEventEmitter,
  BatchJobEmitter,
  buildBatchJob,
} from './BatchJobEmitter.js';

import type {
  BatchJobEvents,
  BatchJobSummary,
} from './BatchJobEmitter.js';

import type {
  EntityCreationResult,
  JobStats,
} from '../types.js';

// ─── TypedEventEmitter type safety ───────────────────────────────────────────

describe('TypedEventEmitter', () => {
  it('should allow registering a listener for a valid event name', () => {
    const emitter = new TypedEventEmitter<BatchJobEvents>();

    // These should compile without error
    emitter.on('progress', (_stats: JobStats) => {});
    emitter.on('entity:created', (_result: EntityCreationResult) => {});
    emitter.on('entity:failed', (_result: EntityCreationResult, _error: unknown) => {});
    emitter.on('job:complete', (_summary: BatchJobSummary) => {});
    emitter.on('job:cancelled', () => {});

    expect(emitter.listenerCount('progress')).toBe(1);
    expect(emitter.listenerCount('entity:created')).toBe(1);
  });

  it('should compile with typed event payloads and reject mismatched types at compile time', () => {
    const emitter = new TypedEventEmitter<BatchJobEvents>();

    // Typed listener — stats is correctly inferred as JobStats
    emitter.on('progress', (stats) => {
      // Type-level assertion: stats.completed must exist
      expect(typeof stats.completed).toBe('number');
    });

    // Verify there is exactly one listener registered
    expect(emitter.listenerCount('progress')).toBe(1);
  });

  it('should emit and receive typed events correctly', () => {
    const emitter = new TypedEventEmitter<BatchJobEvents>();
    const received: JobStats[] = [];

    emitter.on('progress', (stats) => {
      received.push(stats);
    });

    const stats: JobStats = {
      completed: 5,
      failed: 1,
      total: 10,
      elapsedMs: 1000,
      estimatedRemainingMs: 1000,
      currentFeeRateHbar: 0.05,
    };

    emitter.emit('progress', stats);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(stats);
  });

  it('should support once() for single-fire listeners', () => {
    const emitter = new TypedEventEmitter<BatchJobEvents>();
    let callCount = 0;

    emitter.once('job:cancelled', () => {
      callCount++;
    });

    emitter.emit('job:cancelled');
    emitter.emit('job:cancelled');

    expect(callCount).toBe(1);
  });

  it('should support off() to remove listeners', () => {
    const emitter = new TypedEventEmitter<BatchJobEvents>();
    let callCount = 0;

    const listener = (): void => {
      callCount++;
    };

    emitter.on('job:cancelled', listener);
    emitter.emit('job:cancelled');
    emitter.off('job:cancelled', listener);
    emitter.emit('job:cancelled');

    expect(callCount).toBe(1);
  });
});

// ─── BatchJobEmitter ─────────────────────────────────────────────────────────

describe('BatchJobEmitter', () => {
  const makeResult = (
    success: boolean,
    feeChargedHbar?: number,
  ): EntityCreationResult => ({
    entityType: 'account',
    entityId: success ? '0.0.12345' : null,
    success,
    ...(feeChargedHbar !== undefined ? { feeChargedHbar } : {}),
  });

  it('should store jobId and entityType', () => {
    const emitter = new BatchJobEmitter('job-1', 'account');
    expect(emitter.jobId).toBe('job-1');
    expect(emitter.entityType).toBe('account');
  });

  it('should emit progress events via emitProgress', () => {
    const emitter = new BatchJobEmitter('job-1', 'account');
    const received: JobStats[] = [];

    emitter.on('progress', (stats) => received.push(stats));

    const stats: JobStats = {
      completed: 3,
      failed: 0,
      total: 10,
      elapsedMs: 500,
      estimatedRemainingMs: 1167,
      currentFeeRateHbar: 0.1,
    };

    emitter.emitProgress(stats);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(stats);
  });

  it('should emit entity:created events via emitEntityCreated', () => {
    const emitter = new BatchJobEmitter('job-1', 'token');
    const received: EntityCreationResult[] = [];

    emitter.on('entity:created', (result) => received.push(result));

    const result = makeResult(true, 0.05);
    emitter.emitEntityCreated(result);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(result);
  });

  it('should emit entity:failed events with error via emitEntityFailed', () => {
    const emitter = new BatchJobEmitter('job-1', 'topic');
    const received: Array<{ result: EntityCreationResult; error: unknown }> = [];

    emitter.on('entity:failed', (result, error) => {
      received.push({ result, error });
    });

    const result = makeResult(false);
    const error = new Error('tx failed');
    emitter.emitEntityFailed(result, error);

    expect(received).toHaveLength(1);
    expect(received[0]?.result).toBe(result);
    expect(received[0]?.error).toBe(error);
  });

  it('should correctly sum totalFeeChargedHbar in emitComplete', () => {
    const emitter = new BatchJobEmitter('job-fee', 'account');
    let summary: BatchJobSummary | undefined;

    emitter.on('job:complete', (s) => {
      summary = s;
    });

    const results = [
      makeResult(true, 0.05),
      makeResult(true, 0.03),
      makeResult(false),          // no fee
      makeResult(true, 0.07),
    ];

    emitter.emitComplete(results, 2000);

    expect(summary).toBeDefined();
    expect(summary?.totalFeeChargedHbar).toBeCloseTo(0.15, 6);
    expect(summary?.totalCreated).toBe(3);
    expect(summary?.totalFailed).toBe(1);
    expect(summary?.totalRequested).toBe(4);
    expect(summary?.totalElapsedMs).toBe(2000);
    expect(summary?.jobId).toBe('job-fee');
    expect(summary?.entityType).toBe('account');
  });

  it('should emit job:cancelled via emitCancelled', () => {
    const emitter = new BatchJobEmitter('job-1', 'account');
    let fired = false;

    emitter.on('job:cancelled', () => {
      fired = true;
    });

    emitter.emitCancelled();
    expect(fired).toBe(true);
  });
});

// ─── buildBatchJob ───────────────────────────────────────────────────────────

describe('buildBatchJob', () => {
  const makeStats = (completed: number, failed: number, total: number): JobStats => ({
    completed,
    failed,
    total,
    elapsedMs: 500,
    estimatedRemainingMs: 500,
    currentFeeRateHbar: 0.01,
  });

  const makeResult = (
    success: boolean,
    feeChargedHbar?: number,
  ): EntityCreationResult => ({
    entityType: 'account',
    entityId: success ? '0.0.12345' : null,
    success,
    ...(feeChargedHbar !== undefined ? { feeChargedHbar } : {}),
  });

  it('should start with pending status', () => {
    const emitter = new BatchJobEmitter('job-1', 'account');
    const job = buildBatchJob(emitter, jest.fn());

    expect(job.status).toBe('pending');
    expect(job.id).toBe('job-1');
    expect(job.results).toHaveLength(0);
  });

  it('should transition pending → running on first progress event', () => {
    const emitter = new BatchJobEmitter('job-1', 'account');
    const job = buildBatchJob(emitter, jest.fn());

    expect(job.status).toBe('pending');

    emitter.emitProgress(makeStats(1, 0, 10));

    expect(job.status).toBe('running');
  });

  it('should transition running → complete on job:complete', () => {
    const emitter = new BatchJobEmitter('job-1', 'account');
    const job = buildBatchJob(emitter, jest.fn());

    // Move to running
    emitter.emitProgress(makeStats(5, 0, 5));
    expect(job.status).toBe('running');

    // Complete
    const results = [makeResult(true, 0.05), makeResult(true, 0.05)];
    emitter.emitComplete(results, 1000);

    expect(job.status).toBe('complete');
  });

  it('should mark as failed when ALL results have success: false', () => {
    const emitter = new BatchJobEmitter('job-1', 'account');
    const job = buildBatchJob(emitter, jest.fn());

    const results = [
      makeResult(false),
      makeResult(false),
    ];
    emitter.emitComplete(results, 500);

    expect(job.status).toBe('failed');
  });

  it('should accumulate results from entity:created and entity:failed events', () => {
    const emitter = new BatchJobEmitter('job-1', 'account');
    const job = buildBatchJob(emitter, jest.fn());

    const good = makeResult(true, 0.05);
    const bad = makeResult(false);

    emitter.emitEntityCreated(good);
    emitter.emitEntityFailed(bad, new Error('fail'));

    expect(job.results).toHaveLength(2);
    expect(job.results[0]).toBe(good);
    expect(job.results[1]).toBe(bad);
  });

  it('should update stats on each progress event', () => {
    const emitter = new BatchJobEmitter('job-1', 'account');
    const job = buildBatchJob(emitter, jest.fn());

    const stats1 = makeStats(2, 0, 10);
    emitter.emitProgress(stats1);
    expect(job.stats).toBe(stats1);

    const stats2 = makeStats(5, 1, 10);
    emitter.emitProgress(stats2);
    expect(job.stats).toBe(stats2);
  });

  it('should call cancel function and update status when cancel() is called', () => {
    const cancelFn = jest.fn();
    const emitter = new BatchJobEmitter('job-1', 'account');
    const job = buildBatchJob(emitter, cancelFn);

    // Move to running
    emitter.emitProgress(makeStats(2, 0, 10));
    expect(job.status).toBe('running');

    // Cancel
    job.cancel();

    expect(cancelFn).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('failed');
  });

  it('should emit job:cancelled when cancel() is called', () => {
    const emitter = new BatchJobEmitter('job-1', 'account');
    const job = buildBatchJob(emitter, jest.fn());
    let cancelledFired = false;

    emitter.on('job:cancelled', () => {
      cancelledFired = true;
    });

    job.cancel();

    expect(cancelledFired).toBe(true);
  });
});
