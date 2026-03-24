import { Transaction } from '@hashgraph/sdk';

// ─── Supported Transaction Registry ─────────────────────────────────────────

/**
 * The canonical set of Hedera transaction types that support the HIP-1313
 * `high_volume` flag for variable-rate fee pricing on bulk operations.
 *
 * This `Set` is the **single source of truth**. When HIP-1313 is expanded
 * to cover additional transaction types in future SDK releases, add the
 * new transaction class name here — no other code in this module needs
 * to change.
 *
 * Uses a `Set` for O(1) lookup and implicit deduplication.
 *
 * @see https://hips.hedera.com/hip/hip-1313
 */
export const SUPPORTED_HIGH_VOLUME_TRANSACTIONS: ReadonlySet<string> = new Set([
  'AccountCreateTransaction',
  'TokenCreateTransaction',
  'TopicCreateTransaction',
]);

// ─── UnsupportedHighVolumeTransactionError ───────────────────────────────────

/**
 * Thrown when {@link applyHighVolumeFlag} is called with `enabled: true`
 * on a transaction type that does not support the HIP-1313 `high_volume` flag.
 *
 * @example
 * ```ts
 * try {
 *   applyHighVolumeFlag(someUnsupportedTx, true);
 * } catch (err) {
 *   if (err instanceof UnsupportedHighVolumeTransactionError) {
 *     console.log(err.transactionType);  // e.g. "FileCreateTransaction"
 *     console.log(err.supportedTypes);   // ["AccountCreateTransaction", ...]
 *   }
 * }
 * ```
 */
export class UnsupportedHighVolumeTransactionError extends Error {
  /** The name of the transaction type that was rejected. */
  public readonly transactionType: string;

  /** The list of transaction type names that HIP-1313 does support. */
  public readonly supportedTypes: readonly string[];

  constructor(transactionType: string) {
    const supportedTypes = [...SUPPORTED_HIGH_VOLUME_TRANSACTIONS].sort();

    super(
      `Transaction type "${transactionType}" does not support the HIP-1313 ` +
        `high_volume flag. Supported types: ${supportedTypes.join(', ')}.`,
    );

    this.name = 'UnsupportedHighVolumeTransactionError';
    this.transactionType = transactionType;
    this.supportedTypes = supportedTypes;

    // Restore prototype chain for correct `instanceof` checks
    Object.setPrototypeOf(this, UnsupportedHighVolumeTransactionError.prototype);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply the HIP-1313 `high_volume` flag to a Hedera transaction.
 *
 * When `enabled` is `true`, the transaction must be one of the types listed
 * in {@link SUPPORTED_HIGH_VOLUME_TRANSACTIONS}. If it is not, an
 * {@link UnsupportedHighVolumeTransactionError} is thrown.
 *
 * When `enabled` is `false`, the transaction is returned unchanged —
 * no validation is performed.
 *
 * @typeParam T - The concrete `Transaction` subclass.
 * @param tx      - The transaction to apply the flag to.
 * @param enabled - Whether to enable the high-volume flag.
 * @returns The same transaction instance (for method chaining).
 * @throws {UnsupportedHighVolumeTransactionError} If `enabled` is `true`
 *         and the transaction type is not supported by HIP-1313.
 */
export function applyHighVolumeFlag<T extends Transaction>(tx: T, enabled: boolean): T {
  if (!enabled) {
    return tx;
  }

  const txTypeName = tx.constructor.name;

  if (!SUPPORTED_HIGH_VOLUME_TRANSACTIONS.has(txTypeName)) {
    throw new UnsupportedHighVolumeTransactionError(txTypeName);
  }

  // TODO: Remove the `as any` cast once the @hashgraph/sdk ships typed
  // `.setHighVolume()` method signatures on the supported transaction classes.
  // Tracking: https://hips.hedera.com/hip/hip-1313
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  (tx as any).setHighVolume(true);

  return tx;
}

/**
 * Check whether a transaction type supports the HIP-1313 `high_volume` flag.
 *
 * This is a non-throwing alternative to {@link applyHighVolumeFlag} for
 * callers that want to check support before building the transaction.
 *
 * @param tx - The transaction to check.
 * @returns `true` if the transaction type is in {@link SUPPORTED_HIGH_VOLUME_TRANSACTIONS}.
 */
export function isHighVolumeSupported(tx: Transaction): boolean {
  return SUPPORTED_HIGH_VOLUME_TRANSACTIONS.has(tx.constructor.name);
}
