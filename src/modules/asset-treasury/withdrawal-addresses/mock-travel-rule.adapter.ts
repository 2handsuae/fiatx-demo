import { Injectable } from '@nestjs/common';
import { TravelRuleAdapter, AddressAttributionResult, ScreeningAnswer } from './travel-rule-adapter.interface';

const VASP_SUFFIX = '1111';
const YELLOW_SUFFIX = '2222';
const RED_SUFFIX = '3333';

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
    return { attributed: false };
  }

  async screenAddress(address: string, _network: string): Promise<ScreeningAnswer> {
    if (address.endsWith(RED_SUFFIX)) return 'RED';
    if (address.endsWith(YELLOW_SUFFIX)) return 'YELLOW';
    return 'GREEN';
  }
}
