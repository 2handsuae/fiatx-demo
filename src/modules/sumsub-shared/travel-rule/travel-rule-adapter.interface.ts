export const TRAVEL_RULE_ADAPTER = Symbol('TRAVEL_RULE_ADAPTER');

export interface AddressAttributionResult {
  attributed: boolean;
  vaspName?: string;
  vaspDid?: string;
}

/** 筛查结论（站在 Sumsub 一侧的 mock 能力，登记时算出；见 reference/sumsub-mock-touchpoints.md） */
export type ScreeningAnswer = 'GREEN' | 'YELLOW' | 'RED';

/**
 * VASP 名录档案（站在 Sumsub 一侧的数据：EEC 尽调状态 / 风险评分 / 牌照）。
 * 只在 mock 侧现取现拼，不落订单——Sumsub 的数据住 Sumsub 侧。
 */
export interface VaspProfile {
  name: string;
  eecStatus: 'COMPLETED' | 'PENDING';
  riskScore: number;
  licensed: boolean;
}

export interface TravelRuleAdapter {
  attributeAddress(address: string, network: string): Promise<AddressAttributionResult>;
  /** 地址 / IBAN 筛查：mock 按尾号确定性给结论（2222→YELLOW、3333→RED、其余 GREEN） */
  screenAddress(address: string, network: string): Promise<ScreeningAnswer>;
  /** VASP 名录档案：按 did 现取；名录里没有 → null */
  getVaspProfile(vaspDid: string): VaspProfile | null;
}
