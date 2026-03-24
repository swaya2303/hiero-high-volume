import type { EntityType, CostEstimate } from '../types.js';

// ─── Base Fees ───────────────────────────────────────────────────────────────

/**
 * Standard (non-high-volume) base fee per entity in HBAR.
 *
 * These are the standard Hedera fee schedule rates before any
 * HIP-1313 volume discounts are applied.
 */
export const BASE_FEES_HBAR: Record<EntityType, number> = {
  account: 0.05,
  token: 1.0,
  topic: 0.01,
};

// ─── Volume Brackets ─────────────────────────────────────────────────────────

/**
 * A single entry in the HIP-1313 volume discount schedule.
 */
export interface VolumeBracket {
  /** Minimum entity count for this bracket (inclusive). */
  readonly minCount: number;
  /** Maximum entity count for this bracket (inclusive), or `null` for unbounded. */
  readonly maxCount: number | null;
  /** Fee multiplier applied to the base fee. < 1.0 means a discount. */
  readonly multiplier: number;
}

/**
 * HIP-1313 volume discount brackets, ordered from lowest to highest count.
 *
 * | Range | Multiplier | Discount |
 * |-------|-----------|----------|
 * | 1–999 | 1.00 | 0% |
 * | 1,000–9,999 | 0.85 | 15% |
 * | 10,000–99,999 | 0.70 | 30% |
 * | 100,000+ | 0.55 | 45% |
 */
export const VOLUME_BRACKETS: readonly VolumeBracket[] = [
  { minCount: 1, maxCount: 999, multiplier: 1.0 },
  { minCount: 1_000, maxCount: 9_999, multiplier: 0.85 },
  { minCount: 10_000, maxCount: 99_999, multiplier: 0.7 },
  { minCount: 100_000, maxCount: null, multiplier: 0.55 },
];

/**
 * Per-entity overhead in HBAR for transaction ID generation.
 */
const OVERHEAD_PER_ENTITY_HBAR = 0.001;

/**
 * Variance factor for min/max cost bounds (±20%).
 */
const VARIANCE_FACTOR = 0.2;

// ─── getVolumeMultiplier ─────────────────────────────────────────────────────

/**
 * Look up the HIP-1313 volume multiplier for a given entity count.
 *
 * Finds the matching bracket in {@link VOLUME_BRACKETS} and returns
 * its multiplier. Counts below 1 are invalid.
 *
 * @param count - Number of entities (must be ≥ 1).
 * @returns The volume multiplier (e.g. 0.85 for 15% discount).
 * @throws {RangeError} If `count` is less than 1.
 */
export function getVolumeMultiplier(count: number): number {
  if (count < 1) {
    throw new RangeError(
      `Entity count must be at least 1, received ${String(count)}`,
    );
  }

  for (const bracket of VOLUME_BRACKETS) {
    if (bracket.maxCount === null || count <= bracket.maxCount) {
      return bracket.multiplier;
    }
  }

  // Unreachable if VOLUME_BRACKETS is configured correctly (last entry is unbounded),
  // but TypeScript needs a fallback.
  return VOLUME_BRACKETS[VOLUME_BRACKETS.length - 1]?.multiplier ?? 1.0;
}

// ─── calculateExpectedCost ───────────────────────────────────────────────────

/**
 * Calculate the expected total cost in HBAR for creating `count` entities.
 *
 * **Formula:**
 * 1. `baseFee = BASE_FEES_HBAR[entityType]`
 * 2. `multiplier = useHighVolume ? getVolumeMultiplier(count) : 1.0`
 * 3. `perEntity = (baseFee × multiplier) + 0.001`
 * 4. `total = perEntity × count`
 *
 * @param count         - Number of entities to create.
 * @param entityType    - Type of entity.
 * @param useHighVolume - Whether to apply HIP-1313 volume discounts.
 * @returns Expected total cost in HBAR, rounded to 6 decimal places.
 */
export function calculateExpectedCost(
  count: number,
  entityType: EntityType,
  useHighVolume: boolean,
): number {
  const baseFee = BASE_FEES_HBAR[entityType];
  const multiplier = useHighVolume ? getVolumeMultiplier(count) : 1.0;
  const perEntity = baseFee * multiplier + OVERHEAD_PER_ENTITY_HBAR;
  const total = perEntity * count;

  return roundTo6(total);
}

// ─── buildCostEstimate ───────────────────────────────────────────────────────

/**
 * Build a complete {@link CostEstimate} for a batch creation job.
 *
 * Computes expected, min (−20%), and max (+20%) costs based on the
 * HIP-1313 fee schedule. Includes a budget warning if the estimated
 * maximum exceeds the configured `maxTotalCostHbar`.
 *
 * @param count            - Number of entities to create.
 * @param entityType       - Type of entity.
 * @param useHighVolume    - Whether to apply HIP-1313 volume discounts.
 * @param maxTotalCostHbar - Optional budget cap in HBAR.
 * @returns A fully populated {@link CostEstimate}.
 */
export function buildCostEstimate(
  count: number,
  entityType: EntityType,
  useHighVolume: boolean,
  maxTotalCostHbar?: number,
): CostEstimate {
  const expectedHbar = calculateExpectedCost(count, entityType, useHighVolume);
  const minHbar = roundTo6(expectedHbar * (1 - VARIANCE_FACTOR));
  const maxHbar = roundTo6(expectedHbar * (1 + VARIANCE_FACTOR));
  const perEntityHbar = roundTo6(expectedHbar / count);

  // Build the base estimate
  const estimate: CostEstimate = {
    minHbar,
    maxHbar,
    expectedHbar,
    perEntityHbar,
  };

  // Add budget warning if applicable
  if (
    maxTotalCostHbar !== undefined &&
    maxHbar > maxTotalCostHbar
  ) {
    return {
      ...estimate,
      warning:
        `Estimated maximum cost (${String(maxHbar)} HBAR) exceeds your budget ` +
        `of ${String(maxTotalCostHbar)} HBAR. Proceeding may exceed your limit.`,
    };
  }

  return estimate;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Round a number to 6 decimal places using integer math.
 * Avoids `toFixed()` which returns a string.
 */
function roundTo6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
