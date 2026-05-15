export const BUSINESS_CONFIG_SUBJECT_TYPES = [
  'PRICING_POLICY',
  'ASSET_CONFIG',
] as const;

export type BusinessConfigSubjectType =
  (typeof BUSINESS_CONFIG_SUBJECT_TYPES)[number];

export const BUSINESS_CONFIG_REVISION_STATUSES = {
  STAGED: 'STAGED',
  PUBLISHED: 'PUBLISHED',
} as const;

export const BUSINESS_CONFIG_RELEASE_STATUSES = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
} as const;

export type BusinessConfigRevisionStatus =
  (typeof BUSINESS_CONFIG_REVISION_STATUSES)[keyof typeof BUSINESS_CONFIG_REVISION_STATUSES];

export type BusinessConfigReleaseStatus =
  (typeof BUSINESS_CONFIG_RELEASE_STATUSES)[keyof typeof BUSINESS_CONFIG_RELEASE_STATUSES];

export type BusinessConfigDiffAction = 'ADDED' | 'CHANGED' | 'REMOVED' | 'UNCHANGED';

export interface BusinessConfigDiffItem {
  businessKey: string;
  action: BusinessConfigDiffAction;
  fromRevisionNo: number | null;
  toRevisionNo: number | null;
}

export interface BusinessConfigValidationSummary {
  ok: boolean;
  issues: string[];
  warnings: string[];
  validatedAt: string;
}
