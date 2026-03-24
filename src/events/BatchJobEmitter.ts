import { EventEmitter } from 'node:events';

import type {
  EntityType,
  EntityCreationResult,
  JobStats,
  BatchJob,
  BatchJobStatus,
} from '../types.js';

// ─── Event Map ───────────────────────────────────────────────────────────────

/**
 * Typed event map for batch job lifecycle events.
 *
 * Each key is an event name; the value is a tuple of arguments
 * passed to the listener for that event.
 */
export interface BatchJobEvents {
  /** Index signature required for TypedEventEmitter constraint. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any[];
  /** Emitted after each chunk settles with a live stats snapshot. */
  'progress': [stats: JobStats];
  /** Emitted for each successfully created entity. */
  'entity:created': [result: EntityCreationResult];
  /** Emitted for each failed entity creation. */
  'entity:failed': [result: EntityCreationResult, error: unknown];
  /** Emitted once when the entire job finishes. */
  'job:complete': [summary: BatchJobSummary];
  /** Emitted when the job is cancelled. */
  'job:cancelled': [];
}

// ─── BatchJobSummary ─────────────────────────────────────────────────────────

/**
 * Summary payload emitted on the `'job:complete'` event.
 */
export interface BatchJobSummary {
  /** The job's unique identifier. */
  readonly jobId: string;
  /** Entity type created by this job. */
  readonly entityType: EntityType;
  /** Number of entities originally requested. */
  readonly totalRequested: number;
  /** Number of entities successfully created. */
  readonly totalCreated: number;
  /** Number of entity creations that failed after all retries. */
  readonly totalFailed: number;
  /** Wall-clock time for the entire job, in milliseconds. */
  readonly totalElapsedMs: number;
  /** Sum of all transaction fees charged, in HBAR. */
  readonly totalFeeChargedHbar: number;
  /** All entity creation results. */
  readonly results: readonly EntityCreationResult[];
}

// ─── TypedEventEmitter ───────────────────────────────────────────────────────

/**
 * A generic wrapper around Node.js `EventEmitter` that enforces type-safe
 * event names and listener argument types at compile time.
 *
 * @typeParam TEvents — A record mapping event names to argument tuples.
 *
 * @example
 * ```ts
 * interface MyEvents {
 *   'data': [payload: Buffer];
 *   'end': [];
 * }
 *
 * const emitter = new TypedEventEmitter<MyEvents>();
 * emitter.on('data', (payload) => { ... }); // payload: Buffer ✓
 * emitter.on('nope', () => {});             // TS error: 'nope' ✗
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEventEmitter<TEvents extends { [K in string]: any[] }> extends EventEmitter {
  // ── emit ──────────────────────────────────────────────────────────────
  override emit<K extends keyof TEvents & string>(event: K, ...args: TEvents[K]): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: string, ...args: any[]): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: string, ...args: any[]): boolean {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return super.emit(event, ...args);
  }

  // ── on ────────────────────────────────────────────────────────────────
  override on<K extends keyof TEvents & string>(event: K, listener: (...args: TEvents[K]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override on(event: string, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  // ── once ──────────────────────────────────────────────────────────────
  override once<K extends keyof TEvents & string>(event: K, listener: (...args: TEvents[K]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override once(event: string, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override once(event: string, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  // ── off ───────────────────────────────────────────────────────────────
  override off<K extends keyof TEvents & string>(event: K, listener: (...args: TEvents[K]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override off(event: string, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override off(event: string, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }
}

// ─── BatchJobEmitter ─────────────────────────────────────────────────────────

/**
 * Typed event emitter for batch entity creation job lifecycle.
 *
 * Provides convenience `emit*` methods that enforce correct payloads
 * for each event type. Used internally by `HighVolumeCreator` to
 * drive the `BatchJob` object returned to consumers.
 */
export class BatchJobEmitter extends TypedEventEmitter<BatchJobEvents> {
  readonly #jobId: string;
  readonly #entityType: EntityType;

  constructor(jobId: string, entityType: EntityType) {
    super();
    this.#jobId = jobId;
    this.#entityType = entityType;
  }

  /** The job's unique identifier. */
  get jobId(): string {
    return this.#jobId;
  }

