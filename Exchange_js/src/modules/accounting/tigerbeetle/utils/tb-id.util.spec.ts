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

    it('should produce lowercase hex string, padded to 32 digits', () => {
      const hex = bigintToHex(255n);
      expect(hex).toBe('0'.repeat(30) + 'ff');
    });

    it('should handle zero', () => {
      expect(bigintToHex(0n)).toBe('0'.repeat(32));
      expect(hexToBigint('0')).toBe(0n);
    });
  });
});

import { bigintToRegistryHex } from './tb-id.util';

describe('bigintToRegistryHex —— 注册表账户号恒 32 位（平账二期搭车①）', () => {
  it('十六进制首位为 0 的 u128 也补到 32 位，且数值不变', () => {
    const id = BigInt('0x0abc0000000000000000000000000001'); // 首位 0 → 裸 toString(16) 只有 31 位
    const hex = bigintToRegistryHex(id);
    expect(hex).toHaveLength(32);
    expect(hex.startsWith('0')).toBe(true);
    expect(hexToBigint(hex)).toBe(id);
  });
  it('已是 32 位的不动', () => {
    const id = BigInt('0xfabc0000000000000000000000000001');
    expect(bigintToRegistryHex(id)).toBe(id.toString(16));
  });
});

describe('tb-id hex padding (§A 幻影失衡根修)', () => {
  it('bigintToHex pads to 32 hex digits', () => {
    expect(bigintToHex(0x1n)).toBe('0'.repeat(31) + '1');
    expect(bigintToHex(0x1n)).toHaveLength(32);
  });
  it('full-width u128 stays 32 digits', () => {
    const full = (1n << 128n) - 1n;
    expect(bigintToHex(full)).toBe('f'.repeat(32));
  });
  it('roundtrips through hexToBigint', () => {
    const id = deterministicTransferId('DEPOSIT', 'DEP1', 'E1', 0);
    expect(hexToBigint(bigintToHex(id))).toBe(id);
  });
  it('bigintToRegistryHex agrees with bigintToHex now', () => {
    expect(bigintToRegistryHex(0x1n)).toBe('0'.repeat(31) + '1');
  });
});
