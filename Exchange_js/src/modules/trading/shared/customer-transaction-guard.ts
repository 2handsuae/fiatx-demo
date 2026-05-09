import { ForbiddenException } from '@nestjs/common';

export interface CustomerGateFields {
  onboardingStatus?: string;
  adminStatus?: string;
  complianceStatus?: string;
  restrictions?: string;
}

export function ensureCustomerCanTransact(
  customer: CustomerGateFields | null | undefined,
  capability?: string,
): void {
  if (!customer) {
    throw new ForbiddenException('Customer not found');
  }
  if (customer.onboardingStatus !== 'APPROVED') {
    throw new ForbiddenException('Customer onboarding not approved');
  }
  if (customer.complianceStatus === 'FROZEN') {
    throw new ForbiddenException('Account is frozen');
  }
  if (customer.adminStatus !== 'ACTIVE') {
    throw new ForbiddenException('Account is not active');
  }
  if (capability) {
    const restrictions = parseRestrictions(customer.restrictions);
    const blocked = restrictions.some(
      (r) => r.capability === capability || r.capability === 'ALL',
    );
    if (blocked) {
      throw new ForbiddenException(`Operation ${capability} is currently restricted`);
    }
  }
}

function parseRestrictions(
  raw: string | null | undefined,
): Array<{ capability: string; reason: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
