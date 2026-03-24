/**
 * Integration tests for account creation on Hedera testnet.
 *
 * These tests create real entities on the Hedera testnet and cost real
 * testnet HBAR. All batch operations use count=3 to minimize cost.
 *
 * Requires: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY environment variables.
 * Skip via: SKIP_INTEGRATION=true
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HighVolumeCreator } from '../../src/HighVolumeCreator.js';
import type { HighVolumeConfig, JobStats, EntityCreationResult } from '../../src/types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum total fee expected for creating 3 accounts (HBAR). */
const MIN_TOTAL_FEE_HBAR = 0.01;

/** Maximum total fee expected for creating 3 accounts (HBAR). */
const MAX_TOTAL_FEE_HBAR = 1.0;

/** Entity ID format: shard.realm.num (e.g. 0.0.12345) */
const ENTITY_ID_PATTERN = /^0\.0\.\d+$/;

/** Path to the skip sentinel file created by globalSetup. */
const SKIP_SENTINEL = join(__dirname, '.skip');

// ─── Skip check ──────────────────────────────────────────────────────────────

const shouldSkip = existsSync(SKIP_SENTINEL);

// ─── Shared creator config ───────────────────────────────────────────────────

function createConfig(overrides: Partial<HighVolumeConfig> = {}): HighVolumeConfig {
  return {
    network: 'testnet',
    operatorId: process.env['HEDERA_OPERATOR_ID'] ?? '',
    operatorKey: process.env['HEDERA_OPERATOR_KEY'] ?? '',
    keyType: (process.env['HEDERA_KEY_TYPE'] as 'ED25519' | 'ECDSA') ?? 'ED25519',
    maxConcurrency: 3,
    maxRetries: 2,
    retryBaseDelayMs: 1000,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Account creation on Hedera testnet', () => {
  let creator: HighVolumeCreator;

  beforeAll(() => {
    creator = new HighVolumeCreator(createConfig());
  });

  afterAll(() => {
    creator.close();
  });

  // Verifies that real accounts are created on testnet with valid entity IDs
  it('creates 3 accounts with valid entity IDs on testnet', async () => {
    const job = await creator.batchCreateAccounts(3, {
      initialBalanceHbar: 1,
    });

    // All 3 entities should be completed
    expect(job.stats.completed).toBe(3);

    // Every result should be successful with a valid entity ID
    for (const result of job.results) {
      expect(result.success).toBe(true);
      expect(result.entityId).toBeDefined();
      expect(result.entityId).toMatch(ENTITY_ID_PATTERN);
      expect(result.entityType).toBe('account');
    }

    // Sanity-check total fees (if feeChargedHbar is reported)
    const totalFee = job.results.reduce(
      (sum: number, r: EntityCreationResult) => sum + (r.feeChargedHbar ?? 0),
      0,
    );
    if (totalFee > 0) {
      expect(totalFee).toBeGreaterThanOrEqual(MIN_TOTAL_FEE_HBAR);
      expect(totalFee).toBeLessThanOrEqual(MAX_TOTAL_FEE_HBAR);
    }
  });

  // Verifies the onProgress callback fires with real timing data
  it('onProgress fires at least once with elapsed time', async () => {
    const progressSnapshots: JobStats[] = [];

    await creator.batchCreateAccounts(3, {
      onProgress: (stats: JobStats) => {
        progressSnapshots.push(stats);
      },
    });

    // At least one progress event should have fired
    expect(progressSnapshots.length).toBeGreaterThanOrEqual(1);

    // The most recent snapshot should have positive elapsed time
    const lastSnapshot = progressSnapshots[progressSnapshots.length - 1];
    expect(lastSnapshot).toBeDefined();
    expect(lastSnapshot!.elapsedMs).toBeGreaterThan(0);
    expect(typeof lastSnapshot!.elapsedMs).toBe('number');
  });

  // Verifies HIP-1313 high-volume flag is accepted by the testnet
  // (the library always applies the flag — this confirms the testnet supports it)
  it('HIP-1313 high-volume flag does not cause errors on testnet', async () => {
    // The library applies applyHighVolumeFlag(tx, true) on every transaction.
    // If the testnet doesn't support the flag, the transaction would fail.
    const job = await creator.batchCreateAccounts(3);

    expect(job.stats.completed).toBe(3);
    for (const result of job.results) {
      expect(result.success).toBe(true);
      expect(result.entityId).toMatch(ENTITY_ID_PATTERN);
    }
  });

  // Verifies cost estimate accuracy by comparing per-entity estimate vs actual fee
  it('estimated per-entity cost is within 50% of actual fee', async () => {
    const estimate = await creator.estimateCost(100, 'account');
    expect(estimate.perEntityHbar).toBeGreaterThan(0);

    // Create 3 accounts and measure actual per-entity fee
    const job = await creator.batchCreateAccounts(3);
    const feesReported = job.results.filter(
      (r: EntityCreationResult) => r.feeChargedHbar !== undefined && r.feeChargedHbar > 0,
    );

    // Only compare if the SDK reports fees (it may not on all testnet versions)
    if (feesReported.length > 0) {
      const avgActualFee =
        feesReported.reduce((sum: number, r: EntityCreationResult) => sum + (r.feeChargedHbar ?? 0), 0) /
        feesReported.length;

      // 50% tolerance because testnet fees can differ from the model
      const lowerBound = estimate.perEntityHbar * 0.5;
      const upperBound = estimate.perEntityHbar * 1.5;

      expect(avgActualFee).toBeGreaterThanOrEqual(lowerBound);
      expect(avgActualFee).toBeLessThanOrEqual(upperBound);
    }
  });
});
