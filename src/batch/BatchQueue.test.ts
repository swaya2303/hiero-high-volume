// Mock p-limit (ESM-only package) to avoid ts-jest ESM transform issues.
// Provides a simple synchronous concurrency limiter with the same API shape.
jest.mock('p-limit', () => {
  return {
    __esModule: true,
    default: (_concurrency: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return <T>(fn: (...args: any[]) => Promise<T>): Promise<T> => fn();
    },
  };
});

import { BatchQueue } from './BatchQueue.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock task that resolves with `value` after a short delay. */
function mockTask<T>(value: T, delayMs = 0): jest.Mock<Promise<T>> {
  return jest.fn(
    () => new Promise<T>((resolve) => setTimeout(() => resolve(value), delayMs)),
  );
}

/** Create a mock task that rejects with `error` after a short delay. */
function mockFailingTask(error: string, delayMs = 0): jest.Mock<Promise<never>> {
  return jest.fn(
    () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error(error)), delayMs)),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BatchQueue', () => {
  // ─── High-volume throughput ──────────────────────────────────────────

  describe('high-volume throughput', () => {
    it('should complete all 10,000 tasks with maxConcurrency=5, batchSize=100', async () => {
      const queue = new BatchQueue<number>({ maxConcurrency: 5, batchSize: 100 });
      const tasks = Array.from({ length: 10_000 }, (_, i) => mockTask(i));

      const results = await queue.run(tasks);

      // All 10,000 tasks should settle
      expect(results).toHaveLength(10_000);

      // Every task should be fulfilled
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(10_000);

      // Every mock should have been called exactly once
      for (const task of tasks) {
        expect(task).toHaveBeenCalledTimes(1);
      }

      // Stats should reflect completion
      expect(queue.stats.total).toBe(10_000);
      expect(queue.stats.dispatched).toBe(10_000);
      expect(queue.stats.cancelled).toBe(false);
    });
  });

  // ─── Cancellation ───────────────────────────────────────────────────

  describe('cancellation', () => {
    it('should stop dispatching future chunks but let in-flight tasks complete', async () => {
      const queue = new BatchQueue<string>({ maxConcurrency: 2, batchSize: 3 });

      // 9 tasks total → 3 chunks of 3
      let chunkCount = 0;
      const tasks = Array.from({ length: 9 }, (_, i) =>
        jest.fn(async () => {
          // Cancel after the first chunk starts running
          if (i >= 3 && !queue.stats.cancelled) {
            // This runs during chunk 1; cancel so chunk 2 is skipped
          }
          return `task-${i}`;
        }),
      );

      // Cancel after first chunk completes
      const onChunkComplete = jest.fn((_chunkIndex: number) => {
        chunkCount++;
        if (chunkCount === 1) {
          queue.cancel();
        }
      });

      const q = new BatchQueue<string>({
        maxConcurrency: 2,
        batchSize: 3,
        onChunkComplete,
      });

      const results = await q.run(tasks);

      // All 9 slots should have results
      expect(results).toHaveLength(9);

      // First chunk (3 tasks) should be fulfilled
      const firstChunk = results.slice(0, 3);
      for (const r of firstChunk) {
        expect(r.status).toBe('fulfilled');
      }

      // Remaining tasks should be rejected with cancellation message
      const cancelledResults = results.slice(3);
      for (const r of cancelledResults) {
        expect(r.status).toBe('rejected');
        if (r.status === 'rejected') {
          expect((r.reason as Error).message).toBe('BatchQueue cancelled');
        }
      }

      // Only first 3 tasks should have been actually called
      for (let i = 0; i < 3; i++) {
        expect(tasks[i]).toHaveBeenCalledTimes(1);
      }
      for (let i = 3; i < 9; i++) {
        expect(tasks[i]).not.toHaveBeenCalled();
      }

      // Stats should reflect cancellation
      expect(q.stats.cancelled).toBe(true);
      expect(q.stats.dispatched).toBe(3);
    });

    it('should be idempotent — calling cancel() twice is safe', () => {
      const queue = new BatchQueue();
      queue.cancel();
      queue.cancel();
      expect(queue.stats.cancelled).toBe(true);
    });
  });

  // ─── Failure isolation (Promise.allSettled) ──────────────────────────

  describe('failure isolation', () => {
    it('should not abort sibling tasks when one task fails', async () => {
      const queue = new BatchQueue<string>({ maxConcurrency: 3, batchSize: 5 });

      const tasks = [
        mockTask('a'),
        mockFailingTask('boom'),
        mockTask('c'),
        mockFailingTask('crash'),
        mockTask('e'),
      ];

      const results = await queue.run(tasks);

      expect(results).toHaveLength(5);

      // Successful tasks
      expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' });
      expect(results[2]).toEqual({ status: 'fulfilled', value: 'c' });
      expect(results[4]).toEqual({ status: 'fulfilled', value: 'e' });

      // Failed tasks
      expect(results[1].status).toBe('rejected');
      expect(results[3].status).toBe('rejected');
      if (results[1].status === 'rejected') {
        expect((results[1].reason as Error).message).toBe('boom');
      }
      if (results[3].status === 'rejected') {
        expect((results[3].reason as Error).message).toBe('crash');
      }

      // All 5 tasks should have been called
      for (const task of tasks) {
        expect(task).toHaveBeenCalledTimes(1);
      }
    });
  });

  // ─── Output order ───────────────────────────────────────────────────

  describe('output order', () => {
    it('should preserve input order regardless of task completion order', async () => {
      const queue = new BatchQueue<number>({ maxConcurrency: 5, batchSize: 5 });

      // Tasks complete in reverse order: task 4 finishes first, task 0 last
      const tasks = [
        mockTask(0, 50), // slowest
        mockTask(1, 40),
        mockTask(2, 30),
        mockTask(3, 20),
        mockTask(4, 10), // fastest
      ];

      const results = await queue.run(tasks);

      expect(results).toHaveLength(5);

      // Output must match input order, not completion order
      for (let i = 0; i < 5; i++) {
        expect(results[i]).toEqual({ status: 'fulfilled', value: i });
      }
    });
  });

  // ─── Chunk callbacks ────────────────────────────────────────────────

  describe('chunk callbacks', () => {
    it('should fire onChunkStart and onChunkComplete in order', async () => {
      const starts: Array<[number, number]> = [];
      const completes: number[] = [];

      const queue = new BatchQueue<number>({
        maxConcurrency: 2,
        batchSize: 3,
        onChunkStart: (idx, size) => starts.push([idx, size]),
        onChunkComplete: (idx) => completes.push(idx),
      });

      // 7 tasks → chunks of [3, 3, 1]
      const tasks = Array.from({ length: 7 }, (_, i) => mockTask(i));
      await queue.run(tasks);

      expect(starts).toEqual([
        [0, 3],
        [1, 3],
        [2, 1],
      ]);
      expect(completes).toEqual([0, 1, 2]);
    });
  });

  // ─── Stats ──────────────────────────────────────────────────────────

  describe('stats', () => {
    it('should report correct totals after run completes', async () => {
      const queue = new BatchQueue<number>({ maxConcurrency: 3, batchSize: 5 });
      const tasks = Array.from({ length: 12 }, (_, i) => mockTask(i));

      await queue.run(tasks);

      expect(queue.stats).toEqual({
        total: 12,
        dispatched: 12,
        cancelled: false,
      });
    });

    it('should start with zero stats before any run', () => {
      const queue = new BatchQueue();
      expect(queue.stats).toEqual({
        total: 0,
        dispatched: 0,
        cancelled: false,
      });
    });
  });
});
