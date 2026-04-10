import { ForbiddenException } from '@nestjs/common';

export function ensureCustomerCanTransact(customer: any): void {
  if (!customer) {
    throw new ForbiddenException('Customer not found');
  }
  if (customer.complianceHoldStatus === 'FROZEN') {
    throw new ForbiddenException('Account is frozen');
  }
  if (customer.restrictionStatus === 'RESTRICTED') {
    throw new ForbiddenException(
      `Account restricted: ${customer.restrictionReason || 'unspecified'}`,
    );
  }
  if (customer.operatingStatus !== 'ACTIVE') {
    throw new ForbiddenException('Account is not active');
  }
}
