/** Block-explorer tx link by network — TRON/ETHEREUM supported, others get no link. */
export const explorerTxUrl = (network: string | null | undefined, hash: string): string | undefined => {
  switch ((network || '').toUpperCase()) {
    case 'TRON':
      return `https://tronscan.org/#/transaction/${hash}`;
    case 'ETHEREUM':
      return `https://etherscan.io/tx/${hash}`;
    default:
      return undefined;
  }
};
