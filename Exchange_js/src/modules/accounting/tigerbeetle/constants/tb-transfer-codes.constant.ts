/** TB transfer type codes (u16). Immutable once assigned. */
export const TB_TRANSFER_CODES = {
  ACCOUNT_SETUP: 1,
} as const;

export type TbTransferCode = (typeof TB_TRANSFER_CODES)[keyof typeof TB_TRANSFER_CODES];
