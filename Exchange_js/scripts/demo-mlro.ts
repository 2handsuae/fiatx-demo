// scripts/demo-mlro.ts
//
// 三条充值处置弧（没收/退回/上缴）都是 maker-checker：运营发起 + 换人批准。造数
// 脚本因此需要持有额外的身份 —— base seed 的职务账号（doc-final/demo/data.md
// 「管理员」节，8 职务各一人，密码统一 123456）：
//
//   DEPOSIT_CONFISCATION 单步 OPS_OFFICER  （approval.constants.ts 就是这么配的 ——
//                        与本任务需求书通篇"MLRO 换人批准"的表述不同；没收是运营
//                        内部互审，不是 MLRO 级，按代码实际配置为准，见 task-C2-report.md）
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

/**
 * approvalCaseId = ApprovalCase 内部 id（UUID），**不是**对外展示的 approvalNo。
 *
 * ⚠️ ApprovalsService.approve()/findCaseOrThrow() 全程 `where: { id }` 精确匹配
 * 内部 id，不认 approvalNo —— approvalNo 只能靠调用方自己先按 approvalNo 查一次
 * `approvalCase.id` 再传进来（demo-lib.ts 的 makerCheckerApprove 就是这么做的）。
 */
export async function approveApproval(
  apiBase: string,
  token: string,
  approvalCaseId: string,
  reason = 'demo fixture — approval',
): Promise<void> {
  const res = await fetch(`${apiBase}/admin/control-gates/approvals/${approvalCaseId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(`approve ${approvalCaseId} failed: ${res.status} ${await res.text()}`);
}

/** 语义等价 approveApproval，专供 MLRO 这一步调用（RETURN 单步 / SEIZE 第二步）。 */
export async function approveAsMlro(apiBase: string, token: string, approvalCaseId: string): Promise<void> {
  await approveApproval(apiBase, token, approvalCaseId);
}
