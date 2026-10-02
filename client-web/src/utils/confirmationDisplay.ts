// client-web/src/utils/confirmationDisplay.ts
//
// 兑换详情页"成交确认单"区块的显示条件（客户端测不了渲染，抽纯函数供 vitest）。
// status 必须是服务端 toCustomerSwapStatus() 收敛后的值（详情页拿到的就是它）——
// 判据不许另读别的字段：非 SUCCESS 单即使后端万一带了 confirmation 也不出单（纵深防御，
// 且冻结单收敛成 COMPLIANCE_PENDING 后与"处理中"同样没有确认单，tipping-off 不可区分）。
export const shouldShowConfirmation = (status: string, confirmation: unknown): boolean =>
  status === 'SUCCESS' && confirmation != null;
