import pLimit from 'p-limit';

// ─── Options ─────────────────────────────────────────────────────────────────

/**
 * Configuration for the {@link BatchQueue} scheduler.
 */
export interface BatchQueueOptions {
  /**
   * How many tasks to group into each sub-batch (chunk).
   * Each chunk is dispatched sequentially after the previous settles,
   * but tasks *within* a chunk (and across chunks) share the same
   * concurrency limiter.
   * @default 50
   */
  readonly batchSize?: number;

  /**
   * Maximum number of tasks executing simultaneously across ALL chunks.
   * This is the `p-limit` concurrency value.
   * @default 10
   */
  readonly maxConcurrency?: number;

  /**
   * Called before a chunk begins dispatching.
   * @param chunkIndex - Zero-based index of the chunk.
   * @param chunkSize  - Number of tasks in this chunk.
   */
  readonly onChunkStart?: (chunkIndex: number, chunkSize: number) => void;

  /**
   * Called after all tasks in a chunk have settled.
   * @param chunkIndex - Zero-based index of the chunk.
   * @param results    - The settled results for this chunk's tasks.
   */
  readonly onChunkComplete?: (
    chunkIndex: number,
    results: PromiseSettledResult<unknown>[],
  ) => void;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/**
 * Live snapshot of queue state, returned by {@link BatchQueue.stats}.
 */
export interface BatchQueueStats {
  /** Total number of tasks submitted to the current `run()`. */
  readonly total: number;
  /** Number of tasks dispatched (sent to the limiter) so far. */
  readonly dispatched: number;
  /** Whether `cancel()` has been called. */
  readonly cancelled: boolean;
}

// ─── BatchQueue ──────────────────────────────────────────────────────────────

/**
 * A concurrency-aware batch job scheduler.
 *
 * Splits an array of task functions into sequential chunks, dispatches
 * each chunk through a shared `p-limit` concurrency limiter, and collects
 * all results via `Promise.allSettled` so a single failure never aborts
 * the full run.
 *
 * **Does not retry** — each task is invoked exactly once.
 * **Does not know about Hedera** — it is a generic scheduler.
 *
 * @typeParam T - The resolved value type of each task.
 *
 * @example
 * ```ts
 * const queue = new BatchQueue({ maxConcurrency: 5, batchSize: 100 });
 * const results = await queue.run(tasks);
 * // results: PromiseSettledResult<T>[] in input order
 * ```
 */
export class BatchQueue<T = unknown> {
  readonly #batchSize: number;
  readonly #maxConcurrency: number;
  readonly #onChunkStart: ((chunkIndex: number, chunkSize: number) => void) | undefined;
  readonly #onChunkComplete:
    | ((chunkIndex: number, results: PromiseSettledResult<T>[]) => void)
    | undefined;

  #cancelled = false;
  #dispatched = 0;
  #total = 0;

  /**
   * @param options - Scheduler configuration.
   */
  constructor(options: BatchQueueOptions = {}) {
    this.#batchSize = options.batchSize ?? 50;
    this.#maxConcurrency = options.maxConcurrency ?? 10;
    this.#onChunkStart = options.onChunkStart;
    this.#onChunkComplete = options.onChunkComplete as
      | ((chunkIndex: number, results: PromiseSettledResult<T>[]) => void)
      | undefined;
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Execute all `tasks` with controlled concurrency and chunked dispatch.
   *
   * 1. Splits `tasks` into sub-arrays of `batchSize`.
   * 2. Creates a single `p-limit` limiter shared across ALL chunks.
   * 3. For each chunk:
   *    - If cancelled, skips this and all remaining chunks.
   *    - Fires `onChunkStart`.
   *    - Wraps every task through the limiter and awaits with
   *      `Promise.allSettled`.
   *    - Fires `onChunkComplete`.
   * 4. Returns the flat array of all results **in input order**.
   *
   * @param tasks - Array of zero-argument async functions to execute.
   * @returns Settled results for every task, in the same order as `tasks`.
   *
   * @throws This method itself never throws. All per-task errors are
   * captured as `{ status: 'rejected', reason: ... }` entries in
   * the returned array.
   */
  async run(tasks: Array<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
    // Reset state for this run
    this.#cancelled = false;
    this.#dispatched = 0;
    this.#total = tasks.length;

    // Single limiter shared across all chunks — this is critical so
    // concurrency is bounded globally, not per-chunk.
    const limit = pLimit(this.#maxConcurrency);

    // Split tasks into chunks
    const chunks = splitIntoChunks(tasks, this.#batchSize);

    // Accumulate results across all chunks, preserving input order
    const allResults: PromiseSettledResult<T>[] = [];

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      // ── Cancellation check ─────────────────────────────────────────
      // Skip remaining chunks but let in-flight tasks finish naturally.
      if (this.#cancelled) {
        // Mark all remaining tasks as rejected due to cancellation
        const remaining = chunks
          .slice(chunkIndex)
          .reduce((sum, chunk) => sum + chunk.length, 0);

        for (let i = 0; i < remaining; i++) {
          allResults.push({
            status: 'rejected',
            reason: new Error('BatchQueue cancelled'),
          });
        }
        break;
      }

      const chunk = chunks[chunkIndex];
      if (!chunk) {
        continue;
      }

      // Fire pre-dispatch callback
      this.#onChunkStart?.(chunkIndex, chunk.length);

      // Wrap each task through the shared limiter.
      // The limiter queues excess tasks so at most `maxConcurrency`
      // run simultaneously.
      const limitedTasks = chunk.map((task) => {
        this.#dispatched++;
        return limit(() => task());
      });

      // allSettled never rejects — a failing task produces a
      // { status: 'rejected' } entry, NOT an exception.
      const chunkResults = await Promise.allSettled(limitedTasks);

      // Fire post-settle callback
      this.#onChunkComplete?.(chunkIndex, chunkResults);

      // Append in order
      allResults.push(...chunkResults);
    }

    return allResults;
  }

  /**
   * Request graceful cancellation.
   *
   * Already-dispatched tasks continue to completion. Future chunks
   * are skipped entirely. Calling `cancel()` multiple times is safe
   * (idempotent).
   */
  cancel(): void {
    this.#cancelled = true;
  }

  /**
   * Live snapshot of the queue's internal state.
   */
  get stats(): BatchQueueStats {
    return {
      total: this.#total,
      dispatched: this.#dispatched,
      cancelled: this.#cancelled,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Split an array into sub-arrays of at most `size` elements.
 * The last chunk may be shorter.
 */
function splitIntoChunks<U>(arr: readonly U[], size: number): U[][] {
  const chunks: U[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
