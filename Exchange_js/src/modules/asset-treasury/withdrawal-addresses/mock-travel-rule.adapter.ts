import { Injectable } from '@nestjs/common';
import { TravelRuleAdapter, AddressAttributionResult } from './travel-rule-adapter.interface';

@Injectable()
export class MockTravelRuleAdapter implements TravelRuleAdapter {
  async attributeAddress(_address: string, _network: string): Promise<AddressAttributionResult> {
    return { attributed: false };
  }
}
