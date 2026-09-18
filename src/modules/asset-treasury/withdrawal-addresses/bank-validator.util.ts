/**
 * IBAN validation — ISO 13616 format + mod-97 checksum.
 */
export function validateIban(iban: string): { valid: boolean; reason?: string } {
  const clean = iban.replace(/\s/g, '').toUpperCase();

  if (clean.length < 15 || clean.length > 34) {
    return { valid: false, reason: 'IBAN must be 15-34 characters' };
  }

  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(clean)) {
    return { valid: false, reason: 'IBAN must start with 2-letter country code + 2 check digits, followed by alphanumeric characters' };
  }

  // ISO 13616 mod-97 checksum: move first 4 chars to end, convert letters to digits, mod 97 must equal 1
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));

  // Process in chunks to avoid BigInt for portability
  let remainder = '';
  for (const char of numeric) {
    remainder += char;
    remainder = String(Number(remainder) % 97);
  }

  if (Number(remainder) !== 1) {
    return { valid: false, reason: 'IBAN checksum is invalid' };
  }

  return { valid: true };
}

/**
 * SWIFT/BIC validation — 8 or 11 alphanumeric characters.
 * Pattern: 4 letters (bank) + 2 letters (country) + 2 alphanum (location) + optional 3 alphanum (branch)
 */
export function validateSwiftBic(code: string): { valid: boolean; reason?: string } {
  const clean = code.replace(/\s/g, '').toUpperCase();

  if (clean.length !== 8 && clean.length !== 11) {
    return { valid: false, reason: 'SWIFT/BIC must be exactly 8 or 11 characters' };
  }

  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(clean)) {
    return { valid: false, reason: 'SWIFT/BIC format invalid. Expected: 4 letters (bank) + 2 letters (country) + 2 alphanum (location) + optional 3 alphanum (branch)' };
  }

  return { valid: true };
}
