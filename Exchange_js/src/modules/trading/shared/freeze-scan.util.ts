/**
 * 甲案：findNonTerminalByOwner（客户级限制冻结在途单扫描）的信封收编。
 *
 * 只锁「信封」——where 的 ownerId + 终态排除形状、select 恒含的审计必带键
 * （id / 单号字段 / ownerType / ownerId / ownerNo / status / traceId /
 * correlationId）。各域业务内容（终态排除集本身、单号字段名、swap 专属的
 * fromAmount 额外列）一律由调用方传入——不许把任何一域的终态集/业务注释
 * 搬进这一层；三域各自调用点保留原有的排除理由注释。
 */
export function freezeScanQueryArgs(opts: {
  ownerId: string;
  noField: 'depositNo' | 'withdrawNo' | 'swapNo';
  terminalStatuses: readonly string[];
  /** 仅 swap 传 { fromAmount: true }。 */
  extraSelect?: Record<string, true>;
}): { where: object; select: Record<string, true> } {
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
      ownerNo: true,
      status: true,
      traceId: true,
      correlationId: true,
      ...(opts.extraSelect ?? {}),
    },
  };
}
