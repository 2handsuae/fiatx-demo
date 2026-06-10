import { validateCryptoAddress } from './address-validator.util';

describe('validateCryptoAddress', () => {
  describe('ETH', () => {
    it('accepts valid ETH address', () => {
      expect(validateCryptoAddress('ETH', '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18')).toEqual({ valid: true });
    });
    it('rejects ETH address without 0x prefix', () => {
      const result = validateCryptoAddress('ETH', '742d35Cc6634C0532925a3b844Bc9e7595f2bD18');
      expect(result.valid).toBe(false);
    });
    it('rejects ETH address with wrong length', () => {
      const result = validateCryptoAddress('ETH', '0x742d35Cc6634C0532925a3b844Bc');
      expect(result.valid).toBe(false);
    });
  });

  describe('TRX', () => {
    it('accepts valid TRX address', () => {
      expect(validateCryptoAddress('TRX', 'TJYs2qsBiZWpSJFoRBi8GveHHUBFcYNJaN')).toEqual({ valid: true });
    });
    it('rejects TRX address without T prefix', () => {
      const result = validateCryptoAddress('TRX', 'AJYs2qsBiZWpSJFoRBi8GveHHUBFcYNJaN');
      expect(result.valid).toBe(false);
    });
  });

  describe('BTC', () => {
    it('accepts valid BTC legacy address', () => {
      expect(validateCryptoAddress('BTC', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toEqual({ valid: true });
    });
    it('accepts valid BTC bech32 address', () => {
      expect(validateCryptoAddress('BTC', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toEqual({ valid: true });
    });
  });

  describe('unknown network', () => {
    it('rejects unknown network', () => {
      expect(validateCryptoAddress('UNKNOWN_NET', 'anyaddress')).toEqual({
        valid: false,
        reason: 'Unsupported network: UNKNOWN_NET',
      });
    });
  });
});
