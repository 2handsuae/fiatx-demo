/**
 * 审计动作码全量导出（第七幕波三，判据6）。
 * 机器事实（域/旅程/必填/异步/subjects名册）从常量重导——常量是唯一真相；
 * 说明列与"域内分组"结构从上一版种子文档解析——说明是人写的，代码里没有。
 * 名册与种子对不上 = 有码没说明/有说明没码 → 当场 fail-fast 列清单退出（exit 1），
 * 不允许静默出一份缺行的"最全版"（一次性操作失败要响，CLAUDE.md 证据纪律）。
 */
import * as fs from 'fs';
import { execSync } from 'child_process';
import {
  V1_AUDIT_ACTIONS, V4_DEPOSIT_AUDIT_ACTIONS, V5_WITHDRAW_AUDIT_ACTIONS,
  V6_SWAP_AUDIT_ACTIONS, V8_RECON_AUDIT_ACTIONS, V2_CUSTOMER_AUDIT_ACTIONS,
  V7_TREASURY_AUDIT_ACTIONS, INCIDENT_AUDIT_ACTIONS, REG_FILING_AUDIT_ACTIONS,
  COMPLIANCE_OFFICE_AUDIT_ACTIONS, COMPLAINT_AUDIT_ACTIONS,
  CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS, CAMPAIGN_B_LP_EXCHANGE_AUDIT_ACTIONS,
  CAMPAIGN_B_CAPITAL_INJECTION_AUDIT_ACTIONS, CAMPAIGN_B_VENDOR_PAYMENT_AUDIT_ACTIONS,
  CAMPAIGN_B_PRUDENTIAL_AUDIT_ACTIONS, CAMPAIGN_C_NOTIFICATION_AUDIT_ACTIONS,
  DEPRECATED_AUDIT_ACTIONS, SUBJECTS_COVERED_ACTIONS, AuditActionSpec,
} from '../src/modules/audit-logging/constants/audit-actions.constant';
import { AuditCorrelationMode } from '../src/modules/audit-logging/dto/audit-log.dto';

const SEED = process.argv[2] ?? 'doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md';
const OUT = 'doc-final/lark/2026-09-16-audit-actions-catalog-full.md';

const ALL: Record<string, AuditActionSpec> = {
  ...V1_AUDIT_ACTIONS,
  ...V4_DEPOSIT_AUDIT_ACTIONS,
  ...V5_WITHDRAW_AUDIT_ACTIONS,
  ...V6_SWAP_AUDIT_ACTIONS,
  ...V8_RECON_AUDIT_ACTIONS,
  ...V2_CUSTOMER_AUDIT_ACTIONS,
  ...V7_TREASURY_AUDIT_ACTIONS,
  ...INCIDENT_AUDIT_ACTIONS,
  ...REG_FILING_AUDIT_ACTIONS,
  ...COMPLIANCE_OFFICE_AUDIT_ACTIONS,
  ...COMPLAINT_AUDIT_ACTIONS,
  ...CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS,
  ...CAMPAIGN_B_LP_EXCHANGE_AUDIT_ACTIONS,
  ...CAMPAIGN_B_CAPITAL_INJECTION_AUDIT_ACTIONS,
  ...CAMPAIGN_B_VENDOR_PAYMENT_AUDIT_ACTIONS,
  ...CAMPAIGN_B_PRUDENTIAL_AUDIT_ACTIONS,
  ...CAMPAIGN_C_NOTIFICATION_AUDIT_ACTIONS,
};

// ── 种子解析：域节头 / 分组头 / 表行 ──────────────────────────────
interface GroupSection { header: string; codes: string[] }
interface DomainSection { key: string; introSuffix: string; intro: string; groups: GroupSection[] }

