import { DEFAULT_JOURNAL_TEMPLATES } from './journal-templates.manifest';

type Template = (typeof DEFAULT_JOURNAL_TEMPLATES)[number];

function findTemplate(eventCode: string): Template {
  const found = DEFAULT_JOURNAL_TEMPLATES.find(
    (item) => item.header.eventCode === eventCode,
  );
  if (!found) {
    throw new Error(`Missing journal template for ${eventCode}`);
  }
  return found;
}

function assetLines(template: Template) {
  return template.lines.filter((line) => line.accountCode.startsWith('A.'));
}

describe('Journal Template Wallet Tag Constraints', () => {
  const depositEventCodes = [
    'EVT_DEPOSIT_CONFIRMED__CRYPTO',
    'EVT_DEPOSIT_SUCCESS__CRYPTO',
    'EVT_DEPOSIT_CONFIRMED__FIAT',
    'EVT_DEPOSIT_SUCCESS__FIAT',
  ] as const;

  const withdrawEventCodes = [
    'EVT_WITHDRAWAL_APPROVED__CRYPTO',
    'EVT_WITHDRAWAL_APPROVED__FIAT',
    'EVT_WITHDRAWAL_SUCCESS__CRYPTO',
    'EVT_WITHDRAWAL_SUCCESS__FIAT',
  ] as const;

  const internalEventCodes = [
    'EVT_INTERNAL_TX_CREATED__CRYPTO',
    'EVT_INTERNAL_TX_SUCCESS__CRYPTO',
    'EVT_INTERNAL_TX_CREATED__FIAT',
    'EVT_INTERNAL_TX_SUCCESS__FIAT',
  ] as const;

  it('deposit asset lines must contain walletId tag from src.walletId', () => {
    for (const eventCode of depositEventCodes) {
      const template = findTemplate(eventCode);
      for (const line of assetLines(template)) {
        expect(line.dimensionsRule).toContain('"walletId":"{{src.walletId}}"');
      }
    }
  });

  it('withdraw asset lines must contain walletId tag from src.fromWalletId', () => {
    for (const eventCode of withdrawEventCodes) {
      const template = findTemplate(eventCode);
      for (const line of assetLines(template)) {
        expect(line.dimensionsRule).toContain(
          '"walletId":"{{src.fromWalletId}}"',
        );
      }
    }
  });

  it('internal tx asset lines must contain walletId tag from src.from/toWalletId', () => {
    for (const eventCode of internalEventCodes) {
      const template = findTemplate(eventCode);
      for (const line of assetLines(template)) {
        expect(line.dimensionsRule).toMatch(
          /"walletId":"\{\{src\.(fromWalletId|toWalletId)\}\}"/,
        );
      }
    }
  });
});
