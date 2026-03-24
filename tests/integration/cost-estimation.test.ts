/**
 * Integration tests for cost estimation on Hedera testnet.
 *
 * These tests validate the CostEstimator module's output against
 * sensible bounds. They do NOT create real entities (no HBAR spent),
 * but still require a valid HighVolumeCreator config to instantiate.
 *
 * Requires: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY environment variables.
 * Skip via: SKIP_INTEGRATION=true
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HighVolumeCreator } from '../../src/HighVolumeCreator.js';
import type { HighVolumeConfig, EntityType } from '../../src/types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** All entity types to verify estimates for. */
const ALL_ENTITY_TYPES: readonly EntityType[] = ['account', 'token', 'topic'] as const;

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

describeOrSkip('Cost estimation on Hedera testnet', () => {
  let creator: HighVolumeCreator;

  beforeAll(() => {
    creator = new HighVolumeCreator(createConfig());
  });

  afterAll(() => {
    creator.close();
  });

  // Verifies the cost estimator produces non-zero values for every entity type
  it('estimate is not zero for any entity type', async () => {
    for (const entityType of ALL_ENTITY_TYPES) {
      const estimate = await creator.estimateCost(1000, entityType);

      expect(estimate.expectedHbar).toBeGreaterThan(0);
      expect(estimate.minHbar).toBeGreaterThan(0);
      expect(estimate.maxHbar).toBeGreaterThan(0);
      expect(estimate.perEntityHbar).toBeGreaterThan(0);
    }
  });

  // Verifies that the HIP-1313 high-volume discount reduces cost at scale
  // Both creators use the same estimateCost method but with different
  // useHighVolume flags internally.
  it('high-volume estimate is lower than standard for 10000+ entities', async () => {
    // The library's estimateCost always uses high-volume pricing,
    // so we test via the buildCostEstimate function directly.
    // Import the internal function for this comparison test.
    const { buildCostEstimate } = await import('../../src/cost/CostEstimator.js');

    const standardEstimate = buildCostEstimate(10_000, 'account', false);
    const hvEstimate = buildCostEstimate(10_000, 'account', true);

    // High-volume should be cheaper due to bracket discounts at 10000+
    expect(hvEstimate.expectedHbar).toBeLessThan(standardEstimate.expectedHbar);
    expect(hvEstimate.perEntityHbar).toBeLessThan(standardEstimate.perEntityHbar);
  });

  // Verifies the budget warning fires when the estimated cost exceeds maxTotalCostHbar
  it('budget warning fires when maxTotalCostHbar is set low', async () => {
    const budgetCreator = new HighVolumeCreator(
      createConfig({ maxTotalCostHbar: 0.01 }),
    );

    try {
      const estimate = await budgetCreator.estimateCost(10_000, 'account');

      // The warning should be present and non-empty
      expect(estimate.warning).toBeDefined();
      expect(typeof estimate.warning).toBe('string');
      expect(estimate.warning!.length).toBeGreaterThan(0);
      expect(estimate.warning).toContain('exceeds your budget');
    } finally {
      budgetCreator.close();
    }
  });
});
