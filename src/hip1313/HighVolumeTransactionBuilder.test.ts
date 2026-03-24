/**
 * Tests for the HIP-1313 high-volume flag layer.
 *
 * Uses mock Transaction objects that simulate the SDK's class structure
 * (constructor.name for type identification) without importing the actual SDK.
 */

import {
  applyHighVolumeFlag,
  isHighVolumeSupported,
  UnsupportedHighVolumeTransactionError,
  SUPPORTED_HIGH_VOLUME_TRANSACTIONS,
} from './HighVolumeTransactionBuilder.js';
import type { Transaction } from '@hashgraph/sdk';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock transaction with a specific constructor.name.
 * We need the prototype chain to look like a real SDK transaction,
 * including `.setHighVolume()` as a trackable mock.
 */
function createMockTx(typeName: string): Transaction & { setHighVolume: jest.Mock } {
  const setHighVolume = jest.fn().mockReturnThis();

  const tx = {
    setHighVolume,
  };

  // Override constructor.name so HIP-1313 identifies the type correctly
  Object.defineProperty(tx, 'constructor', {
    value: { name: typeName },
    writable: false,
    enumerable: false,
    configurable: true,
  });

  return tx as unknown as Transaction & { setHighVolume: jest.Mock };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HighVolumeTransactionBuilder', () => {
  // ─── applyHighVolumeFlag ───────────────────────────────────────────
  // Verifies that the flag is set on supported types, skipped when disabled,
  // and throws a descriptive error for unsupported types.

  describe('applyHighVolumeFlag', () => {
    it('should call setHighVolume(true) on an AccountCreateTransaction when enabled', () => {
      const mockTx = createMockTx('AccountCreateTransaction');

      applyHighVolumeFlag(mockTx, true);

      expect(mockTx.setHighVolume).toHaveBeenCalledTimes(1);
      expect(mockTx.setHighVolume).toHaveBeenCalledWith(true);
    });

    it('should call setHighVolume(true) on a TokenCreateTransaction when enabled', () => {
      const mockTx = createMockTx('TokenCreateTransaction');

      applyHighVolumeFlag(mockTx, true);

      expect(mockTx.setHighVolume).toHaveBeenCalledTimes(1);
      expect(mockTx.setHighVolume).toHaveBeenCalledWith(true);
    });

    it('should call setHighVolume(true) on a TopicCreateTransaction when enabled', () => {
      const mockTx = createMockTx('TopicCreateTransaction');

      applyHighVolumeFlag(mockTx, true);

      expect(mockTx.setHighVolume).toHaveBeenCalledTimes(1);
      expect(mockTx.setHighVolume).toHaveBeenCalledWith(true);
    });

    it('should return the transaction unchanged when enabled is false', () => {
      // Verifies no-op behavior — reference equality proves no wrapping/cloning occurred
      const mockTx = createMockTx('AccountCreateTransaction');

      const result = applyHighVolumeFlag(mockTx, false);

      expect(result).toBe(mockTx);
      expect(mockTx.setHighVolume).not.toHaveBeenCalled();
    });

    it('should throw UnsupportedHighVolumeTransactionError for unsupported tx types', () => {
      // Tests the guard clause that prevents applying the flag to non-HIP-1313 transactions
      const mockTx = createMockTx('FileCreateTransaction');

      expect(() => applyHighVolumeFlag(mockTx, true)).toThrow(
        UnsupportedHighVolumeTransactionError,
      );
    });

    it('should include the unsupported type name in the error', () => {
      // Verifies the error carries the exact transaction type name for debugging
      const mockTx = createMockTx('FileCreateTransaction');

      try {
        applyHighVolumeFlag(mockTx, true);
        // Should not reach here
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(UnsupportedHighVolumeTransactionError);
        expect((err as UnsupportedHighVolumeTransactionError).transactionType).toBe(
          'FileCreateTransaction',
        );
      }
    });

    it('should list all supported types in the error', () => {
      // Verifies the error provides actionable guidance by listing supported types
      const mockTx = createMockTx('FileCreateTransaction');

      try {
        applyHighVolumeFlag(mockTx, true);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(UnsupportedHighVolumeTransactionError);
        const thrown = err as UnsupportedHighVolumeTransactionError;

        // Must contain all three HIP-1313 supported types
        expect(thrown.supportedTypes).toContain('AccountCreateTransaction');
        expect(thrown.supportedTypes).toContain('TokenCreateTransaction');
        expect(thrown.supportedTypes).toContain('TopicCreateTransaction');
        expect(thrown.supportedTypes).toHaveLength(SUPPORTED_HIGH_VOLUME_TRANSACTIONS.size);
      }
    });
  });

  // ─── isHighVolumeSupported ─────────────────────────────────────────
  // Verifies the non-throwing check returns correct boolean for supported and
  // unsupported transaction types.

  describe('isHighVolumeSupported', () => {
    it('should return true for AccountCreateTransaction', () => {
      const mockTx = createMockTx('AccountCreateTransaction');
      expect(isHighVolumeSupported(mockTx)).toBe(true);
    });

    it('should return true for TokenCreateTransaction', () => {
      const mockTx = createMockTx('TokenCreateTransaction');
      expect(isHighVolumeSupported(mockTx)).toBe(true);
    });

    it('should return true for TopicCreateTransaction', () => {
      const mockTx = createMockTx('TopicCreateTransaction');
      expect(isHighVolumeSupported(mockTx)).toBe(true);
    });

    it('should return false for unsupported transaction types', () => {
      // FileCreateTransaction is not in the HIP-1313 supported set
      const mockTx = createMockTx('FileCreateTransaction');
      expect(isHighVolumeSupported(mockTx)).toBe(false);
    });
  });

  // ─── SUPPORTED_HIGH_VOLUME_TRANSACTIONS ────────────────────────────
  // Verifies the constant's structure and immutability contract.

  describe('SUPPORTED_HIGH_VOLUME_TRANSACTIONS', () => {
    it('should contain exactly the three HIP-1313 transaction types', () => {
      expect(SUPPORTED_HIGH_VOLUME_TRANSACTIONS.size).toBe(3);
      expect(SUPPORTED_HIGH_VOLUME_TRANSACTIONS.has('AccountCreateTransaction')).toBe(true);
      expect(SUPPORTED_HIGH_VOLUME_TRANSACTIONS.has('TokenCreateTransaction')).toBe(true);
      expect(SUPPORTED_HIGH_VOLUME_TRANSACTIONS.has('TopicCreateTransaction')).toBe(true);
    });

    it('should be a ReadonlySet (immutable at runtime via type system)', () => {
      expect(SUPPORTED_HIGH_VOLUME_TRANSACTIONS).toBeInstanceOf(Set);
    });
  });
});
