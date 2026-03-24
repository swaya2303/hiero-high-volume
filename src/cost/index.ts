/**
 * Cost estimation module for HIP-1313 variable-rate fee scheduling.
 */
export {
  BASE_FEES_HBAR,
  VOLUME_BRACKETS,
  getVolumeMultiplier,
  calculateExpectedCost,
  buildCostEstimate,
} from './CostEstimator.js';
export type { VolumeBracket } from './CostEstimator.js';
