import { BadRequestException } from '@nestjs/common';

/**
 * R3 invariant — Payout/Payin CLEARED rows must carry a final
 * referenceNo (BANK-PO for FIAT; txHash for CRYPTO) AND, for CRYPTO,
 * a non-null txHash.
 *
 * Thrown from PayoutsService.updateStatus and PayinsService.updateStatus
 * when a CLEAR transition would leave either field NULL on the persisted
 * row. Extends BadRequestException so existing controllers surface it as
 * HTTP 400 with `code: 'R3_FINALIZATION_INCOMPLETE'`.
 */
export class PayoutFinalizationIncompleteError extends BadRequestException {
  constructor(detail: string) {
    super({
      code: 'R3_FINALIZATION_INCOMPLETE',
      message: detail,
    });
  }
}
