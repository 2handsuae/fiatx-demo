/**
 * demo:all 花名册 —— 29 笔单覆盖 21 种终态/活态。
 *
 * 原则：剧本演到的状态必须有现成样本，剧本没演到的不造。不按状态机穷举
 * （兑换的 FAILED/REVERSED 是不可达死枚举，不进册）。
 *
 * 固定不随机：金额、笔数、目标状态全部写死。唯一会变的是单号（内嵌日期），
 * 所以答案键运行时打印，不写死在文件里。随机金额会自己穿仓，也会让
 * demo/data.md 的自动生成分不清「漂移」与「噪音」。
 */
export type RosterDomain = 'DEPOSIT' | 'SWAP' | 'WITHDRAW';

export interface RosterEntry {
  seq: number;
  domain: RosterDomain;
  label: string;
  expectedStatus: string;
  customerEmail: string;
  amount: string;
  currency: string;
  /** 怎么把单驱到目标态；⚡N = 模拟面板第 N 个按钮 */
  driver: string;
}

const ALICE = 'demo_alice@example.com';
const BOB = 'demo_bob@example.com';
const GRACE = 'demo_grace@example.com';
const JACK = 'demo_jack@example.com';
const KATE = 'demo_kate@example.com';
// FRANK plays the "永久冻结" persona for every row whose driver opens a
// customer-level restriction (SANCTION: customerLevel=true, defaultScopes=
// ['ALL'] — src/modules/identity/customers/constants/restriction-cause.
// constant.ts) — #7/#10 (DEPOSIT FROZEN→SEIZED) and #13 (SWAP FROZEN).
// Nothing in this codebase releases a customer-level restriction
// (deposit/withdraw/swap workflows only listen for CUSTOMER_RESTRICTION_
// OPENED, never a "released" counterpart), so whoever plays this role can
// never trade again for the rest of the run. That is incompatible with
// alice/bob/grace, who MUST stay tradeable through swap+withdraw later in the
// same pipeline (scripts/demo-lib.ts WITHDRAW_PLAN + resolveDemoCustomers's
// tradeable-or-throw check) — so this persona is kept structurally apart: see
// FROZEN_PERSONA_EMAIL/resolveFrozenPersona in scripts/demo-lib.ts.
//
// #13 needs a real in-flight COMPLIANCE_PENDING swap order to exist BEFORE #7
// opens the restriction — initiateSwap rejects a restricted customer outright
// (CAPABILITY_RESTRICTED) and separately requires sell-side balance up front
// (INSUFFICIENT_BALANCE), and FRANK has no other roster row that ever credits
// him before #7/#10 permanently sanction/seize him. Row #21 below (a plain
// SUCCESS AED deposit) funds him, and scripts/demo-lib.ts's runFrankPreStage()
// creates #13's order — both ahead of the normal deposit stage, i.e. ahead of
// #7 — so #7's CUSTOMER_RESTRICTION_OPENED broadcast is what actually freezes
// #13 (SwapWorkflowService.onCustomerRestrictionOpened sweeps his in-flight
// COMPLIANCE_PENDING swaps). See runFrankPreStage's header comment for the
// full mechanism and task-C3c-report.md (earlier dead ends: task-C3-report.md
// / task-C3b-report.md). (#19 WITHDRAW FROZEN is GRACE, not FRANK — ⚡⑨
// V9_REJECTED_MLRO_FREEZE freezes only the one order, no customer-level
// restriction, so it doesn't need this persona — see runWithdraws below.)
const FRANK = 'demo_frank@example.com';

