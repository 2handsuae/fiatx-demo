import { WhitelistGuard } from './whitelist.guard';
import { TransferPath } from '../constants/internal-transfer-paths.constant';
import { BadRequestException } from '@nestjs/common';

describe('WhitelistGuard', () => {
  const guard = new WhitelistGuard();

  it('returns the policy for a whitelisted from→to pair', () => {
    const policy = guard.assertWhitelisted('C_DEP', 'C_MAIN');
    expect(policy.path).toBe(TransferPath.AGGREGATE);
  });

  it('throws for a non-whitelisted pair', () => {
    expect(() => guard.assertWhitelisted('C_DEP', 'F_LIQ')).toThrow(BadRequestException);
  });
});