  /** The entity type for this job. */
  get entityType(): EntityType {
    return this.#entityType;
  }

  /** Emit a progress snapshot after a chunk settles. */
  emitProgress(stats: JobStats): void {
    this.emit('progress', stats);
  }

  /** Emit a successful entity creation result. */
  emitEntityCreated(result: EntityCreationResult): void {
    this.emit('entity:created', result);
  }

  /** Emit a failed entity creation result with the causing error. */
  emitEntityFailed(result: EntityCreationResult, error: unknown): void {
    this.emit('entity:failed', result, error);
  }

  /**
   * Build a {@link BatchJobSummary} from the final results and emit `'job:complete'`.
   *
   * @param results       - All entity creation results for this job.
   * @param totalElapsedMs - Wall-clock time for the entire job.
   */
  emitComplete(results: EntityCreationResult[], totalElapsedMs: number): void {
    const totalCreated = results.filter((r) => r.success).length;
    const totalFailed = results.filter((r) => !r.success).length;
    const totalFeeChargedHbar = results.reduce(
      (sum, r) => sum + (r.feeChargedHbar ?? 0),
      0,
    );

    const summary: BatchJobSummary = {
      jobId: this.#jobId,
      entityType: this.#entityType,
      totalRequested: results.length,
      totalCreated,
      totalFailed,
      totalElapsedMs,
      totalFeeChargedHbar,
      results,
    };

    this.emit('job:complete', summary);
  }

  /** Emit a cancellation event. */
  emitCancelled(): void {
    this.emit('job:cancelled');
  }
}

// ─── buildBatchJob ───────────────────────────────────────────────────────────

/**
 * Factory function that wires a {@link BatchJobEmitter} into a
 * user-facing {@link BatchJob} object.
 *
 * The returned object's `status`, `stats`, and `results` are mutated
 * in-place by event listeners registered on the emitter. This keeps
 * the `BatchJob` interface simple (a plain object) while still providing
 * live updates.
 *
 * @param emitter - The emitter driving this job's lifecycle.
 * @param cancel  - A function that cancels the underlying queue.
 * @returns A fully wired {@link BatchJob} object.
 */
export function buildBatchJob(
  emitter: BatchJobEmitter,
  cancel: () => void,
): BatchJob {
  // Closure state — mutated by listeners below.
  let status: BatchJobStatus = 'pending';

  // The results array grows as entities are created/failed.
  // Note: `BatchJob.results` is typed as `readonly EntityCreationResult[]`
  // at the interface level, meaning consumers cannot mutate it. But
  // internally we use a regular mutable array so listeners can `.push()`.
  // This is safe because the interface's `readonly` only prevents external
  // mutation — it doesn't make the array immutable at runtime.
  const results: EntityCreationResult[] = [];

  const initialStats: JobStats = {
    completed: 0,
    failed: 0,
    total: 0,
    elapsedMs: 0,
    estimatedRemainingMs: Infinity,
    currentFeeRateHbar: 0,
  };

  // The job object — properties are mutated via closure.
  const job: BatchJob = {
    id: emitter.jobId,
    status: 'pending',
    stats: initialStats,
    results,
    cancel: (): void => {
      status = 'failed';
      job.status = status;
      cancel();
      emitter.emitCancelled();
    },
  };

  // ── Wire up event listeners ──────────────────────────────────────────

  emitter.on('progress', (stats: JobStats): void => {
    if (status === 'pending') {
      status = 'running';
      job.status = status;
    }
    job.stats = stats;
  });

  emitter.on('entity:created', (result: EntityCreationResult): void => {
    results.push(result);
  });

  emitter.on('entity:failed', (result: EntityCreationResult): void => {
    results.push(result);
  });

  emitter.on('job:complete', (summary: BatchJobSummary): void => {
    // If every result failed, mark as 'failed'; otherwise 'complete'
    if (summary.totalCreated === 0 && summary.totalFailed > 0) {
      status = 'failed';
    } else {
      status = 'complete';
    }
    job.status = status;
  });

  emitter.on('job:cancelled', (): void => {
    status = 'failed';
    job.status = status;
  });

  return job;
}
