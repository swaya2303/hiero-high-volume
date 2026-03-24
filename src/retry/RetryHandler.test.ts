// Mock the Hedera SDK so the transitive import from ../client/index.js doesn't
// attempt real SDK initialization during tests.
jest.mock('@hashgraph/sdk', () => ({
  Client: {
    forTestnet: jest.fn(() => ({ setOperator: jest.fn(), close: jest.fn() })),
    forMainnet: jest.fn(() => ({ setOperator: jest.fn(), close: jest.fn() })),
    forPreviewnet: jest.fn(() => ({ setOperator: jest.fn(), close: jest.fn() })),
  },
  AccountId: { fromString: jest.fn((s: string) => s) },
  PrivateKey: {
    fromStringED25519: jest.fn(() => 'mock-key'),
    fromStringECDSA: jest.fn(() => 'mock-key'),
  },
  Transaction: class Transaction {},
  TransactionReceipt: class TransactionReceipt {},
  Status: { Success: { toString: () => 'SUCCESS' } },
}));

import {
  calculateDelay,
  withRetry,
  MaxRetriesExceededError,
  RETRYABLE_STATUS_CODES,
} from './RetryHandler.js';
import type { RetryOptions } from './RetryHandler.js';
import { HieroClientError } from '../client/index.js';

