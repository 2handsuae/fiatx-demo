import { createHash } from 'crypto';

export function generateReferenceNo(prefix: string): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `${prefix}${year}${month}${day}${random}`;
}

export function buildDeterministicNo(
  prefix: string,
  ...segments: string[]
): string {
  const hash = createHash('sha256').update(segments.join('|')).digest('hex');
  const suffix = (parseInt(hash.slice(0, 4), 16) % 10000)
    .toString()
    .padStart(4, '0');
  return `${prefix}260101${suffix}`;
}
