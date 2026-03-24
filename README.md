# hiero-high-volume

Bulk entity creation on Hedera/Hiero using [HIP-1313](https://hips.hedera.com/hip/hip-1313) variable-rate fees — accounts, tokens, and topics at scale with automatic batching, retry, and cost estimation.

[![CI](https://github.com/your-org/hiero-high-volume/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/hiero-high-volume/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/hiero-high-volume)](https://www.npmjs.com/package/hiero-high-volume)
[![coverage](https://img.shields.io/badge/coverage-90%25-brightgreen)](https://github.com/your-org/hiero-high-volume)

```bash
npm install hiero-high-volume @hashgraph/sdk
```

---

## Why this library

- **Hedera's standard throttle caps `AccountCreateTransaction` at ~15 TPS.** HIP-1313 introduces a `high_volume` flag that opts into variable-rate pricing and higher throughput. This library sets that flag on every transaction automatically and manages the batching to sustain hundreds of TPS.

- **Creating 100K accounts requires ~100K key generations, transaction builds, signatures, and receipt polls.** `hiero-high-volume` generates keys, builds transactions, signs with the operator key, submits via `Promise.allSettled`, and extracts entity IDs — all in a single `batchCreateAccounts(100_000)` call.

- **Transient Hedera errors (`BUSY`, `PLATFORM_NOT_ACTIVE`, `TRANSACTION_EXPIRED`) kill naive batch scripts.** The built-in retry layer uses exponential backoff with jitter (500ms base, 30s cap, ±30% jitter) and retries only the 5 known-transient status codes. Non-retryable errors (`INVALID_ACCOUNT_ID`, `INSUFFICIENT_PAYER_BALANCE`) propagate immediately.

- **You need to estimate cost before committing budget.** The fee model implements HIP-1313's four discount brackets (0% / 15% / 30% / 45%) with ±20% variance bounds, so you know the range before the first transaction hits the network.

---

## Quickstart

```typescript
import { HighVolumeCreator } from 'hiero-high-volume';
import type { JobStats, BatchJob } from 'hiero-high-volume';

// Connects to testnet with operator credentials
const creator = new HighVolumeCreator({
  network: 'testnet',
  operatorId: '0.0.YOUR_ACCOUNT',       // pays all fees
  operatorKey: '302e020100...',          // DER-encoded hex private key
  maxConcurrency: 10,                    // in-flight transactions at once
  maxRetries: 3,                         // retries per failed transaction
});

// Create 100 funded accounts with live progress
const job: BatchJob = await creator.batchCreateAccounts(100, {
  initialBalanceHbar: 1,                 // each account gets 1 HBAR
  batchSize: 50,                         // submit in chunks of 50
  onProgress: (stats: JobStats) => {
    const pct = ((stats.completed / stats.total) * 100).toFixed(0);
    console.log(`${pct}% — ${stats.completed}/${stats.total} accounts`);
  },
  onEntityCreated: (result) => {
    if (result.success) {
      console.log(`Created: ${result.entityId}`);
    }
  },
});

// All 100 results are available
console.log(`Job ${job.id} complete — ${job.results.length} accounts`);
console.log(`First account: ${job.results[0]?.entityId}`);

// Release SDK connection pool
creator.close();
```

---

## Configuration

All fields for the `HighVolumeConfig` constructor parameter:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `network` | `'mainnet' \| 'testnet' \| 'previewnet'` | *required* | Target Hedera network. Determines the SDK `Client` instance and fee schedule. |
| `operatorId` | `string` | *required* | Operator account in `0.0.XXXX` format. This account is charged for every transaction fee. |
| `operatorKey` | `string` | *required* | Operator's DER-encoded hex private key. Used to sign every submitted transaction. |
| `keyType` | `'ED25519' \| 'ECDSA'` | `'ED25519'` | Algorithm for new key pairs generated during entity creation. ED25519 is faster on Hedera; ECDSA is Ethereum-compatible. |
| `maxConcurrency` | `number` | `10` | Maximum simultaneous in-flight transactions. Higher values increase throughput but risk `BUSY` responses from the network. |
| `maxRetries` | `number` | `3` | Retry attempts per failed transaction before marking it as failed. Only transient errors (`BUSY`, `CLIENT_BUSY`, `PLATFORM_TRANSACTION_NOT_CREATED`, `PLATFORM_NOT_ACTIVE`, `TRANSACTION_EXPIRED`) trigger retries. |
| `retryBaseDelayMs` | `number` | `500` | Base delay for exponential backoff. Actual delay: `retryBaseDelayMs × 2^attempt` capped at 30s, with ±30% jitter. |
| `maxTotalCostHbar` | `number` | `undefined` | Budget cap in HBAR. If set, `estimateCost()` returns a `warning` when the estimated maximum exceeds this value. Prevents surprise fee overruns on large batches. |

---

## Cost Estimation

Estimate fees before committing HBAR. The model implements HIP-1313's four discount brackets:

| Entity Count | Multiplier | Discount |
|-------------|-----------|----------|
| 1 – 999 | 1.00× | 0% |
| 1,000 – 9,999 | 0.85× | 15% |
| 10,000 – 99,999 | 0.70× | 30% |
| 100,000+ | 0.55× | 45% |

```typescript
// Estimate cost for 10,000 accounts with HIP-1313 high-volume pricing
const estimate = await creator.estimateCost(10_000, 'account');

console.log(estimate);
// {
//   expectedHbar: 360.0,    // (0.05 × 0.70 + 0.001) × 10,000
//   minHbar:      288.0,    // expectedHbar × 0.80 (−20% variance)
//   maxHbar:      432.0,    // expectedHbar × 1.20 (+20% variance)
//   perEntityHbar: 0.036,   // expectedHbar / count
// }
```

The ±20% variance accounts for network congestion fluctuations. Base fees per entity: **account = 0.05 HBAR**, **token = 1.00 HBAR**, **topic = 0.01 HBAR**, plus 0.001 HBAR overhead per transaction.

**Budget guard:**

```typescript
const budgetCreator = new HighVolumeCreator({
  ...config,
  maxTotalCostHbar: 100,  // HBAR budget cap
});

const estimate = await budgetCreator.estimateCost(10_000, 'account');
// estimate.warning → "Estimated maximum cost (432 HBAR) exceeds your budget of 100 HBAR. ..."
```

---

## Progress Tracking & Event System

Every `batchCreate*` method accepts `onProgress` and `onEntityCreated` callbacks:

```typescript
const job = await creator.batchCreateAccounts(1000, {
  onProgress: (stats: JobStats) => {
    console.log({
      completed: stats.completed,                 // entities finished so far
      failed: stats.failed,                       // entities that failed after all retries
      total: stats.total,                         // total entities in this job
      elapsedMs: stats.elapsedMs,                 // wall-clock time since job start
      estimatedRemainingMs: stats.estimatedRemainingMs, // ETA based on current throughput
      currentFeeRateHbar: stats.currentFeeRateHbar,     // most recent per-entity fee
    });
  },

  onEntityCreated: (result) => {
    if (result.success) {
      console.log(`✓ ${result.entityId}`);
    } else {
      console.error(`✗ ${result.error}`);
    }
  },
});
```

Internally, each chunk uses `Promise.allSettled` — a failing transaction never aborts sibling transactions in the same chunk, and all results (successes and failures) are collected in `job.results`.

---

## Error Handling

### Retried automatically

Transient Hedera errors are retried with exponential backoff. After `maxRetries` attempts, a `MaxRetriesExceededError` surfaces:

```typescript
import { MaxRetriesExceededError } from 'hiero-high-volume/retry';

try {
  const job = await creator.batchCreateAccounts(500);
} catch (err) {
  if (err instanceof MaxRetriesExceededError) {
    console.error(`Failed after ${err.attempts} attempts`);
    console.error(`Last error: ${(err.lastError as Error).message}`);
    // err.attempts = 4 (1 initial + 3 retries)
    // err.lastError = the HieroClientError that exhausted retries
  }
}
```

**Retried:** `BUSY`, `CLIENT_BUSY`, `PLATFORM_TRANSACTION_NOT_CREATED`, `PLATFORM_NOT_ACTIVE`, `TRANSACTION_EXPIRED`.

**Not retried (propagated immediately):** `INVALID_ACCOUNT_ID`, `INSUFFICIENT_PAYER_BALANCE`, non-Hedera errors, and any status code not in the retryable set.

### HIP-1313 guard

The `applyHighVolumeFlag` layer throws if called on an unsupported transaction type:

```typescript
import { UnsupportedHighVolumeTransactionError } from 'hiero-high-volume/hip1313';

// Thrown if you try to apply the HIP-1313 flag to FileCreateTransaction, etc.
// error.transactionType → 'FileCreateTransaction'
// error.supportedTypes  → ['AccountCreateTransaction', 'TokenCreateTransaction', 'TopicCreateTransaction']
```

This is an internal guard — `batchCreate*` methods only use supported types, so you'll only encounter this if using the flag layer directly.

---

## API Reference

### `HighVolumeCreator`

```typescript
class HighVolumeCreator {
  constructor(config: HighVolumeConfig);

  batchCreateAccounts(count: number, opts?: AccountBatchOptions): Promise<BatchJob>;
  batchCreateTokens(count: number, opts: TokenBatchOptions): Promise<BatchJob>;
  batchCreateTopics(count: number, opts?: TopicBatchOptions): Promise<BatchJob>;

  estimateCost(count: number, entityType: EntityType): Promise<CostEstimate>;

  close(): void;
}
```

### Option types

```typescript
interface AccountBatchOptions {
  initialBalanceHbar?: number;  // default: 0
  batchSize?: number;           // default: 50
  maxConcurrency?: number;      // default: config.maxConcurrency
  onProgress?: (stats: JobStats) => void;
  onEntityCreated?: (result: EntityCreationResult) => void;
}

interface TokenBatchOptions {
  tokenName: string;            // required
  tokenSymbol: string;          // required
  initialSupply?: number;       // default: 0
  batchSize?: number;
  maxConcurrency?: number;
  onProgress?: (stats: JobStats) => void;
  onEntityCreated?: (result: EntityCreationResult) => void;
}

interface TopicBatchOptions {
  memo?: string;
  batchSize?: number;
  maxConcurrency?: number;
  onProgress?: (stats: JobStats) => void;
  onEntityCreated?: (result: EntityCreationResult) => void;
}
```

### Return types

```typescript
interface BatchJob {
  readonly id: string;                      // UUID v4
  status: BatchJobStatus;                   // 'pending' | 'running' | 'complete' | 'failed'
  stats: JobStats;                          // live statistics snapshot
  readonly results: EntityCreationResult[]; // grows as entities are created
  readonly cancel: () => void;              // graceful stop — in-flight work finishes
}

interface EntityCreationResult {
  entityType: EntityType;
  entityId: string | null;        // '0.0.XXXX' on success, null on failure
  success: boolean;
  error?: string;                 // human-readable failure reason
  transactionId?: string;         // Hedera transaction ID
  feeChargedHbar?: number;        // actual fee deducted
}

interface CostEstimate {
  expectedHbar: number;
  minHbar: number;                // expectedHbar × 0.80
  maxHbar: number;                // expectedHbar × 1.20
  perEntityHbar: number;
  warning?: string;               // present when maxHbar > maxTotalCostHbar
}
```

Full generated API documentation: [TypeDoc](https://your-org.github.io/hiero-high-volume/)

---

## Requirements

| Dependency | Version |
|-----------|---------|
| Node.js | ≥ 18 |
| `@hashgraph/sdk` | `^2.x` (peer dependency) |
| TypeScript | ≥ 5.0 (for consumers using TS) |

The package ships both **ESM** (`dist/index.mjs`) and **CJS** (`dist/index.js`) bundles with full TypeScript declarations (`.d.ts` / `.d.mts`). Import from either module system — no configuration needed.

---

## License

[Apache-2.0](LICENSE)
