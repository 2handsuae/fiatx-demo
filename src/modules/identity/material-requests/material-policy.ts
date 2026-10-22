import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface MaterialConfig {
  /** Sumsub 动作级 level。表单型材料（带 formKind）没有 Sumsub 侧动作，此键缺省。 */
  sumsubActionLevelName?: string;
  /** 表单型材料的判别：非空 = 客户端渲染我方表单、不起 Sumsub SDK session（对手方波二：OWNERSHIP_CLAIM）。 */
  formKind?: 'OWNERSHIP_CLAIM';
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
