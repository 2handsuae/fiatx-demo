import { Injectable } from '@nestjs/common';
import { TravelRuleAdapter, AddressAttributionResult, ScreeningAnswer, VaspProfile } from './travel-rule-adapter.interface';

const VASP_SUFFIX = '1111';
const YELLOW_SUFFIX = '2222';
const RED_SUFFIX = '3333';
const GREY_HARBOR_SUFFIX = '4444';

/**
 * Sumsub 侧的 VASP 名录（mock 只有两条）。
 * 政策口径 = "EEC 完成 ∧ 评分 < 10 ∧ licensed"：Mock VASP Exchange 全过，Grey Harbor 全不过
 * （不合格样本，供 ⚡V12 退回弧演示）。切真集成时名录来自 Sumsub，见 reference/sumsub-mock-touchpoints.md。
 */
export const MOCK_VASP_DIRECTORY: Record<string, VaspProfile> = {
  'did:mock:vasp-exchange-001': { name: 'Mock VASP Exchange', eecStatus: 'COMPLETED', riskScore: 3, licensed: true },
  'did:mock:grey-harbor-001': { name: 'Grey Harbor Exchange', eecStatus: 'PENDING', riskScore: 42, licensed: false },
};

/**
 * ⚡喂归因（admin demo）可选的两个名录样本：键 → did + 名称。
 * 名称取自名录本身，保证与 getVaspProfile / 地址簿尾号归因同源，不手抄第二份。
 */
const MOCK_EXCHANGE_DID = 'did:mock:vasp-exchange-001';
const GREY_HARBOR_DID = 'did:mock:grey-harbor-001';
export const FEEDABLE_VASPS = {
  MOCK_VASP_EXCHANGE: { vaspDid: MOCK_EXCHANGE_DID, vaspName: MOCK_VASP_DIRECTORY[MOCK_EXCHANGE_DID].name },
  GREY_HARBOR: { vaspDid: GREY_HARBOR_DID, vaspName: MOCK_VASP_DIRECTORY[GREY_HARBOR_DID].name },
} as const;
export type FeedableVaspKey = keyof typeof FEEDABLE_VASPS;
export const FEEDABLE_VASP_KEYS = Object.keys(FEEDABLE_VASPS) as FeedableVaspKey[];

/**
 * 站在 Sumsub 一侧的 mock：归因与筛查都按地址 / IBAN 尾号给确定性结论
 * （演示者输入已知地址得到已知结局——验收判据所在）。
 * 切真集成时这里是唯一的刀口，登记于 reference/sumsub-mock-touchpoints.md。
 */
@Injectable()
export class MockTravelRuleAdapter implements TravelRuleAdapter {
  async attributeAddress(address: string, _network: string): Promise<AddressAttributionResult> {
    if (address.endsWith(VASP_SUFFIX)) {
      return { attributed: true, vaspName: 'Mock VASP Exchange', vaspDid: 'did:mock:vasp-exchange-001' };
    }
    if (address.endsWith(GREY_HARBOR_SUFFIX)) {
      return { attributed: true, vaspName: 'Grey Harbor Exchange', vaspDid: 'did:mock:grey-harbor-001' };
    }
    return { attributed: false };
  }

  async screenAddress(address: string, _network: string): Promise<ScreeningAnswer> {
    if (address.endsWith(RED_SUFFIX)) return 'RED';
    if (address.endsWith(YELLOW_SUFFIX)) return 'YELLOW';
    return 'GREEN';
  }

  getVaspProfile(vaspDid: string): VaspProfile | null {
    return MOCK_VASP_DIRECTORY[vaspDid] ?? null;
  }
}