const seedText = fs.readFileSync(SEED, 'utf8');
const lines = seedText.split('\n');
const seedDesc: Record<string, string> = {};
const domains: DomainSection[] = [];
let curDomain: DomainSection | null = null;
let curGroup: GroupSection | null = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const domainMatch = line.match(/^## ([A-Z]+) 域 —— (.+)$/);
  const groupMatch = line.match(/^### (.+)$/);
  const rowMatch = line.match(/^\|\s*`([A-Z0-9_]+)`\s*\|(.*)\|.*\|.*\|.*\|$/);

  if (domainMatch) {
    curDomain = { key: domainMatch[1], introSuffix: domainMatch[2].replace(/（\d+\s*码）\s*$/, '').trim(), intro: '', groups: [] };
    domains.push(curDomain);
    curGroup = null;
    // 域导语：紧随其后的第一段非空、非标题文本
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,3} /.test(lines[j])) break;
      if (lines[j].trim() !== '') { curDomain.intro = lines[j].trim(); break; }
    }
  } else if (groupMatch && curDomain && !line.startsWith('## ')) {
    curGroup = { header: groupMatch[1], codes: [] };
    curDomain.groups.push(curGroup);
  } else if (rowMatch && curGroup) {
    const code = rowMatch[1];
    seedDesc[code] = rowMatch[2].trim();
    curGroup.codes.push(code);
  }
}

// ── 对账 fail-fast（乙案）：种子有码、常量里没有时，若该码已进
// DEPRECATED_AUDIT_ACTIONS，视为合法生命周期事件（active→retired）容忍放行——
// 从活跃表自然落出（退役附录本就从常量全列，不丢信息），只打一行提示；不在
// 退役名册里的消失、以及常量有码种子没说明，两种都是无法解释的对不上账，
// 照旧 fail-fast，且都在 fs.writeFileSync 之前——先对账后写盘不变。
const allCodes = new Set(Object.keys(ALL));
const seedCodes = new Set(Object.keys(seedDesc));
const deprecatedSet = new Set(DEPRECATED_AUDIT_ACTIONS);
const missingDesc = [...allCodes].filter((c) => !seedCodes.has(c)).sort();
const seedOnly = [...seedCodes].filter((c) => !allCodes.has(c));
const toleratedRetired = seedOnly.filter((c) => deprecatedSet.has(c)).sort();
const unexplainedGone = seedOnly.filter((c) => !deprecatedSet.has(c)).sort();
if (missingDesc.length > 0 || unexplainedGone.length > 0) {
  console.error('审计动作码名册与种子文档对不上——先修种子/常量再重跑，不写盘。');
  console.error(`有码没说明（常量里有、种子文档没有，${missingDesc.length} 个）：`);
  missingDesc.forEach((c) => console.error(`  - ${c}`));
  console.error(`种子有码、常量里既不在现役也不在退役名册（无法解释的消失，${unexplainedGone.length} 个）：`);
  unexplainedGone.forEach((c) => console.error(`  - ${c}`));
  process.exit(1);
}
const seedDateMatch = SEED.match(/(\d{4}-\d{2}-\d{2})/);
const seedDateLabel = seedDateMatch ? seedDateMatch[1] : '种子';
if (toleratedRetired.length > 0) {
  console.log(`note: ${toleratedRetired.length} seed codes retired since ${seedDateLabel}: ${toleratedRetired.join(', ')}`);
}

// ── 渲染：机器列从常量重导，说明/分组结构从种子重排 ──────────────────
const MODE_LABEL: Record<AuditCorrelationMode, string> = {
  [AuditCorrelationMode.START]: 'S 起点',
  [AuditCorrelationMode.INHERIT]: 'I 继承',
  [AuditCorrelationMode.NONE]: 'N 单步',
};

function renderRow(code: string): string {
  const spec = ALL[code];
  const journey = MODE_LABEL[spec.correlationMode];
  const required = spec.requiredFields.length ? spec.requiredFields.join(', ') : '—';
  const async = spec.requiresCausation ? '✓' : '';
  const subject = SUBJECTS_COVERED_ACTIONS.includes(code) ? '✓' : '';
  return `| \`${code}\` | ${seedDesc[code]} | ${journey} | ${required} | ${async} | ${subject} |`;
}

