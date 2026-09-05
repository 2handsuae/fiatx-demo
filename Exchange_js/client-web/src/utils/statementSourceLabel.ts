// 客户对账单「来源」列的人话（平账二期 spec §11）。唯一真相在账本 evidence 的 sourceType / eventCode；
// 这里只做展示映射：认损 = 平台调整；补款 / 垫款按客户侧腿的事件码分（后端 postFinalLeg 按用途铸）。
export function statementSourceLabel(row: { sourceType: string; eventCode: string }): string {
  if (row.sourceType === 'RECON_ADJUSTMENT') return '平台调整';
  if (row.sourceType === 'INTERNAL_TRANSFER') return row.eventCode === 'INTERNAL_TRANSFER_ADVANCE_IN' ? '平台垫付' : '平台补款';
  return row.sourceType === 'WITHDRAWAL' ? 'WITHDRAW' : row.sourceType;
}
