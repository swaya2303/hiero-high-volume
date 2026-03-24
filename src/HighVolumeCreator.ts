import { randomUUID } from 'node:crypto';
import {
  AccountCreateTransaction,
  TokenCreateTransaction,
  TopicCreateTransaction,
  PrivateKey,
  Hbar,
  TransactionId,
  AccountId,
} from '@hashgraph/sdk';

import type {
  HighVolumeConfig,
  EntityType,
  EntityCreationResult,
  JobStats,
  CostEstimate,
  BatchJob,
} from './types.js';
import { HieroClient } from './client/index.js';
import { BatchQueue } from './batch/index.js';
import { withRetry } from './retry/index.js';
import type { RetryOptions } from './retry/index.js';
import { applyHighVolumeFlag } from './hip1313/index.js';
import { buildCostEstimate } from './cost/index.js';
import { BatchJobEmitter, buildBatchJob } from './events/index.js';

// ─── Per-method option types ─────────────────────────────────────────────────

/** Options for {@link HighVolumeCreator.batchCreateAccounts}. */
export interface AccountBatchOptions {
  /** Initial HBAR balance for each new account. @default 0 */
  readonly initialBalanceHbar?: number;
  /** Entities per sub-batch. @default 50 */
  readonly batchSize?: number;
  /** Max simultaneous in-flight tasks. @default config.maxConcurrency ?? 10 */
  readonly maxConcurrency?: number;
  /** Called after each chunk settles with a progress snapshot. */
  readonly onProgress?: (stats: JobStats) => void;
  /** Called for each settled entity result. */
  readonly onEntityCreated?: (result: EntityCreationResult) => void;
}

/** Options for {@link HighVolumeCreator.batchCreateTokens}. */
export interface TokenBatchOptions {
  /** Name shared by all created tokens. */
  readonly tokenName: string;
  /** Symbol shared by all created tokens. */
  readonly tokenSymbol: string;
  /** Initial supply for each token. @default 0 */
  readonly initialSupply?: number;
  /** Entities per sub-batch. @default 50 */
  readonly batchSize?: number;
  /** Max simultaneous in-flight tasks. @default config.maxConcurrency ?? 10 */
  readonly maxConcurrency?: number;
  /** Called after each chunk settles with a progress snapshot. */
  readonly onProgress?: (stats: JobStats) => void;
  /** Called for each settled entity result. */
  readonly onEntityCreated?: (result: EntityCreationResult) => void;
}

/** Options for {@link HighVolumeCreator.batchCreateTopics}. */
export interface TopicBatchOptions {
  /** Optional topic memo applied to every created topic. */
  readonly memo?: string;
  /** Entities per sub-batch. @default 50 */
  readonly batchSize?: number;
  /** Max simultaneous in-flight tasks. @default config.maxConcurrency ?? 10 */
  readonly maxConcurrency?: number;
  /** Called after each chunk settles with a progress snapshot. */
  readonly onProgress?: (stats: JobStats) => void;
  /** Called for each settled entity result. */
  readonly onEntityCreated?: (result: EntityCreationResult) => void;
}

// ─── HighVolumeCreator ───────────────────────────────────────────────────────

/**
 * The main public API for batch entity creation on Hedera/Hiero.
 *
 * Composes {@link HieroClient}, {@link BatchQueue}, the retry layer,
 * and HIP-1313 high-volume flag into three convenience methods:
 * `batchCreateAccounts`, `batchCreateTokens`, and `batchCreateTopics`.
 *
 * @example
 * ```ts
 * import { HighVolumeCreator } from 'hiero-high-volume';
 *
 * const creator = new HighVolumeCreator({
 *   network: 'testnet',
 *   operatorId: '0.0.12345',
 *   operatorKey: '302e...',
 * });
 *
 * const job = await creator.batchCreateAccounts(100, {
 *   initialBalanceHbar: 1,
 *   onProgress: (stats) => console.log(stats),
 * });
 *
 * creator.close();
 * ```
 */
export class HighVolumeCreator {
  #client: HieroClient;
  #config: HighVolumeConfig;

  constructor(config: HighVolumeConfig) {
    this.#config = config;
    this.#client = new HieroClient(config);
  }

  // ─── Batch Create Methods ──────────────────────────────────────────