export const DEMO_ROSTER: RosterEntry[] = [
  { seq: 1,  domain: 'DEPOSIT',  label: '充值 · 正常入账 USDT',      expectedStatus: 'SUCCESS',           customerEmail: ALICE, amount: '3000',   currency: 'USDT', driver: '⚡①' },
  { seq: 2,  domain: 'DEPOSIT',  label: '充值 · 正常入账 AED',       expectedStatus: 'SUCCESS',           customerEmail: BOB,   amount: '8000',   currency: 'AED',  driver: '⚡①' },
  { seq: 3,  domain: 'DEPOSIT',  label: '充值 · 正常入账 AED（二）',  expectedStatus: 'SUCCESS',           customerEmail: GRACE, amount: '6500',   currency: 'AED',  driver: '⚡①' },
  { seq: 4,  domain: 'DEPOSIT',  label: '充值 · 等客户补料',         expectedStatus: 'ACTION_PENDING',    customerEmail: ALICE, amount: '4200',   currency: 'AED',  driver: '⚡②' },
  { seq: 5,  domain: 'DEPOSIT',  label: '充值 · 转人工复核',         expectedStatus: 'MANUAL_CHECKING',   customerEmail: BOB,   amount: '5100',   currency: 'AED',  driver: '⚡⑪' },
  { seq: 6,  domain: 'DEPOSIT',  label: '充值 · 小额挂起',           expectedStatus: 'OPERATION_PENDING', customerEmail: GRACE, amount: '35',     currency: 'AED',  driver: '低于下限' },
  { seq: 7,  domain: 'DEPOSIT',  label: '充值 · 制裁冻结',           expectedStatus: 'FROZEN',            customerEmail: FRANK, amount: '7300',   currency: 'AED',  driver: '⚡⑦' },
  { seq: 8,  domain: 'DEPOSIT',  label: '充值 · 没收（钱进公司）',    expectedStatus: 'CONFISCATED',       customerEmail: GRACE, amount: '42',     currency: 'AED',  driver: '低于下限 → 没收 → MLRO 批' },
  { seq: 9,  domain: 'DEPOSIT',  label: '充值 · 退回原发款方',       expectedStatus: 'RETURNED',          customerEmail: ALICE, amount: '2600',   currency: 'AED',  driver: '⚡⑪ → 退回 → MLRO 批' },
  { seq: 10, domain: 'DEPOSIT',  label: '充值 · 上缴（政府移交）',    expectedStatus: 'SEIZED',            customerEmail: FRANK, amount: '9100',   currency: 'AED',  driver: '⚡⑦ → 上缴 → MLRO 批' },

  { seq: 11, domain: 'SWAP',     label: '兑换 · USDT→AED 成功',      expectedStatus: 'SUCCESS',           customerEmail: ALICE, amount: '1000',   currency: 'USDT', driver: '⚡①' },
  { seq: 12, domain: 'SWAP',     label: '兑换 · AED→USDT 成功',      expectedStatus: 'SUCCESS',           customerEmail: BOB,   amount: '2900',   currency: 'AED',  driver: '⚡①' },
  { seq: 13, domain: 'SWAP',     label: '兑换 · 制裁冻结（零出边）',  expectedStatus: 'FROZEN',            customerEmail: FRANK, amount: '600',    currency: 'AED',  driver: '连坐冻结（#7 制裁广播）' },

  { seq: 14, domain: 'WITHDRAW', label: '提现 · 法币成功',           expectedStatus: 'SUCCESS',           customerEmail: ALICE, amount: '1200',   currency: 'AED',  driver: '⚡①' },
  { seq: 15, domain: 'WITHDRAW', label: '提现 · 虚拟币成功',         expectedStatus: 'SUCCESS',           customerEmail: BOB,   amount: '150',    currency: 'USDT', driver: '⚡①' },
  { seq: 16, domain: 'WITHDRAW', label: '提现 · 法币成功（二）',     expectedStatus: 'SUCCESS',           customerEmail: GRACE, amount: '900',    currency: 'AED',  driver: '⚡①' },
  { seq: 17, domain: 'WITHDRAW', label: '提现 · 等客户补料',         expectedStatus: 'ACTION_PENDING',    customerEmail: ALICE, amount: '1800',   currency: 'AED',  driver: '⚡②' },
  { seq: 18, domain: 'WITHDRAW', label: '提现 · 大额待审批',         expectedStatus: 'PENDING_APPROVAL',  customerEmail: BOB,   amount: '250000', currency: 'AED',  driver: '超大额闸' },
  { seq: 19, domain: 'WITHDRAW', label: '提现 · MLRO 冻结',          expectedStatus: 'FROZEN',            customerEmail: GRACE, amount: '1500',   currency: 'AED',  driver: '⚡⑨' },
  { seq: 20, domain: 'WITHDRAW', label: '提现 · 卡在半路（对账用）',  expectedStatus: 'PAYOUT_PENDING',    customerEmail: ALICE, amount: '500',    currency: 'AED',  driver: 'demo:in-transit' },

  // #21 seq 排在最后，但执行顺序排在最前——不是第 4 条处置弧，是 #13 的前置
  // 本金。domain 仍是 DEPOSIT（就是一笔普通充值），但不归 runDeposits 主循环
  // 处理：runFrankPreStage()（scripts/demo-lib.ts）在 ensureSetup 之后、
  // runDeposits 之前就把它驱到 SUCCESS，好让 FRANK 在 #7 制裁他之前，既有
  // 余额、又还没被限制——见 FRANK 常量块上方注释。
  { seq: 21, domain: 'DEPOSIT',  label: '充值 · FRANK 本金（供 #13 建单垫资）', expectedStatus: 'SUCCESS', customerEmail: FRANK, amount: '2000', currency: 'AED', driver: '⚡①（跑在充值阶段之前，见 runFrankPreStage）' },

  // ── 对账素材单（seq 22-29）─────────────────────────────────────────────
  // 花名册的原则是「剧本演到的状态必须有现成样本」——那是**覆盖下限**，不是
  // "每种状态只能一条"。下面这几行不为新终态而生，是为对账破口场景供料：
  // 场景要删/改/挪外部对账单行，钱包上就得先有行。
  // ⚠️ 一律不加提现：提现会留下手续费腿，没走到终态就让那个钱包带上非终态
  // 资金单，在途识别会去认领它、把场景的期望桶打乱（cfec505f 修的就是这个坑）。
  { seq: 22, domain: 'DEPOSIT', label: '充值 · 素材（Grace USDT）',   expectedStatus: 'SUCCESS', customerEmail: GRACE, amount: '1200', currency: 'USDT', driver: '⚡①' },
  { seq: 23, domain: 'SWAP',    label: '兑换 · 素材（Grace AED→USDT）', expectedStatus: 'SUCCESS', customerEmail: GRACE, amount: '800',  currency: 'AED',  driver: '⚡①' },
  { seq: 24, domain: 'DEPOSIT', label: '充值 · 素材（Jack AED 大额）',  expectedStatus: 'SUCCESS', customerEmail: JACK,  amount: '5000', currency: 'AED',  driver: '⚡①' },
  { seq: 25, domain: 'DEPOSIT', label: '充值 · 素材（Jack AED 小额）',  expectedStatus: 'SUCCESS', customerEmail: JACK,  amount: '1500', currency: 'AED',  driver: '⚡①' },
  { seq: 26, domain: 'DEPOSIT', label: '充值 · 素材（Jack USDT）',     expectedStatus: 'SUCCESS', customerEmail: JACK,  amount: '400',  currency: 'USDT', driver: '⚡①' },
  { seq: 27, domain: 'DEPOSIT', label: '充值 · 素材（Kate AED 大额）',  expectedStatus: 'SUCCESS', customerEmail: KATE,  amount: '4000', currency: 'AED',  driver: '⚡①' },
  { seq: 28, domain: 'DEPOSIT', label: '充值 · 素材（Kate AED 小额）',  expectedStatus: 'SUCCESS', customerEmail: KATE,  amount: '1200', currency: 'AED',  driver: '⚡①' },
  { seq: 29, domain: 'DEPOSIT', label: '充值 · 素材（Kate USDT）',     expectedStatus: 'SUCCESS', customerEmail: KATE,  amount: '350',  currency: 'USDT', driver: '⚡①' },
];

export function printAnswerKey(
  actual: Array<{ seq: number; orderNo: string; status: string }>,
): { pass: boolean; lines: string[] } {
  const bySeq = new Map(actual.map((a) => [a.seq, a]));
  const lines: string[] = [];
  let bad = 0;

  for (const domain of ['DEPOSIT', 'SWAP', 'WITHDRAW'] as const) {
    const rows = DEMO_ROSTER.filter((r) => r.domain === domain);
    lines.push(`\n── ${domain}（${rows.length} 笔）`);
    for (const r of rows) {
      const a = bySeq.get(r.seq);
      const ok = a?.status === r.expectedStatus;
      if (!ok) bad += 1;
      lines.push(
        `  ${ok ? '✓' : '✗'} #${String(r.seq).padStart(2)} ${r.label.padEnd(24)} ` +
        `${(a?.orderNo ?? '—').padEnd(16)} 预期 ${r.expectedStatus}` +
        (ok ? '' : ` ｜ 实到 ${a?.status ?? '（没造出来）'}`),
      );
    }
  }
  lines.push(`\n花名册：${DEMO_ROSTER.length - bad}/${DEMO_ROSTER.length} 符合预期`);
  return { pass: bad === 0, lines };
}
