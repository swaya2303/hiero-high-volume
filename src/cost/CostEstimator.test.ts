import {
  BASE_FEES_HBAR,
  VOLUME_BRACKETS,
  getVolumeMultiplier,
  calculateExpectedCost,
  buildCostEstimate,
} from './CostEstimator.js';

describe('CostEstimator', () => {
  // ─── getVolumeMultiplier ─────────────────────────────────────────────

  describe('getVolumeMultiplier', () => {
    it('should return 1.0 for count = 1 (lower bound of first bracket)', () => {
      expect(getVolumeMultiplier(1)).toBe(1.0);
    });

    it('should return 1.0 for count = 999 (upper bound of first bracket)', () => {
      expect(getVolumeMultiplier(999)).toBe(1.0);
    });

    it('should return 0.85 for count = 1000 (lower bound of second bracket)', () => {
      expect(getVolumeMultiplier(1000)).toBe(0.85);
    });

    it('should return 0.85 for count = 9999 (upper bound of second bracket)', () => {
      expect(getVolumeMultiplier(9999)).toBe(0.85);
    });

    it('should return 0.70 for count = 10000 (lower bound of third bracket)', () => {
      expect(getVolumeMultiplier(10000)).toBe(0.7);
    });

    it('should return 0.70 for count = 99999 (upper bound of third bracket)', () => {
      expect(getVolumeMultiplier(99999)).toBe(0.7);
    });

    it('should return 0.55 for count = 100000 (lower bound of fourth bracket)', () => {
      expect(getVolumeMultiplier(100000)).toBe(0.55);
    });

    it('should return 0.55 for count = 1000000 (well into fourth bracket)', () => {
      expect(getVolumeMultiplier(1_000_000)).toBe(0.55);
    });

    it('should throw RangeError for count = 0', () => {
      expect(() => getVolumeMultiplier(0)).toThrow(RangeError);
      expect(() => getVolumeMultiplier(0)).toThrow('at least 1');
    });

    it('should throw RangeError for negative count', () => {
      expect(() => getVolumeMultiplier(-5)).toThrow(RangeError);
    });
  });

  // ─── calculateExpectedCost ───────────────────────────────────────────

  describe('calculateExpectedCost', () => {
    it('should calculate account cost with high-volume disabled (multiplier = 1.0)', () => {
      // 100 accounts: (0.05 * 1.0 + 0.001) * 100 = 5.1
      const cost = calculateExpectedCost(100, 'account', false);
      expect(cost).toBe(5.1);
    });

    it('should calculate account cost with high-volume enabled (small count, no discount)', () => {
      // 100 accounts, bracket 1-999 → multiplier 1.0: (0.05 * 1.0 + 0.001) * 100 = 5.1
      const cost = calculateExpectedCost(100, 'account', true);
      expect(cost).toBe(5.1);
    });

    it('should apply 15% discount for 1000+ accounts with high-volume enabled', () => {
      // 1000 accounts, bracket 1000-9999 → multiplier 0.85
      // (0.05 * 0.85 + 0.001) * 1000 = (0.0425 + 0.001) * 1000 = 43.5
      const cost = calculateExpectedCost(1000, 'account', true);
      expect(cost).toBe(43.5);
    });

    it('should ignore brackets when useHighVolume is false regardless of count', () => {
      // 10000 accounts with high-volume OFF: (0.05 * 1.0 + 0.001) * 10000 = 510
      const cost = calculateExpectedCost(10_000, 'account', false);
      expect(cost).toBe(510);
    });

    it('should calculate token cost correctly', () => {
      // 500 tokens: (1.00 * 1.0 + 0.001) * 500 = 500.5
      const cost = calculateExpectedCost(500, 'token', false);
      expect(cost).toBe(500.5);
    });

    it('should calculate topic cost correctly', () => {
      // 200 topics: (0.01 * 1.0 + 0.001) * 200 = 2.2
      const cost = calculateExpectedCost(200, 'topic', false);
      expect(cost).toBe(2.2);
    });

    it('should apply 45% discount for 100000+ entities', () => {
      // 100000 topics: (0.01 * 0.55 + 0.001) * 100000 = (0.0055 + 0.001) * 100000 = 650
      const cost = calculateExpectedCost(100_000, 'topic', true);
      expect(cost).toBe(650);
    });
  });

  // ─── buildCostEstimate ───────────────────────────────────────────────

  describe('buildCostEstimate', () => {
    it('should compute min, max, expected, and perEntity correctly', () => {
      // 100 accounts, no high-volume: expected = 5.1
      const estimate = buildCostEstimate(100, 'account', false);

      expect(estimate.expectedHbar).toBe(5.1);
      expect(estimate.minHbar).toBe(Math.round(5.1 * 0.8 * 1_000_000) / 1_000_000);
      expect(estimate.maxHbar).toBe(Math.round(5.1 * 1.2 * 1_000_000) / 1_000_000);
      expect(estimate.perEntityHbar).toBe(Math.round((5.1 / 100) * 1_000_000) / 1_000_000);
    });

    it('should set warning when maxHbar exceeds budget', () => {
      // 100 accounts: expected = 5.1, maxHbar = 5.1 * 1.2 = 6.12
      // Budget = 5.0 → maxHbar (6.12) > budget → warning
      const estimate = buildCostEstimate(100, 'account', false, 5.0);

      expect(estimate.warning).toBeDefined();
      expect(estimate.warning).toContain('6.12');
      expect(estimate.warning).toContain('5');
      expect(estimate.warning).toContain('exceeds your budget');
    });

    it('should NOT set warning when cost is within budget', () => {
      // 100 accounts: maxHbar = 6.12, budget = 10.0 → within budget
      const estimate = buildCostEstimate(100, 'account', false, 10.0);

      expect(estimate.warning).toBeUndefined();
    });

    it('should NOT set warning when no budget is provided', () => {
      const estimate = buildCostEstimate(100, 'account', false);
      expect(estimate.warning).toBeUndefined();
    });

    it('should handle high-volume discount in estimate', () => {
      // 5000 tokens: multiplier 0.85 → (1.0 * 0.85 + 0.001) * 5000 = 4255
      const estimate = buildCostEstimate(5000, 'token', true);

      expect(estimate.expectedHbar).toBe(4255);
      expect(estimate.minHbar).toBe(3404);
      expect(estimate.maxHbar).toBe(5106);
    });
  });

  // ─── Constants ───────────────────────────────────────────────────────

  describe('BASE_FEES_HBAR', () => {
    it('should define fees for all three entity types', () => {
      expect(BASE_FEES_HBAR.account).toBe(0.05);
      expect(BASE_FEES_HBAR.token).toBe(1.0);
      expect(BASE_FEES_HBAR.topic).toBe(0.01);
    });
  });

  describe('VOLUME_BRACKETS', () => {
    it('should have exactly 4 brackets', () => {
      expect(VOLUME_BRACKETS).toHaveLength(4);
    });

    it('should have the last bracket unbounded (maxCount = null)', () => {
      const last = VOLUME_BRACKETS[VOLUME_BRACKETS.length - 1];
      expect(last?.maxCount).toBeNull();
    });

    it('should be ordered by ascending minCount', () => {
      for (let i = 1; i < VOLUME_BRACKETS.length; i++) {
        const prev = VOLUME_BRACKETS[i - 1];
        const curr = VOLUME_BRACKETS[i];
        if (prev && curr) {
          expect(curr.minCount).toBeGreaterThan(prev.minCount);
        }
      }
    });
  });
});
