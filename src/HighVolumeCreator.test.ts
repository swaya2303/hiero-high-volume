/**
 * Unit tests for HighVolumeCreator.
 *
 * Mocks out HieroClient, BatchQueue, RetryHandler, and the HIP-1313 flag layer
 * so tests run without a real Hedera SDK or network connection.
 *
 * Tests observable outputs and side effects only — no private method testing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Mocks (hoisted by Jest) ─────────────────────────────────────────────────

// Mock HieroClient — prevents real SDK Client construction
const mockSubmitTransaction = jest.fn();
const mockClose = jest.fn();
jest.mock('./client/index.js', () => ({
  HieroClient: jest.fn().mockImplementation(() => ({
    submitTransaction: mockSubmitTransaction,
    close: mockClose,
  })),
  HieroClientError: class HieroClientError extends Error {
    statusCode: string | undefined;
    constructor(msg: string, statusCode?: string) {
      super(msg);
      this.statusCode = statusCode;
    }
  },
}));

// Mock applyHighVolumeFlag — tracks whether HIP-1313 flag is applied
const mockApplyHighVolumeFlag = jest.fn(
  <T>(tx: T, _enabled: boolean): T => tx,
);
jest.mock('./hip1313/index.js', () => ({
  applyHighVolumeFlag: (...args: unknown[]) =>
    mockApplyHighVolumeFlag(...(args as [any, boolean])),
}));

// Mock withRetry — pass through immediately (no actual delay)
jest.mock('./retry/index.js', () => ({
  withRetry: jest.fn(
    async <T>(fn: () => Promise<T>, _opts: unknown): Promise<T> => fn(),
  ),
}));

// Mock BatchQueue — simulates immediate execution of all tasks and fires onChunkComplete
jest.mock('./batch/index.js', () => ({
  BatchQueue: jest.fn().mockImplementation((opts: any) => {
    return {
      run: async (tasks: Array<() => Promise<unknown>>) => {
        const results = await Promise.allSettled(tasks.map((t) => t()));

        // Fire onChunkComplete if provided — this is how progress events flow
        if (opts?.onChunkComplete) {
          opts.onChunkComplete(0, results);
        }

        return results;
      },
      cancel: jest.fn(),
      stats: { total: 0, dispatched: 0, cancelled: false },
    };
  }),
}));

// Mock SDK transactions — these are called inside HighVolumeCreator task builders
jest.mock('@hashgraph/sdk', () => {
  const createMockTx = (name: string): Record<string, unknown> => {
    const proto = { constructor: { name } };
    const handler: ProxyHandler<Record<string, unknown>> = {
      get: (_target, prop) => {
        if (prop === 'constructor') return proto.constructor;
        // Every method returns the proxy for chaining
        return (..._args: unknown[]) => new Proxy({}, handler);
      },
    };
    return new Proxy({}, handler);
  };

  return {
    AccountCreateTransaction: jest.fn(() => createMockTx('AccountCreateTransaction')),
    TokenCreateTransaction: jest.fn(() => createMockTx('TokenCreateTransaction')),
    TopicCreateTransaction: jest.fn(() => createMockTx('TopicCreateTransaction')),
    PrivateKey: {
      generateED25519: jest.fn(() => ({
        publicKey: 'mock-ed25519-public-key',
      })),
      generateECDSA: jest.fn(() => ({
        publicKey: 'mock-ecdsa-public-key',
      })),
    },
    Hbar: jest.fn((val: number) => ({ _value: val })),
    TransactionId: {
      generate: jest.fn(() => 'mock-tx-id'),
    },
    AccountId: {
      fromString: jest.fn((s: string) => s),
    },
  };
});

import { HighVolumeCreator } from './HighVolumeCreator.js';
import type { HighVolumeConfig } from './types.js';

// ─── Test config ─────────────────────────────────────────────────────────────

const TEST_CONFIG: HighVolumeConfig = {
  network: 'testnet',
  operatorId: '0.0.12345',
  operatorKey: 'mock-key-hex',
  keyType: 'ED25519',
  maxConcurrency: 5,
  maxRetries: 2,
  retryBaseDelayMs: 100,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HighVolumeCreator', () => {
  let creator: HighVolumeCreator;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock submitTransaction to return a receipt with all entity ID variants
    mockSubmitTransaction.mockResolvedValue({
      accountId: { toString: () => '0.0.99999' },
      tokenId: { toString: () => '0.0.88888' },
      topicId: { toString: () => '0.0.77777' },
    });

    creator = new HighVolumeCreator(TEST_CONFIG);
  });

  afterEach(() => {
    creator.close();
  });

  // ─── batchCreateAccounts ───────────────────────────────────────────
  // Verifies accounts are created with HIP-1313 flag, progress/entity
  // callbacks fire, and the BatchJob structure is correct.

  describe('batchCreateAccounts', () => {
    it('should call applyHighVolumeFlag for each account task', async () => {
      // Verifies every entity gets the HIP-1313 flag applied
      await creator.batchCreateAccounts(3);

      expect(mockApplyHighVolumeFlag).toHaveBeenCalledTimes(3);
      // Every call should have enabled=true as the second argument
      for (const call of mockApplyHighVolumeFlag.mock.calls) {
        expect(call[1]).toBe(true);
      }
    });

    it('should return a BatchJob with correct structure', async () => {
      // Verifies the public shape of the returned job object
      const job = await creator.batchCreateAccounts(2);

      expect(job.id).toBeDefined();
      expect(typeof job.id).toBe('string');
      expect(job.results).toHaveLength(2);
      expect(job.results[0]?.entityType).toBe('account');
      expect(job.results[0]?.success).toBe(true);
      expect(job.results[0]?.entityId).toBe('0.0.99999');
      expect(typeof job.cancel).toBe('function');
    });

    it('should call onProgress after chunk completes with correct total', async () => {
      // Verifies the progress callback fires with accurate stats
      const onProgress = jest.fn();
      await creator.batchCreateAccounts(2, { onProgress });

      expect(onProgress).toHaveBeenCalledTimes(1);
      const stats = onProgress.mock.calls[0]?.[0];
      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(0);
    });

    it('should call onEntityCreated once per successfully created entity', async () => {
      // Verifies per-entity callback fires the correct number of times
      const onEntityCreated = jest.fn();
      await creator.batchCreateAccounts(3, { onEntityCreated });

      expect(onEntityCreated).toHaveBeenCalledTimes(3);
    });
  });

  // ─── batchCreateTokens ─────────────────────────────────────────────
  // Verifies token-specific behavior: flag application and entity type mapping.

  describe('batchCreateTokens', () => {
    it('should call applyHighVolumeFlag for each token task', async () => {
      await creator.batchCreateTokens(2, {
        tokenName: 'TestToken',
        tokenSymbol: 'TT',
      });

      // Verifies the flag is applied once per entity
      expect(mockApplyHighVolumeFlag).toHaveBeenCalledTimes(2);
      // Every call should have enabled=true as the second argument
      for (const call of mockApplyHighVolumeFlag.mock.calls) {
        expect(call[1]).toBe(true);
      }
    });

    it('should return results with token entity type and correct ID', async () => {
      // Verifies entity type discrimination and ID extraction from receipt
      const job = await creator.batchCreateTokens(1, {
        tokenName: 'TestToken',
        tokenSymbol: 'TT',
      });

      expect(job.results[0]?.entityType).toBe('token');
      expect(job.results[0]?.entityId).toBe('0.0.88888');
    });
  });

  // ─── batchCreateTopics ─────────────────────────────────────────────
  // Verifies topic-specific behavior: flag application, memo option, and entity mapping.

  describe('batchCreateTopics', () => {
    it('should call applyHighVolumeFlag for each topic task', async () => {
      await creator.batchCreateTopics(4);

      // Verifies the flag is applied once per entity
      expect(mockApplyHighVolumeFlag).toHaveBeenCalledTimes(4);
      // Every call should have enabled=true as the second argument
      for (const call of mockApplyHighVolumeFlag.mock.calls) {
        expect(call[1]).toBe(true);
      }
    });

    it('should return results with topic entity type and correct ID', async () => {
      // Verifies topic entity results map from receipt.topicId
      const job = await creator.batchCreateTopics(1, { memo: 'test' });

      expect(job.results[0]?.entityType).toBe('topic');
      expect(job.results[0]?.entityId).toBe('0.0.77777');
    });
  });

  // ─── estimateCost ──────────────────────────────────────────────────
  // Verifies the cost estimator integration returns non-zero values for
  // realistic inputs now that it is wired to the real CostEstimator module.

  describe('estimateCost', () => {
    it('should return a CostEstimate with expectedHbar > 0 for 1000 accounts', async () => {
      // Verifies the stub was replaced with real cost calculation
      const estimate = await creator.estimateCost(1000, 'account');

      expect(estimate.expectedHbar).toBeGreaterThan(0);
      expect(estimate.minHbar).toBeGreaterThan(0);
      expect(estimate.maxHbar).toBeGreaterThan(0);
      expect(estimate.perEntityHbar).toBeGreaterThan(0);
    });

    it('should return min < expected < max', async () => {
      // Verifies the ±20% bounds are ordered correctly
      const estimate = await creator.estimateCost(500, 'token');

      expect(estimate.minHbar).toBeLessThan(estimate.expectedHbar);
      expect(estimate.expectedHbar).toBeLessThan(estimate.maxHbar);
    });

    it('should include a warning when cost exceeds budget', async () => {
      // Verifies budget integration with maxTotalCostHbar
      const budgetCreator = new HighVolumeCreator({
        ...TEST_CONFIG,
        maxTotalCostHbar: 0.01, // Very small budget
      });

      const estimate = await budgetCreator.estimateCost(1000, 'account');
      expect(estimate.warning).toBeDefined();
      expect(estimate.warning).toContain('exceeds your budget');

      budgetCreator.close();
    });
  });

  // ─── close ─────────────────────────────────────────────────────────
  // Verifies the SDK connection pool teardown delegates to HieroClient.

  describe('close', () => {
    it('should call HieroClient.close() exactly once', () => {
      creator.close();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});
