import { Injectable } from '@nestjs/common';
import { TravelRuleAdapter, AddressAttributionResult } from './travel-rule-adapter.interface';

const VASP_SUFFIX = '1111';

@Injectable()
export class MockTravelRuleAdapter implements TravelRuleAdapter {
  async attributeAddress(address: string, _network: string): Promise<AddressAttributionResult> {
    if (address.endsWith(VASP_SUFFIX)) {
      return { attributed: true, vaspName: 'Mock VASP Exchange', vaspDid: 'did:mock:vasp-exchange-001' };
    }
    return { attributed: false };
  }
}
