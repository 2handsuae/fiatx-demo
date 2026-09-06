import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface MaterialConfig {
  sumsubActionLevelName: string;
}

export interface MaterialRefreshPolicy {
  version: string;
  effectiveFrom: string;
  materials: Record<string, MaterialConfig>;
}

@Injectable()
export class MaterialPolicyLoader {
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
}
