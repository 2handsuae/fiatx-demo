import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface PolicyRule {
  priority: number;
  condition: string;
  tier: string;
  action: string;
  immediateEffect?: string;
  signoffMethod: string;
}

export interface ClientRiskAssessmentPolicy {
  version: string;
  effectiveFrom: string;
  assessmentFrequencyDays: Record<string, number>;
  tierMappingRules: PolicyRule[];
  signoffActionTypeMap: Record<string, string>;
  tierLevelConstraint: Record<string, string[]>;
  frozenCustomersSkipLevelSync: boolean;
  downgradeForbidden: boolean;
}

@Injectable()
export class ClientRiskAssessmentPolicyLoader {
  private cachedPolicy: ClientRiskAssessmentPolicy | null = null;

  getPolicy(): ClientRiskAssessmentPolicy {
    if (this.cachedPolicy) return this.cachedPolicy;
    const configPath = path.resolve(process.cwd(), 'config/client-risk-assessment-policy.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    this.cachedPolicy = JSON.parse(raw) as ClientRiskAssessmentPolicy;
    return this.cachedPolicy;
  }

  reload(): void {
    this.cachedPolicy = null;
  }
}
