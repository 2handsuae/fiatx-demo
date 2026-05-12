import {
  deterministicTransferId,
  bigintToHex,
  hexToBigint,
} from './tb-id.util';

describe('tb-id.util', () => {
  describe('deterministicTransferId', () => {
    it('should produce consistent output for same input', () => {
      const id1 = deterministicTransferId('DEPOSIT', 'DEP-001', 'DEPOSIT_CREDIT', 0);
      const id2 = deterministicTransferId('DEPOSIT', 'DEP-001', 'DEPOSIT_CREDIT', 0);
      expect(id1).toBe(id2);
    });

    it('should produce different output for different inputs', () => {
      const id1 = deterministicTransferId('DEPOSIT', 'DEP-001', 'DEPOSIT_CREDIT', 0);
      const id2 = deterministicTransferId('DEPOSIT', 'DEP-002', 'DEPOSIT_CREDIT', 0);
      expect(id1).not.toBe(id2);
    });

    it('should produce different output for different leg indexes', () => {
      const id1 = deterministicTransferId('SWAP', 'SWP-001', 'SWAP_SOURCE', 0);
      const id2 = deterministicTransferId('SWAP', 'SWP-001', 'SWAP_SOURCE', 1);
      expect(id1).not.toBe(id2);
    });

    it('should return a bigint', () => {
      const id = deterministicTransferId('DEPOSIT', 'DEP-001', 'DEPOSIT_CREDIT', 0);
      expect(typeof id).toBe('bigint');
    });
  });

  describe('bigintToHex / hexToBigint', () => {
    it('should round-trip correctly', () => {
      const original = 123456789012345678901234567890n;
      const hex = bigintToHex(original);
      const back = hexToBigint(hex);
      expect(back).toBe(original);
    });

    it('should produce lowercase hex string', () => {
      const hex = bigintToHex(255n);
      expect(hex).toBe('ff');
    });

    it('should handle zero', () => {
      expect(bigintToHex(0n)).toBe('0');
      expect(hexToBigint('0')).toBe(0n);
    });
  });
});
