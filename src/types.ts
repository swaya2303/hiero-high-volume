// ─────────────────────────────────────────────────────────────────────────────
// hiero-high-volume — Public Type Surface
// ─────────────────────────────────────────────────────────────────────────────
// Pure TypeScript primitives only — no @hashgraph/sdk imports.
// No classes — only type aliases and interfaces.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Enums & Literals ────────────────────────────────────────────────────────

/**
 * The type of entity to create on the Hedera/Hiero network.
 *
 * - `'account'` — Hedera account (HBAR holder, can sign transactions)
 * - `'token'`   — Fungible or non-fungible token definition
 * - `'topic'`   — HCS (Hedera Consensus Service) topic for ordered messaging
 */
export type EntityType = 'account' | 'token' | 'topic';

/**
 * Cryptographic key algorithm for Hedera key pairs.
 *
 * - `'ED25519'` — EdDSA over Curve25519 (default, faster on Hedera)
 * - `'ECDSA'`   — ECDSA over secp256k1 (Ethereum-compatible)
 */
export type KeyType = 'ED25519' | 'ECDSA';

/**
 * The Hedera network environment to target.
 *
 * - `'mainnet'`    — Production network (real HBAR)
 * - `'testnet'`    — Public test network (free test HBAR)
 * - `'previewnet'` — Preview network for upcoming features
 */
export type NetworkType = 'mainnet' | 'testnet' | 'previewnet';

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Configuration for the `HighVolumeCreator` constructor.
 *
 * Provides credentials, network selection, and tuning parameters
 * for batch entity creation using the HIP-1313 high-volume flag.
 */
export interface HighVolumeConfig {
  /** The Hedera network to connect to. */
  readonly network: NetworkType;

  /**
   * The operator account ID in `0.0.XXXX` format.
   * This account pays for all transaction fees.
   */
  readonly operatorId: string;

  /**
   * The operator account's private key (DER-encoded hex string).
   * Used to sign all transactions submitted by this instance.
   */
  readonly operatorKey: string;

  /**
   * Key algorithm used when generating new key pairs for created entities.
   * @default 'ED25519'
   */
  readonly keyType?: KeyType;

  /**
   * Maximum number of transactions submitted concurrently within a batch.
   * Higher values increase throughput but risk rate-limiting.
   * @default 10
   */
  readonly maxConcurrency?: number;

  /**
   * Maximum number of retry attempts for a failed transaction
   * before marking the entity creation as failed.
   * @default 3
   */
  readonly maxRetries?: number;

  /**
   * Base delay in milliseconds for exponential backoff between retries.
   * Actual delay is `retryBaseDelayMs * 2^attempt` with jitter.
   * @default 500
   */
  readonly retryBaseDelayMs?: number;

  /**
   * Optional budget cap in HBAR for the entire creator instance.
   * If set, the library will abort new transactions once
   * cumulative fees reach this limit.
   */
  readonly maxTotalCostHbar?: number;
}

// ─── Batch Job Options (Discriminated Union) ─────────────────────────────────

/**
 * Base fields shared across all batch job option variants.
 * Not exported directly — consumers use {@link BatchJobOptions}.
 */
interface BatchJobOptionsBase {
  /**
   * The number of entities to create in this batch job.
   * Must be a positive integer.
   */
  readonly count: number;

  /**
   * Called periodically as the job progresses.
   * Receives a snapshot of current job statistics.
   */
  readonly onProgress?: (stats: JobStats) => void;

  /**
   * Called immediately after each individual entity is created (or fails).
   * Useful for streaming results to a database or UI.
   */
  readonly onEntityCreated?: (result: EntityCreationResult) => void;

  /**
   * Number of entities to process in each concurrent batch.
   * Defaults to {@link HighVolumeConfig.maxConcurrency} if not specified.
   */
  readonly batchSize?: number;
}

/**
 * Batch job options for creating accounts.
 *
 * `initialBalanceHbar` is **only** available when creating accounts,
 * since tokens and topics do not carry an HBAR balance.
 */
export interface AccountBatchJobOptions extends BatchJobOptionsBase {
  /** Discriminant — identifies this as an account creation job. */
  readonly entityType: 'account';

  /**
   * Initial HBAR balance to transfer to each newly created account.
   * Debited from the operator account.
   * @default 0
   */
  readonly initialBalanceHbar?: number;
}

/**
 * Batch job options for creating tokens.
 */
export interface TokenBatchJobOptions extends BatchJobOptionsBase {
  /** Discriminant — identifies this as a token creation job. */
  readonly entityType: 'token';
}

/**
 * Batch job options for creating topics.
 */
export interface TopicBatchJobOptions extends BatchJobOptionsBase {
  /** Discriminant — identifies this as a topic creation job. */
  readonly entityType: 'topic';
}