  /**
   * Create `count` Hedera accounts in parallel batches.
   *
   * @param count - Number of accounts to create.
   * @param opts  - Account-specific options and batch tuning.
   * @returns A {@link BatchJob} with results and live stats.
   */
  async batchCreateAccounts(
    count: number,
    opts: AccountBatchOptions = {},
  ): Promise<BatchJob> {
    const operatorId = AccountId.fromString(this.#config.operatorId);
    const keyType = this.#config.keyType ?? 'ED25519';

    const tasks = Array.from({ length: count }, () => {
      return (): Promise<EntityCreationResult> => {
        const newKey = keyType === 'ED25519'
          ? PrivateKey.generateED25519()
          : PrivateKey.generateECDSA();

        let tx = new AccountCreateTransaction()
          .setInitialBalance(new Hbar(opts.initialBalanceHbar ?? 0))
          .setKey(newKey.publicKey)
          .setTransactionId(TransactionId.generate(operatorId));

        tx = applyHighVolumeFlag(tx, true);

        return this.#submitAndMapAccount(tx);
      };
    });

    return this.#runBatch(count, 'account', tasks, opts);
  }

  /**
   * Create `count` Hedera tokens in parallel batches.
   *
   * @param count - Number of tokens to create.
   * @param opts  - Token-specific options and batch tuning.
   * @returns A {@link BatchJob} with results and live stats.
   */
  async batchCreateTokens(
    count: number,
    opts: TokenBatchOptions,
  ): Promise<BatchJob> {
    const operatorId = AccountId.fromString(this.#config.operatorId);

    const tasks = Array.from({ length: count }, () => {
      return (): Promise<EntityCreationResult> => {
        let tx = new TokenCreateTransaction()
          .setTokenName(opts.tokenName)
          .setTokenSymbol(opts.tokenSymbol)
          .setTreasuryAccountId(operatorId)
          .setInitialSupply(opts.initialSupply ?? 0)
          .setTransactionId(TransactionId.generate(operatorId));

        tx = applyHighVolumeFlag(tx, true);

        return this.#submitAndMapToken(tx);
      };
    });

    return this.#runBatch(count, 'token', tasks, opts);
  }

  /**
   * Create `count` Hedera consensus topics in parallel batches.
   *
   * @param count - Number of topics to create.
   * @param opts  - Topic-specific options and batch tuning.
   * @returns A {@link BatchJob} with results and live stats.
   */
  async batchCreateTopics(
    count: number,
    opts: TopicBatchOptions = {},
  ): Promise<BatchJob> {
    const operatorId = AccountId.fromString(this.#config.operatorId);

    const tasks = Array.from({ length: count }, () => {
      return (): Promise<EntityCreationResult> => {
        let tx = new TopicCreateTransaction()
          .setTransactionId(TransactionId.generate(operatorId));

        if (opts.memo) {
          tx = tx.setTopicMemo(opts.memo);
        }

        tx = applyHighVolumeFlag(tx, true);

        return this.#submitAndMapTopic(tx);
      };
    });

    return this.#runBatch(count, 'topic', tasks, opts);
  }

  // ─── Cost Estimation (Stub) ────────────────────────────────────────

  /**
   * Estimate the cost of creating `count` entities.
   *
   * Uses the HIP-1313 variable-rate fee schedule to compute expected,
   * minimum (−20%), and maximum (+20%) costs. Includes a budget warning
   * if the estimated maximum exceeds `maxTotalCostHbar` from config.
   *
   * @param count      - Number of entities to create.
   * @param entityType - Type of entity.
   * @returns A {@link CostEstimate} with expected, min, max, and per-entity costs.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async estimateCost(count: number, entityType: EntityType): Promise<CostEstimate> {
    return buildCostEstimate(
      count,
      entityType,
      true, // always use high-volume pricing (library applies HIP-1313 flag)
      this.#config.maxTotalCostHbar,
    );
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────

  /** Release the SDK connection pool. */
  close(): void {
    this.#client.close();
  }

  // ─── Private helpers ───────────────────────────────────────────────

  /**
   * Submit a transaction and return a structured {@link EntityCreationResult}.
   */
  async #submitAndMapAccount(
    tx: AccountCreateTransaction,
  ): Promise<EntityCreationResult> {
    const receipt = await this.#client.submitTransaction(tx);
    return {
      entityType: 'account',
      entityId: receipt.accountId?.toString() ?? null,
      success: true,
    };
  }

  async #submitAndMapToken(
    tx: TokenCreateTransaction,
  ): Promise<EntityCreationResult> {
    const receipt = await this.#client.submitTransaction(tx);
    return {
      entityType: 'token',
      entityId: receipt.tokenId?.toString() ?? null,
      success: true,
    };
  }

  async #submitAndMapTopic(
    tx: TopicCreateTransaction,
  ): Promise<EntityCreationResult> {
    const receipt = await this.#client.submitTransaction(tx);
    return {
      entityType: 'topic',
      entityId: receipt.topicId?.toString() ?? null,
      success: true,
    };
  }

