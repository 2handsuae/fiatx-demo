// admin-web/src/components/ui/AddressBadges.tsx
//
// 地址簿详情页共用的两枚徽章：系统归因类型（VASP / 自托管 / 银行）与筛查结论（GREEN / YELLOW / RED）。
// 同一职责同一组件：客户提现地址详情与 LP 打款地址详情都从这里取，不在页面里各抄一份。

const TYPE_CLS: Record<string, string> = {
  VASP:         'bg-adm-blue/10  text-adm-blue  border-adm-blue/25',
  SELF_CUSTODY: 'bg-adm-amber/10 text-adm-amber border-adm-amber/25',
  BANK:         'bg-adm-green/10 text-adm-green border-adm-green/25',
};

export const ADDRESS_TYPE_LABEL: Record<string, string> = {
  VASP: 'VASP',
  SELF_CUSTODY: 'Self-Custody',
  BANK: 'Bank Account',
};

export const AddressTypeBadge = ({ type }: { type: string }) => {
  const cls = TYPE_CLS[type] ?? 'bg-adm-t3/10 text-adm-t2 border-adm-t3/25';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${cls}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {ADDRESS_TYPE_LABEL[type] || type}
    </span>
  );
};

const SCREENING_CLS: Record<string, string> = {
  GREEN:  'bg-adm-green/10 text-adm-green border-adm-green/25',
  YELLOW: 'bg-adm-amber/10 text-adm-amber border-adm-amber/25',
  RED:    'bg-adm-red/10   text-adm-red   border-adm-red/25',
};

export const ScreeningBadge = ({ answer }: { answer: string }) => {
  const cls = SCREENING_CLS[answer] ?? 'bg-adm-t3/10 text-adm-t2 border-adm-t3/25';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${cls}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {answer}
    </span>
  );
};
