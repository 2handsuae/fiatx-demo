export const TRAVEL_RULE_ADAPTER = Symbol('TRAVEL_RULE_ADAPTER');

export interface AddressAttributionResult {
  attributed: boolean;
  vaspName?: string;
  vaspDid?: string;
}

export interface TravelRuleAdapter {
  attributeAddress(address: string, network: string): Promise<AddressAttributionResult>;
}