  /**
   * Run a batch of entity creation tasks using BatchQueue + withRetry.
   * Wires a {@link BatchJobEmitter} for event-driven progress tracking.
   * Returns a {@link BatchJob} built by {@link buildBatchJob}.
   */
  async #runBatch(
    count: number,
    entityType: EntityType,
    tasks: Array<() => Promise<EntityCreationResult>>,
    opts: {
      batchSize?: number;
      maxConcurrency?: number;
      onProgress?: (stats: JobStats) => void;
      onEntityCreated?: (result: EntityCreationResult) => void;
    },
  ): Promise<BatchJob> {
    const jobId = generateJobId();
    const jobStartTime = Date.now();
    let completed = 0;
    let failed = 0;
    let totalFeeHbar = 0;

    // Build retry options from config
    const retryOptions: RetryOptions = {
      maxRetries: this.#config.maxRetries ?? 3,
      baseDelayMs: this.#config.retryBaseDelayMs ?? 500,
      maxDelayMs: 30_000,
      jitterFactor: 0.3,
    };

    // Wrap each task in withRetry
    const retriedTasks = tasks.map((task) => {
      return (): Promise<EntityCreationResult> => withRetry(task, retryOptions);
    });

    // Create emitter for this job
    const emitter = new BatchJobEmitter(jobId, entityType);

    // Build batch queue (fresh per job for independent cancellation)
    const queue = new BatchQueue<EntityCreationResult>({
      batchSize: opts.batchSize ?? 50,
      maxConcurrency: opts.maxConcurrency ?? this.#config.maxConcurrency ?? 10,
      onChunkComplete: (_chunkIndex: number, chunkResults: PromiseSettledResult<unknown>[]): void => {
        // Process each settled result in the chunk
        for (const settled of chunkResults) {
          if (settled.status === 'fulfilled') {
            completed++;
            const result = settled.value as EntityCreationResult;
            totalFeeHbar += result.feeChargedHbar ?? 0;
            emitter.emitEntityCreated(result);
            opts.onEntityCreated?.(result);
          } else {
            failed++;
            const errorResult: EntityCreationResult = {
              entityType,
              entityId: null,
              success: false,
              error: settled.reason instanceof Error
                ? settled.reason.message
                : String(settled.reason),
            };
            emitter.emitEntityFailed(errorResult, settled.reason);
            opts.onEntityCreated?.(errorResult);
          }
        }

        // Compute and emit progress stats
        const elapsedMs = Date.now() - jobStartTime;
        const estimatedRemainingMs = completed > 0
          ? (elapsedMs / completed) * (count - completed)
          : Infinity;
        const currentFeeRateHbar = elapsedMs > 0
          ? (totalFeeHbar / elapsedMs) * 1000
          : 0;

        const stats: JobStats = {
          completed,
          failed,
          total: count,
          elapsedMs,
          estimatedRemainingMs,
          currentFeeRateHbar,
        };

        emitter.emitProgress(stats);
        opts.onProgress?.(stats);
      },
    });

    // Build the user-facing BatchJob via the factory
    const job = buildBatchJob(emitter, () => {
      queue.cancel();
    });

    // Execute all tasks
    await queue.run(retriedTasks);

    // Emit completion — emitter builds the summary internally
    const totalElapsedMs = Date.now() - jobStartTime;
    emitter.emitComplete(
      [...job.results],
      totalElapsedMs,
    );

    return job;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a simple UUID-like job ID.
 * Uses `crypto.randomUUID()` (available in Node 19+) with a fallback.
 */
function generateJobId(): string {
  return randomUUID();
}