/**
 * Options passed to `batchCreate*` methods.
 *
 * This is a **discriminated union** on `entityType`:
 * - `'account'` variant includes `initialBalanceHbar`
 * - `'token'` and `'topic'` variants do **not**
 *
 * @example
 * ```ts
 * // ✅ Valid — initialBalanceHbar is allowed for accounts
 * const opts: BatchJobOptions = {
 *   entityType: 'account',
 *   count: 100,
 *   initialBalanceHbar: 10,
 * };
 *
 * // ❌ Type error — initialBalanceHbar is not on the token variant
 * const bad: BatchJobOptions = {
 *   entityType: 'token',
 *   count: 50,
 *   initialBalanceHbar: 5, // Property does not exist
 * };
 * ```
 */
export type BatchJobOptions =
  | AccountBatchJobOptions
  | TokenBatchJobOptions
  | TopicBatchJobOptions;

// ─── Job Statistics ──────────────────────────────────────────────────────────

/**
 * A snapshot of a running batch job's progress, emitted via `onProgress`.
 *
 * All fields are `readonly` — stats are immutable snapshots
 * captured at a point in time.
 */
export interface JobStats {
  /** Number of entities successfully created so far. */
  readonly completed: number;

  /** Number of entity creations that failed after all retries. */
  readonly failed: number;

  /** Total number of entities requested in this job. */
  readonly total: number;

  /** Wall-clock time elapsed since the job started, in milliseconds. */
  readonly elapsedMs: number;

  /**
   * Estimated wall-clock time remaining until job completion,
   * in milliseconds. Calculated from the current throughput rate.
   * May be `Infinity` if no entities have completed yet.
   */
  readonly estimatedRemainingMs: number;

  /**
   * Current fee rate per entity in HBAR.
   * Reflects the most recent transaction fee observed,
   * which may include the HIP-1313 high-volume discount.
   */
  readonly currentFeeRateHbar: number;
}

// ─── Cost Estimation ─────────────────────────────────────────────────────────

/**
 * A cost estimate returned by `estimateCost()` before starting a batch job.
 *
 * Estimates are based on the current fee schedule and are not guaranteed.
 * Always includes a range (min–max) to account for fee variability.
 */
export interface CostEstimate {
  /** Best-case total cost in HBAR (assuming all high-volume discounts apply). */
  readonly minHbar: number;

  /** Worst-case total cost in HBAR (assuming standard fee schedule). */
  readonly maxHbar: number;

  /** Expected total cost in HBAR based on typical fee patterns. */
  readonly expectedHbar: number;

  /** Estimated cost per entity in HBAR (based on expected total). */
  readonly perEntityHbar: number;

  /**
   * Optional warning message. Present when the estimate exceeds
   * the configured `maxTotalCostHbar`, when the fee schedule is stale,
   * or when network congestion may increase costs.
   */
  readonly warning?: string;
}

// ─── Entity Creation Result ──────────────────────────────────────────────────

/**
 * The outcome of a single entity creation attempt within a batch job.
 *
 * On success: `success === true`, `entityId` is populated, `error` is absent.
 * On failure: `success === false`, `entityId` is `null`, `error` describes the reason.
 */
export interface EntityCreationResult {
  /** The type of entity that was (or was attempted to be) created. */
  readonly entityType: EntityType;

  /**
   * The created entity's ID in `0.0.XXXX` format, or `null` if creation failed.
   */
  readonly entityId: string | null;

  /** Whether the entity was successfully created. */
  readonly success: boolean;

  /** Human-readable error message if creation failed. Absent on success. */
  readonly error?: string;

  /**
   * The Hedera transaction ID for this creation, in `operatorId@seconds.nanos` format.
   * May be absent if the transaction was never submitted (e.g., pre-check failure).
   */
  readonly transactionId?: string;

  /**
   * Actual fee charged for this transaction in HBAR.
   * May be absent if the transaction was never submitted or the receipt was unavailable.
   */
  readonly feeChargedHbar?: number;
}

// ─── Batch Job ───────────────────────────────────────────────────────────────

/** The lifecycle status of a batch job. */
export type BatchJobStatus = 'pending' | 'running' | 'complete' | 'failed';

/**
 * A batch creation job handle returned by `batchCreate*` methods.
 *
 * - `id` is immutable and uniquely identifies this job instance.
 * - `results` is a readonly reference (the array itself is not reassigned,
 *   though elements are appended as the job progresses).
 * - Call `cancel()` to request a graceful stop — in-flight transactions
 *   will complete but no new ones will be submitted.
 */
export interface BatchJob {
  /** Unique identifier for this job (UUID v4). */
  readonly id: string;

  /** Current lifecycle status of the job. */
  status: BatchJobStatus;

  /** Live statistics snapshot, updated as the job progresses. */
  stats: JobStats;

  /**
   * Array of results, one per entity. Grows as entities are created.
   * The array reference is readonly — elements are appended in place.
   */
  readonly results: EntityCreationResult[];

  /**
   * Gracefully cancel this job.
   *
   * In-flight transactions will finish, but no new transactions will
   * be submitted. The job status transitions to `'failed'` after
   * all in-flight work drains, with remaining entities marked as failed.
   */
  readonly cancel: () => void;
}
