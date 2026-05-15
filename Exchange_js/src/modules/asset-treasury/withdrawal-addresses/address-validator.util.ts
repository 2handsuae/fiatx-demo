const VALIDATORS: Record<string, { pattern: RegExp; label: string }> = {
  ETH: { pattern: /^0x[0-9a-fA-F]{40}$/, label: 'Ethereum address (0x + 40 hex chars)' },
  TRX: { pattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, label: 'Tron address (T + 33 Base58 chars)' },
  BTC: {
    pattern: /^(1[1-9A-HJ-NP-Za-km-z]{25,34}|3[1-9A-HJ-NP-Za-km-z]{25,34}|bc1[0-9a-z]{39,59})$/,
    label: 'Bitcoin address (Legacy, SegWit, or Bech32)',
  },
  SOL: { pattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, label: 'Solana address (Base58)' },
};

export function validateCryptoAddress(network: string, address: string): { valid: boolean; reason?: string } {
  const validator = VALIDATORS[network];
  if (!validator) return { valid: true };
  if (!validator.pattern.test(address)) {
    return { valid: false, reason: `Invalid format for ${network}. Expected: ${validator.label}` };
  }
  return { valid: true };
}
