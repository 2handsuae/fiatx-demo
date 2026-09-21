// 用法: node resolve-shot-targets.mjs http://127.0.0.1:<API端口>
// 输出 shell 可 source 的变量行。登录参数与 scripts/demo-shot.js 缺省一致。
const api = process.argv[2];
const login = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'treasury@fiatx.com', password: '123456' }) }).then((r) => r.json());
const token = login.access_token ?? login.token ?? login.accessToken;
const get = async (p) => { const r = await fetch(`${api}${p}`, { headers: { Authorization: `Bearer ${token}` } }); return r.json(); };
const listRaw = await get('/admin/reconciliation/cases?status=OPEN');
const list = Array.isArray(listRaw) ? listRaw : (listRaw.items ?? listRaw.rows ?? []);
const details = [];
for (const c of list) details.push(await get(`/admin/reconciliation/cases/${encodeURIComponent(c.caseNo)}`));
const hasKind = (d, kind) => (d.flowComparison ?? []).some((r) => (r.dispositions ?? []).some((x) => x.kind === kind));
const rowOf = (d, kind) => (d.flowComparison ?? []).find((r) => (r.dispositions ?? []).some((x) => x.kind === kind));
const firstCauseLabel = (d, kind) => rowOf(d, kind).dispositions.find((x) => x.kind === kind).causes[0].label;
// 四个目标案互不相同，避免 m3/m5 的落库定性影响后续 shot 的行状态
const used = new Set();
const pick = (kind) => { const d = details.find((x) => !used.has(x.caseNo) && hasKind(x, kind)); used.add(d.caseNo); return d; };
const correct = pick('CORRECT'); const reattr = pick('REATTRIBUTE');
const holdCase = pick('HOLD_INVESTIGATING'); const supp = pick('SUPPLEMENT');
const lines = [
  `CASE_CORRECT=${correct.caseNo}`,
  `CASE_REATTR=${reattr.caseNo}`, `CAUSE_REATTR=${JSON.stringify(firstCauseLabel(reattr, 'REATTRIBUTE'))}`,
  // CAUSE_HOLD 是采样后修正新增（brief 原稿 m6 用 "--click ::0" 想蒙混过第一个成因 radio，
  // 但 demo-shot.js 的 "文本::idx" 语义里空文本会匹配整页第一个可见按钮/链接，不会限定在
  // Hold 弹层内——实测证实见 task-0-report.md）：同 CAUSE_REATTR/CAUSE_SUPP 一样按行取真实
  // 成因 label 文本，供 shots.sh 精确点击。
  `CASE_HOLD=${holdCase.caseNo}`, `CAUSE_HOLD=${JSON.stringify(firstCauseLabel(holdCase, 'HOLD_INVESTIGATING'))}`,
  `CASE_SUPP=${supp.caseNo}`, `CAUSE_SUPP=${JSON.stringify(firstCauseLabel(supp, 'SUPPLEMENT'))}`,
];
console.log(lines.join('\n'));