const domainCounts: Record<string, number> = {};
for (const spec of Object.values(ALL)) {
  domainCounts[spec.domain] = (domainCounts[spec.domain] ?? 0) + 1;
}
const total = Object.keys(ALL).length;
const commit = execSync('git rev-parse --short HEAD').toString().trim();
const today = new Date().toISOString().slice(0, 10);

const out: string[] = [];
out.push('# 审计动作码全量导出 —— 按域 × 按工作流（最全版）');
out.push('');
out.push(`> 生成于 ${today} ｜ 基线 main \`${commit}\` ｜ 机器列来源 \`src/modules/audit-logging/constants/audit-actions.constant.ts\`（9 份名册程序化导出）｜ 说明列来源 \`${SEED}\``);
const deltaClause = toleratedRetired.length > 0
  ? `（较 ${seedDateLabel} 版少 ${toleratedRetired.length}：${toleratedRetired.join('、')} 已退役，进拒写闸）`
  : '';
out.push(`> 现役 **${total} 码**${deltaClause}，另有退役 ${DEPRECATED_AUDIT_ACTIONS.length} 码进拒写闸（附录全列）。`);
out.push('> **旅程**列：S 起点=该码铸 correlationId 开启一段旅程 ｜ I 继承=延续同一旅程 ｜ N 单步=无旅程可挂（守卫拒绝、单步动作、报价先于订单等）。**异步**=✓ 表示由审批/事件驱动、必须带 causationId。**subjects**=✓ 表示该码在 SUBJECTS_COVERED_ACTIONS 名册（治理域+横切审批 47 码，verify:audit Q2 断言面）；交易域码运行时也写子表行但不在名册故留白；Related No 检索走 OR 语义（主表∨子表）不受此列影响。⚡=演示装置。');
out.push('');
out.push(`**分域计数**：${domains.map((d) => `${d.key} ${domainCounts[d.key] ?? 0}`).join(' ｜ ')} ｜ 合计 ${total}`);
out.push('');

for (const d of domains) {
  out.push(`## ${d.key} 域 —— ${d.introSuffix}（${domainCounts[d.key] ?? 0} 码）`);
  out.push('');
  if (d.intro) { out.push(d.intro); out.push(''); }
  for (const g of d.groups) {
    // 容忍退役的码从活跃表自然落出（已在附录全列，不丢信息）；组内计数跟着重算，
    // 避免"标题写 3、表格只剩 1"的自相矛盾。
    const activeCodes = g.codes.filter((c) => c in ALL);
    if (activeCodes.length === 0) continue;
    out.push(`### ${g.header.replace(/（\d+）/, `（${activeCodes.length}）`)}`);
    out.push('');
    out.push('| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |');
    out.push('|---|---|---|---|---|---|');
    for (const code of activeCodes) out.push(renderRow(code));
    out.push('');
  }
}

out.push(`## 附录 · 退役码（拒写闸名单，历史可读、不再允许写入）`);
out.push('');
out.push(`退役码进拒写闸，共 ${DEPRECATED_AUDIT_ACTIONS.length} 码：`);
out.push('');
for (const code of DEPRECATED_AUDIT_ACTIONS) out.push(`- \`${code}\``);
out.push('');
out.push('> 另有动态迁移码族按形状拒写：`<域>_<从>_TO_<到>`（RETIRED_DYNAMIC_TRANSITION_PATTERN）。');

fs.writeFileSync(OUT, out.join('\n') + '\n');

console.log('分域计数（从常量重算）：');
for (const d of domains) console.log(`  ${d.key}: ${domainCounts[d.key] ?? 0}`);
console.log(`合计 ${total} 码`);
console.log(`已写入 ${OUT}`);
