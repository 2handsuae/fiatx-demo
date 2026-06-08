import { BadRequestException, Injectable } from '@nestjs/common';
import {
  TransferPathPolicy,
  resolvePathPolicy,
  resolveRoutePolicy,
} from '../constants/internal-transfer-paths.constant';

@Injectable()
export class WhitelistGuard {
  assertWhitelisted(fromRole: string, toRole: string): TransferPathPolicy {
    const policy = resolvePathPolicy(fromRole, toRole);
    if (!policy) {
      throw new BadRequestException({
        code: 'TRANSFER_NOT_WHITELISTED',
        message: `from=${fromRole} to=${toRole} is not a whitelisted internal transfer path`,
      });
    }
    return policy;
  }

  assertRoute(route: string[]): TransferPathPolicy {
    const policy = resolveRoutePolicy(route);
    if (!policy) {
      throw new BadRequestException({
        code: 'TRANSFER_ROUTE_NOT_WHITELISTED',
        message: `route=[${route.join('->')}] is not a whitelisted internal transfer route`,
      });
    }
    return policy;
  }
}
