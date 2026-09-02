// scripts/demo-mlro.ts
//
// 三条充值处置弧（没收/退回/上缴）都是 maker-checker：运营发起 + 换人批准。造数
// 脚本因此需要持有额外的身份 —— base seed 的职务账号（doc-final/demo/data.md
// 「管理员」节，8 职务各一人，密码统一 123456）：
//
//   DEPOSIT_CONFISCATION 单步 CFO （2026-08-30 由 OPS_OFFICER 改财务裁决——没收是客户
//                        的钱变公司收入，属财务事项；且发起人只能是运营，原配置构成
//                        自批死锁，见 approval.constants.ts）
//   DEPOSIT_RETURN       单步 MLRO
//   DEPOSIT_SEIZE        两步 SENIOR_MANAGEMENT_OFFICER → MLRO（四眼）
//
// 走真实登录 + 真实 HTTP 审批端点（而不是在造数脚本自己的进程内直接构造一个
// ApprovalActorContext 对象）——这样"第二个身份"是一次真正独立的登录会话,不是
// 伪造的角色字符串,与"造数一律走真实流程重放"的规矩一致。

export async function loginAs(apiBase: string, email: string, password = '123456'): Promise<string> {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`);
  const body: any = await res.json();
  if (!body.access_token) {
    throw new Error(`login ${email} did not return access_token (got ${JSON.stringify(body)})`);
  }
  return body.access_token as string;
}

export const loginAsMlro = (apiBase: string) => loginAs(apiBase, 'mlro@fiatx.com');
export const loginAsSmo = (apiBase: string) => loginAs(apiBase, 'sm@fiatx.com');
export const loginAsOpsOfficer = (apiBase: string) => loginAs(apiBase, 'ops_officer@fiatx.com');
export const loginAsCfo = (apiBase: string) => loginAs(apiBase, 'cfo@fiatx.com');

/**
 * approvalNo = ApprovalCase 对外识别号（业务键），不是内部 id（UUID）——
 * ApprovalsService.approve() 端点已改为 `:approvalNo` 精确匹配（Task 17）。
 */
export async function approveApproval(
  apiBase: string,
  token: string,
  approvalNo: string,
  reason = 'demo fixture — approval',
): Promise<void> {
  const res = await fetch(`${apiBase}/admin/control-gates/approvals/${approvalNo}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(`approve ${approvalNo} failed: ${res.status} ${await res.text()}`);
}

/** 语义等价 approveApproval，专供 MLRO 这一步调用（RETURN 单步 / SEIZE 第二步）。 */
export async function approveAsMlro(apiBase: string, token: string, approvalNo: string): Promise<void> {
  await approveApproval(apiBase, token, approvalNo);
}
