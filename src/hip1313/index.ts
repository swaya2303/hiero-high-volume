/**
 * HIP-1313 high-volume flag module.
 *
 * Provides utilities for applying the `high_volume` flag to supported
 * Hedera transaction types, enabling variable-rate fee pricing for
 * bulk entity creation.
 *
 * @see https://hips.hedera.com/hip/hip-1313
 */
export {
  SUPPORTED_HIGH_VOLUME_TRANSACTIONS,
  UnsupportedHighVolumeTransactionError,
  applyHighVolumeFlag,
  isHighVolumeSupported,
} from './HighVolumeTransactionBuilder.js';
