import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface MaterialConfig {
  managementMode: 'SUMSUB_MANAGED' | 'SELF_MANAGED';
  requiredForLevels: string[];
  sumsubIdDocSetType?: string;
  sumsubActionLevelName: string;
  windowDays?: Record<string, number>;
  enforceRestriction: boolean;
  alternativeOf?: string;
}

export interface MaterialRefreshPolicy {
  version: string;
  effectiveFrom: string;
  stages: Array<{ daysFromExpiry: number; action: string }>;
  materials: Record<string, MaterialConfig>;
}

@Injectable()
export class MaterialRefreshPolicyLoader {
  private cached: MaterialRefreshPolicy | null = null;

  getPolicy(): MaterialRefreshPolicy {
    if (this.cached) return this.cached;
    const configPath = path.resolve(process.cwd(), 'config/material-refresh-policy.json');
    this.cached = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return this.cached!;
  }

  getMaterialConfig(materialType: string): MaterialConfig | null {
    return this.getPolicy().materials[materialType] || null;
  }

  reload(): void {
    this.cached = null;
  }
}
