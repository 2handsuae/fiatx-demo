export type CustomerTagType = 'STATIC' | 'DERIVED';
export interface CustomerTagDefinition {
  tagCode: string;
  displayName: string;
  type: CustomerTagType;
  description: string;
}

export const CUSTOMER_TAG_DEFINITIONS: readonly CustomerTagDefinition[] = [
  { tagCode: 'NEW_CUSTOMER', displayName: '新客', type: 'DERIVED', description: 'onboarding 终批 ≤ newCustomerDays 天' },
  { tagCode: 'VIP', displayName: 'VIP', type: 'STATIC', description: '手动指定：商务/高净值客户，费率受众用（2026-09-06 与交易档位解绑）' },
  { tagCode: 'WHITELIST_PILOT', displayName: '白名单·试点', type: 'STATIC', description: '手动指定客户群' },
] as const;

const BY_CODE = new Map(CUSTOMER_TAG_DEFINITIONS.map((d) => [d.tagCode, d]));
export const NEW_CUSTOMER_DAYS = 30;

export function isValidTag(code: string): boolean { return BY_CODE.has(code); }
export function isStaticTag(code: string): boolean { return BY_CODE.get(code)?.type === 'STATIC'; }
