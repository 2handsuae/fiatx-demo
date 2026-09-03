export const WALLET_ROLE_LABEL: Record<string, string> = {
  C_DEP: 'Client Deposit',
  C_VIBAN: 'Client vIBAN',
  F_LIQ: 'Company Liquidity',
  F_OPS: 'Company Operations',
  F_SET: 'Company Settlement',
  F_FEE: 'Company Fees',
};

const ROLE_CLS: Record<string, string> = {
  C_DEP:   'bg-adm-blue/10  text-adm-blue  border-adm-blue/25',
  C_VIBAN: 'bg-adm-blue/10  text-adm-blue  border-adm-blue/25',
  F_LIQ:   'bg-adm-green/10 text-adm-green border-adm-green/25',
  F_OPS:   'bg-adm-green/10 text-adm-green border-adm-green/25',
  F_SET:   'bg-adm-green/10 text-adm-green border-adm-green/25',
  F_FEE:   'bg-adm-green/10 text-adm-green border-adm-green/25',
};

export const WalletRoleBadge = ({ role }: { role: string }) => {
  const cls = ROLE_CLS[role] ?? 'bg-adm-t3/10 text-adm-t2 border-adm-t3/25';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${cls}`}
      title={WALLET_ROLE_LABEL[role] || role}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {role}
    </span>
  );
};

export const WALLET_ROLE_OPTIONS = Object.keys(WALLET_ROLE_LABEL);

/** vaultCode → 展示名（CustodianWalletList 分组表头用）。 */
export const VAULT_LABELS: Record<string, string> = {
  F_OPS: 'Company Operations',
  F_SET: 'Company Settlement',
  F_FEE: 'Company Fees',
  F_LIQ: 'Company Liquidity',
  CLIENT_DEPOSIT: 'Client Deposit Pool',
};
