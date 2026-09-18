/**
 * 甲案：findNonTerminalByOwner（客户级限制冻结在途单扫描）的信封收编。
 *
 * 只锁「信封」——where 的 ownerId + 终态排除形状、select 恒含的审计必带键
 * （id / 单号字段 / ownerType / ownerId / status / traceId / correlationId，
 * 外加客户号来源）。各域业务内容（终态排除集本身、单号字段名、swap 专属的
 * fromAmount 额外列）一律由调用方传入——不许把任何一域的终态集/业务注释
 * 搬进这一层；三域各自调用点保留原有的排除理由注释。
 *
 * 客户号来源必选（回归修复，2026-09-13）：DepositTransaction 无 ownerNo 列
 * （withdraw/swap 有且实测全填充），此前信封固定 select.ownerNo=true 导致
 * deposit 域的 findMany 运行时抛 Invalid invocation，被 onCustomerRestrictionOpened
 * 的 catch 吞成 ERROR 日志——整条广播冻结路径失效。必选 ownerNoSource 逼每个
 * 调用点显式声明自己域的客户号来源，防止同类漂移再犯。
 */
export function freezeScanQueryArgs(opts: {
  ownerId: string;
  noField: 'depositNo' | 'withdrawNo' | 'swapNo';
  terminalStatuses: readonly string[];
  /** 'column'：域表有 ownerNo 列（withdraw/swap）；'customerRelation'：域表无该列，走 customer 关系取 customerNo（deposit）。 */
  ownerNoSource: 'column' | 'customerRelation';
  /** 仅 swap 传 { fromAmount: true }。 */
  extraSelect?: Record<string, true>;
}): { where: object; select: Record<string, unknown> } {
  return {
    where: {
      ownerId: opts.ownerId,
      status: { notIn: [...opts.terminalStatuses] },
    },
    select: {
      id: true,
      [opts.noField]: true,
      ownerType: true,
      ownerId: true,
      ...(opts.ownerNoSource === 'column'
        ? { ownerNo: true }
        : { customer: { select: { customerNo: true } } }),
      status: true,
      traceId: true,
      correlationId: true,
      ...(opts.extraSelect ?? {}),
    },
  };
}
