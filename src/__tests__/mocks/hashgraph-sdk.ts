/**
 * Shared mock factory for `@hashgraph/sdk`.
 *
 * Provides reusable mock constructors, transaction objects, and receipt factories
 * so tests can mock the Hedera SDK without duplicating boilerplate. Import only
 * the factories you need per test file.
 *
 * Usage:
 *   jest.mock('@hashgraph/sdk', () => mockSdkModule);
 *   import { createMockReceipt } from '../__tests__/mocks/hashgraph-sdk';
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */

// ─── Receipt Factory ─────────────────────────────────────────────────────────

/**
 * Create a mock `TransactionReceipt` with sensible defaults.
 * Override any field via `overrides`.
 */
export function createMockReceipt(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    status: { toString: (): string => 'SUCCESS' },
    accountId: { toString: (): string => '0.0.12345' },
    tokenId: { toString: (): string => '0.0.67890' },
    topicId: { toString: (): string => '0.0.11111' },
    ...overrides,
  };
}

// ─── Transaction Response Factory ────────────────────────────────────────────

/**
 * Create a mock `TransactionResponse` whose `getReceipt()` resolves
 * to a mock receipt.
 */
export function createMockTransactionResponse(): {
  getReceipt: jest.Mock<Promise<Record<string, unknown>>>;
} {
  return {
    getReceipt: jest.fn().mockResolvedValue(createMockReceipt()),
  };
}

// ─── Transaction Factory ─────────────────────────────────────────────────────

/**
 * Create a mock transaction object with chainable setter methods.
 *
 * Every setter method returns `this` for chaining. `.execute()` resolves
 * to a mock `TransactionResponse`. The `constructor.name` is set to `txName`
 * so HIP-1313 checks work correctly.
 */
export function createMockTransaction(txName = 'MockTransaction'): Record<string, any> {
  const mockTx: Record<string, any> = {};

  // Chainable setters
  const chainableMethods = [
    'setInitialBalance',
    'setKey',
    'setTokenName',
    'setTokenSymbol',
    'setTreasuryAccountId',
    'setInitialSupply',
    'setTopicMemo',
    'setTransactionId',
    'setHighVolume',
    'sign',
  ];

  for (const method of chainableMethods) {
    mockTx[method] = jest.fn().mockReturnThis();
  }

  // .execute() returns a promise
  mockTx.execute = jest.fn().mockResolvedValue(createMockTransactionResponse());

  // Override constructor.name for type identification
  Object.defineProperty(mockTx, 'constructor', {
    value: { name: txName },
    writable: false,
    enumerable: false,
    configurable: true,
  });

  return mockTx;
}

// ─── Full SDK Module Mock ────────────────────────────────────────────────────

/**
 * A complete mock of `@hashgraph/sdk` suitable for `jest.mock()`.
 *
 * Usage:
 *   jest.mock('@hashgraph/sdk', () => mockSdkModule);
 */
export const mockSdkModule = {
  AccountCreateTransaction: jest.fn(() => createMockTransaction('AccountCreateTransaction')),
  TokenCreateTransaction: jest.fn(() => createMockTransaction('TokenCreateTransaction')),
  TopicCreateTransaction: jest.fn(() => createMockTransaction('TopicCreateTransaction')),
  Transaction: class Transaction {},
  PrivateKey: {
    generateED25519: jest.fn(() => ({ publicKey: 'mock-ed25519-public-key' })),
    generateECDSA: jest.fn(() => ({ publicKey: 'mock-ecdsa-public-key' })),
    fromStringED25519: jest.fn(() => ({ publicKey: 'mock-ed25519-public-key' })),
    fromStringECDSA: jest.fn(() => ({ publicKey: 'mock-ecdsa-public-key' })),
  },
  Hbar: jest.fn((val: number) => ({ _value: val })),
  TransactionId: {
    generate: jest.fn(() => 'mock-tx-id'),
  },
  AccountId: {
    fromString: jest.fn((s: string) => s),
  },
  Client: {
    forTestnet: jest.fn(() => ({
      setOperator: jest.fn(),
      close: jest.fn(),
    })),
    forMainnet: jest.fn(() => ({
      setOperator: jest.fn(),
      close: jest.fn(),
    })),
    forPreviewnet: jest.fn(() => ({
      setOperator: jest.fn(),
      close: jest.fn(),
    })),
  },
  Status: {
    Success: { toString: (): string => 'SUCCESS' },
  },
};
