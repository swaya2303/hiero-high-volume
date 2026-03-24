import { HieroClientError } from '../client/index.js';

// ─── Retryable Status Codes ──────────────────────────────────────────────────

/**
 * Hedera status codes that represent transient failures safe to retry.
 *
 * This `Set` is the **single source of truth** for retry classification
 * across the entire library. If HIP-1313 or future HIPs introduce new
 * transient codes, add them here.
 */
export const RETRYABLE_STATUS_CODES: ReadonlySet<string> = new Set([
  'BUSY',
  'CLIENT_BUSY',
  'PLATFORM_TRANSACTION_NOT_CREATED',
  'PLATFORM_NOT_ACTIVE',
  'TRANSACTION_EXPIRED',
]);

// ─── RetryOptions ────────────────────────────────────────────────────────────

/**
 * Configuration for {@link withRetry}.
 */
export interface RetryOptions {
  /**
   * How many additional attempts after the initial call.
   * E.g. `3` means 4 total attempts (1 original + 3 retries).
   */
  readonly maxRetries: number;

  /**
   * Starting delay in milliseconds before the first retry.
   * Subsequent retries double this (exponential backoff).
   */
  readonly baseDelayMs: number;

  /**
   * Maximum delay in milliseconds for any single retry wait.
   * Caps the exponential growth to prevent extremely long waits.
   */
  readonly maxDelayMs: number;

  /**
   * Fraction of computed delay added as random noise (0–1).
   * E.g. `0.3` means ±30% jitter around the computed delay.
   * Jitter prevents thundering-herd retries across parallel tasks.
   */
  readonly jitterFactor: number;

  /**
   * Called before each retry wait begins.
   * @param attempt - Zero-based retry index (first retry = 0).
   * @param delayMs - Computed delay including jitter.
   * @param error   - The error that triggered this retry.
   */
  readonly onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

// ─── MaxRetriesExceededError ─────────────────────────────────────────────────

/**
 * Thrown by {@link withRetry} when all retry attempts are exhausted.
 */
export class MaxRetriesExceededError extends Error {
  /** Total number of attempts made (initial + retries). */
  public readonly attempts: number;

  /** The last error encountered before giving up. */
  public readonly lastError: unknown;

  constructor(attempts: number, lastError: unknown) {
    const reason =
      lastError instanceof Error ? lastError.message : 'unknown error';

    super(`Operation failed after ${String(attempts)} attempts: ${reason}`);
    this.name = 'MaxRetriesExceededError';
    this.attempts = attempts;
    this.lastError = lastError;

    Object.setPrototypeOf(this, MaxRetriesExceededError.prototype);
  }
}

// ─── calculateDelay ──────────────────────────────────────────────────────────

/**
 * Compute the retry delay for a given attempt index.
 *
 * **Formula:**
 * 1. `base = min(baseDelayMs × 2^attempt, maxDelayMs)`
 * 2. `jitter = (Math.random() × 2 − 1) × jitterFactor × base`
 * 3. `result = floor(max(base + jitter, 0))`
 *
 * Exported as a pure function for isolated unit testing without
 * mocking timers or the retry loop.
 *
 * @param attempt - Zero-based retry index (first retry = 0).
 * @param options - Retry configuration.
 * @returns Delay in milliseconds (integer, never negative).
 */
export function calculateDelay(attempt: number, options: RetryOptions): number {
  // Exponential backoff capped at maxDelayMs
  const exponentialDelay = Math.min(
    options.baseDelayMs * Math.pow(2, attempt),
    options.maxDelayMs,
  );

  // Jitter: random value in [-jitterFactor, +jitterFactor] × delay
  const jitter =
    (Math.random() * 2 - 1) * options.jitterFactor * exponentialDelay;

  // Floor to integer, clamp to non-negative
  return Math.max(0, Math.floor(exponentialDelay + jitter));
}

// ─── sleep ───────────────────────────────────────────────────────────────────

/**
 * Promise-based delay using `setTimeout`.
 * @internal
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ─── withRetry ───────────────────────────────────────────────────────────────

/**
 * Execute an async function with automatic retries on transient Hedera errors.
 *
 * Retries are triggered **only** when:
 * 1. The error is an instance of {@link HieroClientError}, AND
 * 2. Its `statusCode` is in {@link RETRYABLE_STATUS_CODES}.
 *
 * All other errors (wrong type, non-retryable status codes) are rethrown
 * immediately without delay.
 *
 * @typeParam T - The resolved value type.
 * @param fn      - The async function to attempt.
 * @param options - Retry configuration.
 * @returns The resolved value of `fn()` on success.
 * @throws {MaxRetriesExceededError} If all retry attempts are exhausted.
 * @throws The original error if it is not retryable.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const totalAttempts = options.maxRetries + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // ── Non-retryable: rethrow immediately ──────────────────────────
      if (!isRetryable(err)) {
        throw err;
      }

      // ── Last attempt: don't retry, fall through to throw below ──────
      if (attempt === totalAttempts - 1) {
        break;
      }

      // ── Retryable: compute delay, notify, wait ──────────────────────
      const retryIndex = attempt; // 0-based retry index
      const delayMs = calculateDelay(retryIndex, options);

      options.onRetry?.(retryIndex, delayMs, err);

      await sleep(delayMs);
    }
  }

  throw new MaxRetriesExceededError(totalAttempts, lastError);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determine whether an error is a retryable Hedera transient failure.
 */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof HieroClientError)) {
    return false;
  }

  if (err.statusCode === undefined) {
    return false;
  }

  return RETRYABLE_STATUS_CODES.has(err.statusCode);
}
