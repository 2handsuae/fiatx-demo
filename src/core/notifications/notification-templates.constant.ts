/**
 * 战役丙波一 T2：通知模板登记处——16 条全量，键 = `${domain}_${collapsedTo}` / 投诉码。
 * tipping-off 红线：文案是终稿，不含执法/合规/冻结类词；键查无即沉默——服务侧禁止为
 * 未登记的键加 default 分支（查不到模板 = 不发这条消息，不是"发一条兜底消息"）。
 */

export interface NotificationTemplateParams {
  orderNo: string;
  amount?: string;
  assetCode?: string;
}

export interface NotificationTemplate {
  title: string;
  body: (p: NotificationTemplateParams) => string;
  simulateEmail: boolean;
}

function amt(p: NotificationTemplateParams): string {
  return p.amount && p.assetCode ? ` of ${p.amount} ${p.assetCode}` : '';
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  DEPOSIT_SUCCESS:        { title: 'Deposit credited',            body: (p) => `Your deposit ${p.orderNo}${amt(p)} has been credited to your account.`, simulateEmail: true },
  DEPOSIT_FAILED:         { title: 'Deposit unsuccessful',        body: (p) => `Your deposit ${p.orderNo} could not be completed.`, simulateEmail: true },
  DEPOSIT_RETURNING:      { title: 'Deposit being returned',      body: (p) => `Your deposit ${p.orderNo} is being returned to the originating account.`, simulateEmail: false },
  DEPOSIT_RETURNED:       { title: 'Deposit returned',            body: (p) => `Your deposit ${p.orderNo} has been returned to the originating account.`, simulateEmail: true },
  DEPOSIT_CLAWED_BACK:    { title: 'Deposit reversed by bank',    body: (p) => `Your deposit ${p.orderNo} was reversed by the sending bank.`, simulateEmail: true },
  DEPOSIT_ACTION_PENDING: { title: 'Action required',             body: (p) => `Your deposit ${p.orderNo} needs additional information from you. Please open the order for details.`, simulateEmail: false },
  WITHDRAW_SUCCESS:       { title: 'Withdrawal completed',        body: (p) => `Your withdrawal ${p.orderNo}${amt(p)} has been completed.`, simulateEmail: true },
  WITHDRAW_REJECTED:      { title: 'Withdrawal not completed',    body: (p) => `Your withdrawal ${p.orderNo} could not be completed. Funds have been returned to your account.`, simulateEmail: true },
  WITHDRAW_RETURNED:      { title: 'Withdrawal returned',         body: (p) => `Your withdrawal ${p.orderNo} was returned by the receiving bank. Funds are back in your account.`, simulateEmail: true },
  WITHDRAW_FAILED:        { title: 'Withdrawal unsuccessful',     body: (p) => `Your withdrawal ${p.orderNo} could not be processed. Funds have been returned to your account.`, simulateEmail: true },
  WITHDRAW_ACTION_PENDING:{ title: 'Additional documents required', body: (p) => `Your withdrawal ${p.orderNo} requires additional documents. Please open the order to continue.`, simulateEmail: false },
  SWAP_SUCCESS:           { title: 'Exchange completed',          body: (p) => `Your exchange ${p.orderNo} has been completed.`, simulateEmail: true },
  SWAP_REJECTED:          { title: 'Exchange not completed',      body: (p) => `Your exchange ${p.orderNo} could not be completed. Your funds have been returned.`, simulateEmail: true },
  COMPLAINT_ACKNOWLEDGED: { title: 'Complaint received',          body: (p) => `Your complaint ${p.orderNo} has been received and is being looked into.`, simulateEmail: true },
  COMPLAINT_EXTENDED:     { title: 'Complaint review extended',   body: (p) => `The review period for your complaint ${p.orderNo} has been extended. A final response will follow.`, simulateEmail: true },
  COMPLAINT_RESOLVED:     { title: 'Complaint resolved',          body: (p) => `Your complaint ${p.orderNo} has been resolved. Please open it to view the outcome.`, simulateEmail: true },
};
