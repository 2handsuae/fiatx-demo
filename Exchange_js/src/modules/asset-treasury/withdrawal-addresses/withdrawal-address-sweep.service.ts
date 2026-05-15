import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';

@Injectable()
export class WithdrawalAddressSweepService {
  private readonly logger = new Logger(WithdrawalAddressSweepService.name);

  constructor(
    private readonly addressService: WithdrawalAddressService,
    private readonly workflowService: WithdrawalAddressWorkflowService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCoolingExpiry() {
    const expired = await this.addressService.findPendingExpired();
    if (expired.length === 0) return;

    this.logger.log(`Found ${expired.length} withdrawal addresses with expired cooling period`);
    let activated = 0;

    for (const addr of expired) {
      try {
        await this.workflowService.activateAddress(addr.addressNo, 'CRON');
        activated++;
      } catch (error) {
        this.logger.error(`Failed to activate withdrawal address ${addr.addressNo}`, error);
      }
    }

    this.logger.log(`Activated ${activated}/${expired.length} withdrawal addresses`);
  }
}
