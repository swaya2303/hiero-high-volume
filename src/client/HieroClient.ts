import {
  Client,
  AccountId,
  PrivateKey,
  Transaction,
  TransactionReceipt,
  Status,
} from '@hashgraph/sdk';

import type { HighVolumeConfig, NetworkType } from '../types.js';

// ─── Retryable Status Codes ──────────────────────────────────────────────────

/**
 * Hedera status codes that represent transient failures.
 * These indicate the network was temporarily unable to process the
 * transaction — retrying the same transaction may succeed.
 */
const RETRYABLE_STATUS_CODES: ReadonlySet<string> = new Set([
  'BUSY',
  'PLATFORM_TRANSACTION_NOT_CREATED',
  'PLATFORM_NOT_ACTIVE',
]);

// ─── HieroClientError ────────────────────────────────────────────────────────

/**
 * Typed error thrown by {@link HieroClient} when a Hedera transaction fails.
 *
 * Wraps the underlying SDK error and exposes the Hedera status code
 * so that callers (e.g. `RetryHandler`) can make retry decisions
 * without parsing error message strings.
 *
 * @internal
 */
export class HieroClientError extends Error {
  /** Hedera status code that caused the failure, if available. */
  public readonly statusCode: string | undefined;

  /** The original error from the Hedera SDK, preserved for diagnostics. */
  public readonly cause: Error | undefined;

  constructor(message: string, statusCode?: string, cause?: Error) {
    super(message);
    this.name = 'HieroClientError';
    this.statusCode = statusCode;
    this.cause = cause;

    // Restore prototype chain — required for `instanceof` when targeting ES2020
    Object.setPrototypeOf(this, HieroClientError.prototype);
  }
}

// ─── HieroClient ─────────────────────────────────────────────────────────────

/**
 * Internal wrapper around `@hashgraph/sdk`'s `Client` for submitting
 * transactions to the Hedera/Hiero network.
 *
 * This class handles:
 * - SDK client construction for the target network
 * - Operator key loading (ED25519 / ECDSA)
 * - Transaction signing, submission, and receipt retrieval
 * - Classification of retryable vs. terminal errors
 *
 * **Not part of the public API.** Retry logic is intentionally excluded —
 * that responsibility belongs to `RetryHandler`.
 *
 * @internal
 */
export class HieroClient {
  /** The underlying Hedera SDK client. */
  private readonly client: Client;

  /** Operator's private key, used to sign every transaction. */
  private readonly operatorKey: PrivateKey;

  /** Stored network type for getter access. */
  private readonly _networkType: NetworkType;

  /**
   * Creates a new `HieroClient` instance.
   *
   * @param config - Library configuration containing network, operator
   *                 credentials, and key type.
   * @throws {HieroClientError} If the operator key cannot be parsed.
   * @internal
   */
  constructor(config: HighVolumeConfig) {
    this._networkType = config.network;

    // --- Build SDK client for the correct network ---
    switch (config.network) {
      case 'mainnet':
        this.client = Client.forMainnet();
        break;
      case 'testnet':
        this.client = Client.forTestnet();
        break;
      case 'previewnet':
        this.client = Client.forPreviewnet();
        break;
      default: {
        // Exhaustiveness check — TypeScript will error if a new NetworkType
        // literal is added without handling it here.
        const _exhaustive: never = config.network;
        throw new HieroClientError(`Unsupported network: ${String(_exhaustive)}`);
      }
    }

    // --- Load operator key ---
    const keyType = config.keyType ?? 'ED25519';

    try {
      this.operatorKey =
        keyType === 'ED25519'
          ? PrivateKey.fromStringED25519(config.operatorKey)
          : PrivateKey.fromStringECDSA(config.operatorKey);
    } catch (err) {
      throw new HieroClientError(
        `Failed to parse ${keyType} operator key`,
        undefined,
        err instanceof Error ? err : undefined,
      );
    }

    // --- Set operator on the SDK client ---
    const operatorAccountId = AccountId.fromString(config.operatorId);
    this.client.setOperator(operatorAccountId, this.operatorKey);
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * The configured network (mainnet / testnet / previewnet).
   * @internal
   */
  get networkType(): NetworkType {
    return this._networkType;
  }

  /**
   * Submit a single transaction to the Hedera network.
   *
   * 1. Freezes the transaction (if not already frozen).
   * 2. Signs it with the operator key.
   * 3. Executes it on the network.
   * 4. Waits for the receipt.
   * 5. Verifies the receipt status is `SUCCESS`.
   *
   * This method submits **once** — no retries. Retry logic is the
   * responsibility of `RetryHandler`.
   *
   * @typeParam T - The concrete `Transaction` subclass being submitted.
   * @param tx - A Hedera transaction (e.g. `AccountCreateTransaction`).
   * @returns The transaction receipt on success.
   * @throws {HieroClientError} If submission fails or the receipt status
   *         is not `SUCCESS`.
   * @internal
   */
  async submitTransaction<T extends Transaction>(tx: T): Promise<TransactionReceipt> {
    try {
      // Freeze → Sign → Execute
      const frozenTx = tx.isFrozen() ? tx : tx.freezeWith(this.client);
      const signedTx = await frozenTx.sign(this.operatorKey);
      const response = await signedTx.execute(this.client);

      // Wait for the receipt
      const receipt = await response.getReceipt(this.client);

      // Check receipt status
      if (receipt.status !== Status.Success) {
        throw new HieroClientError(
          `Transaction failed with status: ${receipt.status.toString()}`,
          receipt.status.toString(),
        );
      }

      return receipt;
    } catch (err) {
      // If it's already a HieroClientError, re-throw as-is
      if (err instanceof HieroClientError) {
        throw err;
      }

      // Wrap SDK errors, extracting the status code if available
      const statusCode = extractStatusCode(err);
      throw new HieroClientError(
        err instanceof Error ? err.message : String(err),
        statusCode,
        err instanceof Error ? err : undefined,
      );
    }
  }

  /**
   * Determines whether an error is transient and the operation should
   * be retried.
   *
   * Returns `true` only for {@link HieroClientError} instances whose
   * `statusCode` is one of the known Hedera transient codes:
   * - `BUSY`
   * - `PLATFORM_TRANSACTION_NOT_CREATED`
   * - `PLATFORM_NOT_ACTIVE`
   *
   * @param error - The caught error to classify.
   * @returns `true` if the operation should be retried.
   * @internal
   */
  isRetryableError(error: unknown): boolean {
    if (!(error instanceof HieroClientError)) {
      return false;
    }

    if (error.statusCode === undefined) {
      return false;
    }

    return RETRYABLE_STATUS_CODES.has(error.statusCode);
  }

  /**
   * Close the underlying SDK client, releasing its gRPC connection pool.
   *
   * Call this when the `HighVolumeCreator` is no longer needed to avoid
   * leaking connections.
   *
   * @internal
   */
  close(): void {
    this.client.close();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Attempt to extract a Hedera status code string from an SDK error.
 *
 * The `@hashgraph/sdk` throws `StatusError`, `PrecheckStatusError`, and
 * `ReceiptStatusError` — all of which carry a `.status` property.
 */
function extractStatusCode(err: unknown): string | undefined {
  if (
    err !== null &&
    typeof err === 'object' &&
    'status' in err &&
    err.status !== null &&
    typeof err.status === 'object' &&
    'toString' in err.status
  ) {
    return (err.status as { toString(): string }).toString();
  }
  return undefined;
}