// ─── Shared options for tests ────────────────────────────────────────────────

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitterFactor: 0.3,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RetryHandler', () => {
  // ─── calculateDelay ──────────────────────────────────────────────────

  describe('calculateDelay', () => {
    it('should return baseDelayMs on attempt 0 when jitter is 0', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // (0.5*2-1) = 0 → no jitter

      const delay = calculateDelay(0, { ...DEFAULT_OPTIONS, jitterFactor: 0 });

      expect(delay).toBe(500); // 500 * 2^0 = 500
      jest.restoreAllMocks();
    });

    it('should double delay for each subsequent attempt', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // neutral jitter

      const d0 = calculateDelay(0, { ...DEFAULT_OPTIONS, jitterFactor: 0 });
      const d1 = calculateDelay(1, { ...DEFAULT_OPTIONS, jitterFactor: 0 });
      const d2 = calculateDelay(2, { ...DEFAULT_OPTIONS, jitterFactor: 0 });

      expect(d0).toBe(500);  // 500 * 2^0
      expect(d1).toBe(1000); // 500 * 2^1
      expect(d2).toBe(2000); // 500 * 2^2
      jest.restoreAllMocks();
    });

    it('should cap delay at maxDelayMs', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const delay = calculateDelay(20, { ...DEFAULT_OPTIONS, jitterFactor: 0 });

      // 500 * 2^20 = 524_288_000, but capped at 30_000
      expect(delay).toBe(30_000);
      jest.restoreAllMocks();
    });

    it('should apply jitter within expected bounds over 10 runs', () => {
      const options: RetryOptions = {
        ...DEFAULT_OPTIONS,
        jitterFactor: 0.3,
      };
      const baseExpected = 500; // attempt 0

      for (let i = 0; i < 10; i++) {
        // Random values across the full range
        jest.spyOn(Math, 'random').mockReturnValue(i / 9);

        const delay = calculateDelay(0, options);
        const minExpected = Math.floor(baseExpected * (1 - 0.3));
        const maxExpected = Math.floor(baseExpected * (1 + 0.3));

        expect(delay).toBeGreaterThanOrEqual(minExpected);
        expect(delay).toBeLessThanOrEqual(maxExpected);
        jest.restoreAllMocks();
      }
    });

    it('should never return a negative value', () => {
      // Math.random() = 0 → jitter = (0*2-1) * factor * delay = -factor * delay
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const delay = calculateDelay(0, {
        ...DEFAULT_OPTIONS,
        jitterFactor: 1.0, // worst case: -100%
      });

      expect(delay).toBeGreaterThanOrEqual(0);
      jest.restoreAllMocks();
    });
  });

  // ─── withRetry ───────────────────────────────────────────────────────

  describe('withRetry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('should succeed immediately if fn resolves on first call', async () => {
      const fn = jest.fn().mockResolvedValue('ok');

      const promise = withRetry(fn, DEFAULT_OPTIONS);
      // Advance timers in case sleep is called (it shouldn't be)
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should succeed on the 2nd attempt when 1st fails with a retryable error', async () => {
      const retryableError = new HieroClientError('busy', 'BUSY');
      const fn = jest.fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('recovered');

      // Pin jitter so delays are deterministic
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const promise = withRetry(fn, DEFAULT_OPTIONS);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should retry exactly maxRetries times then throw MaxRetriesExceededError', async () => {
      const retryableError = new HieroClientError('busy', 'BUSY');
      const fn = jest.fn().mockRejectedValue(retryableError);
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const promise = withRetry(fn, { ...DEFAULT_OPTIONS, maxRetries: 3 });

      // Capture the rejection BEFORE advancing timers to prevent unhandled rejection
      let caughtError: unknown;
      const catcher = promise.catch((err: unknown) => { caughtError = err; });

      // Advance through all retry sleep intervals
      await jest.runAllTimersAsync();
      await catcher;

      expect(caughtError).toBeInstanceOf(MaxRetriesExceededError);
      // 1 initial + 3 retries = 4 total calls
      expect(fn).toHaveBeenCalledTimes(4);
    });

    it('should include attempt count and last error in MaxRetriesExceededError', async () => {
      const retryableError = new HieroClientError('platform down', 'PLATFORM_NOT_ACTIVE');
      const fn = jest.fn().mockRejectedValue(retryableError);
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const promise = withRetry(fn, { ...DEFAULT_OPTIONS, maxRetries: 2 });

      // Capture the rejection BEFORE advancing timers
      let caughtError: unknown;
      const catcher = promise.catch((err: unknown) => { caughtError = err; });

      await jest.runAllTimersAsync();
      await catcher;

      expect(caughtError).toBeInstanceOf(MaxRetriesExceededError);
      const maxErr = caughtError as MaxRetriesExceededError;
      expect(maxErr.attempts).toBe(3); // 1 initial + 2 retries
      expect(maxErr.lastError).toBe(retryableError);
      expect(maxErr.message).toContain('3 attempts');
      expect(maxErr.message).toContain('platform down');
    });

    it('should NOT retry on non-retryable HieroClientError status codes', async () => {
      const nonRetryable = new HieroClientError(
        'bad account',
        'INVALID_ACCOUNT_ID',
      );
      const fn = jest.fn().mockRejectedValue(nonRetryable);

      // No runAllTimersAsync needed — withRetry throws immediately for non-retryable errors
      await expect(withRetry(fn, DEFAULT_OPTIONS)).rejects.toThrow(nonRetryable);
      // Should fail on first call, no retries
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on non-HieroClientError errors', async () => {
      const plainError = new Error('network failure');
      const fn = jest.fn().mockRejectedValue(plainError);

      // No runAllTimersAsync needed — withRetry throws immediately for non-HieroClientError
      await expect(withRetry(fn, DEFAULT_OPTIONS)).rejects.toThrow(plainError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback with correct attempt index and delay', async () => {
      const retryableError = new HieroClientError('busy', 'CLIENT_BUSY');
      const fn = jest.fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('done');

      // Pin random so delay is deterministic
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const onRetry = jest.fn();
      const options: RetryOptions = {
        ...DEFAULT_OPTIONS,
        jitterFactor: 0, // no jitter for predictable delays
        onRetry,
      };

      const promise = withRetry(fn, options);
      await jest.runAllTimersAsync();
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(2);

      // First retry: attempt=0 → delay = 500 * 2^0 = 500
      expect(onRetry).toHaveBeenNthCalledWith(1, 0, 500, retryableError);
      // Second retry: attempt=1 → delay = 500 * 2^1 = 1000
      expect(onRetry).toHaveBeenNthCalledWith(2, 1, 1000, retryableError);
    });
  });

  // ─── RETRYABLE_STATUS_CODES ──────────────────────────────────────────

  describe('RETRYABLE_STATUS_CODES', () => {
    it('should contain exactly the five expected status codes', () => {
      expect(RETRYABLE_STATUS_CODES.size).toBe(5);
      expect(RETRYABLE_STATUS_CODES.has('BUSY')).toBe(true);
      expect(RETRYABLE_STATUS_CODES.has('CLIENT_BUSY')).toBe(true);
      expect(RETRYABLE_STATUS_CODES.has('PLATFORM_TRANSACTION_NOT_CREATED')).toBe(true);
      expect(RETRYABLE_STATUS_CODES.has('PLATFORM_NOT_ACTIVE')).toBe(true);
      expect(RETRYABLE_STATUS_CODES.has('TRANSACTION_EXPIRED')).toBe(true);
    });

    it('should NOT contain non-retryable codes', () => {
      expect(RETRYABLE_STATUS_CODES.has('INVALID_ACCOUNT_ID')).toBe(false);
      expect(RETRYABLE_STATUS_CODES.has('INSUFFICIENT_PAYER_BALANCE')).toBe(false);
      expect(RETRYABLE_STATUS_CODES.has('SUCCESS')).toBe(false);
    });
  });
});
