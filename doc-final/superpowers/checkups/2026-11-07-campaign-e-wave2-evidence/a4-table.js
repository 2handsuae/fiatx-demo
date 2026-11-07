// A4 table generator — 戊波二 copy of the 戊波一 tool. usage (any cwd): node a4-table.js <outMd> <label1>=<raw1.json> [<label2>=<raw2.json> ...]
// 戊波二 changes vs the wave-1 tool (everything else byte-identical): MN gains 2 / 51; EXP gains 88-91 and rewrites 85 (credit 51) and 87 (from wallet may be Operations or Fees);
// codes 83 and 90 are judged PER eventCode (83: SHORTFALL_TOPUP_IN Dr1/Cr2, ADVANCE_IN Dr1/Cr100; 90: FEE_INCOME_CLOSE_SWAP/WITHDRAW/OTHER Dr 210/211/212, Cr 200) and sampled once per eventCode;
// role cells may be a RegExp. Expectation source: charter appendix B (波二 column) + spec §3.2.
// Reads raw JSON produced by a4-evidence.js (evidence row + REAL TigerBeetle transfer/accounts). Every candidate row is checked
// against charter appendix B (波一 column) on TWO axes: (1) debit/credit account-code pair (+ evidence mnemonics), (2) wallet role
// (account name) where appendix B names one. Code 80 is checked per row. One sample per code is shown; counts cover every row.
// e2e test-fixture rows (eventCode E2E_* or sourceNo E2E-*) are NOT product postings: they are checked for information and listed in
// their own section, never counted as product matches / mismatches. Exit code 1 when a product row mismatches, a stored code has no
// appendix B expectation (UNEXPECTED), or an evidence row has no TigerBeetle transfer.
const fs = require('fs');
const [, , outMd, ...inputs] = process.argv;
const MN = { 1: 'A.CLIENT_CASH', 2: 'A.CLIENT_SHORTFALL', 50: 'A.FIRM_CASH', 51: 'A.LP_RECEIVABLE', 100: 'L.CLIENT_PAYABLE', 101: 'L.DEPOSIT_SUSPENSE', 200: 'E.FIRM_EQUITY',
  210: 'E.INCOME_SWAP_FEE', 211: 'E.INCOME_WITHDRAW_FEE', 212: 'E.INCOME_OTHER', 300: 'X.EXPENSE_BANK_CUSTODY', 301: 'X.EXPENSE_RECON_LOSS', 302: 'X.EXPENSE_OTHER' };
const sets = inputs.map((s) => { const i = s.indexOf('='); return { label: s.slice(0, i), data: JSON.parse(fs.readFileSync(s.slice(i + 1))) }; });

// 附录 B 波一列：[借方科目码, 贷方科目码, 借方钱包角色(可选), 贷方钱包角色(可选)]
const EXP = {
  1: [1, 101], 2: [101, 100], 3: [101, 1], 4: [50, 212, 'Company Fees'], 5: [101, 1], 6: [101, 1], 7: [101, 1], 8: [101, 1], 9: [101, 1],
  10: [100, 1], 11: [100, 1], 12: [100, 1], 13: [100, 1], 14: [100, 1], 15: [100, 1], 16: [50, 211, 'Company Fees'], 17: [1, 100],
  20: [101, 1], 21: [100, 1],
  30: [100, 1], 31: [50, 200], 32: [50, 50, 'Company Settlement', 'Company Operations'], 33: [200, 50, null, 'Company Settlement'],
  34: [1, 100], 35: [100, 1], 36: [50, 210, 'Company Fees'], 37: [50, 50, 'Company Operations', 'Company Settlement'], 38: [200, 50, null, 'Company Operations'],
  70: [50, 200, 'Company Operations'],
  81: [50, 50, 'Company Settlement', /Company (Operations|Fees)/], // 戊波二：认损补缺单的出钱钱包可选（运营户或手续费户，spec 裁定 3），腿 1 的贷方角色随之放宽
   82: [301, 50], 83: [1, 100],
  84: [200, 50, null, 'Company Operations'], 85: [50, 51, 'Company Liquidity'], 86: [50, 50, 'Company Operations', 'Company Liquidity'], 87: [300, 50, null, /Company (Operations|Fees)/],
  88: [51, 200], 89: [50, 50, /Company (Operations|Fees)/, /Company (Operations|Fees)/], 91: [2, 1],
};
// 戊波二：按 eventCode 分形态的码。83：用途 SHORTFALL_TOPUP（借 1 / 贷 2）与 CLIENT_ADVANCE（借 1 / 贷 100）；90：三笔收入结转，借方码随收入户。
const EXP_BY_EVENT = {
  83: { INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN: [1, 2], INTERNAL_TRANSFER_ADVANCE_IN: [1, 100] },
  90: { FEE_INCOME_CLOSE_SWAP: [210, 200], FEE_INCOME_CLOSE_WITHDRAW: [211, 200], FEE_INCOME_CLOSE_OTHER: [212, 200] },
};
const expFor = (code, row) => (EXP_BY_EVENT[code] ? EXP_BY_EVENT[code][row.eventCode] : EXP[code]);
const roleOK = (desc, want) => !want || (want instanceof RegExp ? want.test(desc || '') : (desc || '').includes(want));
const roleText = (want) => (want instanceof RegExp ? want.source : want);
// code 80 = 调账单各处置格（附录 B「平账调账单」）；附录 B 对 80 不点名钱包角色，所以角色检查对 80 不适用
const EXP80 = {
  '100>1': '客户池冲正/冲销/认损·REDUCE：借应付 / 贷客户现金', '1>100': '客户池·INCREASE：借客户现金 / 贷应付',
  '200>50': '公司池更正/冲销·REDUCE：借公司权益 / 贷公司现金', '50>200': '公司池·INCREASE：借公司现金 / 贷公司权益',
  '300>50': '补记银行杂费：借银行与托管费用 / 贷公司现金', '50>212': '补记银行利息 / 核销（托管多出）：借公司现金 / 贷其他收入',
  '301>50': '核销（托管少了）：借对账核销损失 / 贷公司现金', '100>100': '改记·应付对：借应付·错记方 / 贷应付·正主', '1>1': '改记·现金对：借现金·正主 / 贷现金·错记方',
};
// 两段式：锁定码 -> 落账码 / 作废码。R34：post / void 提交时 code 填 0，TigerBeetle 按 pending 的 code 存，
// 所以 6 / 7 / 9 / 12 / 15 / 20 永远不是「TB 存的转账码」，只能经「锁定行 + 它的阶段转账」验证；码名只落在 evidence 的事件上。
const POST_OF = { 5: 6, 8: 9, 10: 11, 13: 14 };
const VOID_OF = { 5: 7, 8: 20, 10: 12, 13: 15 };
const STAGE_ONLY = new Set([6, 7, 9, 12, 15, 20]);
const CODES = [...Array(21).keys()].map((i) => i + 1).concat([30, 31, 32, 33, 34, 35, 36, 37, 38, 70, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91]);
// e2e 夹具标记：eventCode 为 E2E_*（E2E_FIRM_FIXTURE / E2E_LEDGER_FLAGS）或 sourceNo 以 E2E- 开头
const FIXTURE_RE = /^E2E[-_]/;
const isFixture = (r) => FIXTURE_RE.test(r.eventCode || '') || FIXTURE_RE.test(r.sourceNo || '');

const short = (d) => (d || '').replace(/^Company Cash · /, 'CoCash·').replace(/^Client Cash · /, 'ClCash·');
const roleOf = (d) => { const m = /Company (Fees|Operations|Settlement|Liquidity)/.exec(d || ''); return m ? 'Company ' + m[1] : '—'; };
const hex8 = (s) => (s || '').slice(0, 8) + '…';

// ---- 1. collect candidates: [{code(logical), set, row, kind, via:'stored'|'stage', stageOk, stageNote}] ----
const cands = [];
const noTb = []; // evidence rows with no TigerBeetle transfer
const stageStat = { looked: 0, inherits: 0, zero: 0, other: 0 }; // R34: every post/void transfer found in TB, stored code vs its pending's code
const add = (code, set, row, kind, via, stageOk) => cands.push({ code, set, row, kind, via, stageOk });
for (const s of sets) for (const r of s.data.rows) {
  if (!r.tb) { noTb.push({ set: s.label, r }); continue; }
  const c = r.tb.code;
  const st = r.stage;
  const os = r.openStage;
  for (const sg of [st, os]) if (sg && sg.found) { stageStat.looked++; if (sg.code === c) stageStat.inherits++; else if (sg.code === 0) stageStat.zero++; else stageStat.other++; }
  // direct row: the TB-stored code on the evidence id
  add(c, s.label, r, st && st.found ? (st.flagNames.includes('void_pending') ? 'lock-record, later VOIDED' : st.flagNames.includes('post_pending') ? 'lock-record, later POSTED' : 'lock-record') : (r.tb.flagNames.includes('pending') ? (os && os.found ? 'lock-record, later ' + (os.flagNames.includes('void_pending') ? 'VOIDED (TB)' : 'POSTED (TB)') : 'pending (open)') : 'one-shot posted'), 'stored', true);
  // stage rows: logical post / void codes ride on the same evidence record; the stage transfer itself must be a post/void whose stored code = the pending's code
  const stageAdd = (code, sg, flag, text, withRef) => {
    const ok = sg.flagNames.includes(flag) && sg.code === c && (!withRef || sg.refsPending === true);
    add(code, s.label, r, `${text}; stored code ${sg.code}${sg.code === c ? ' = pending\'s' : ' ≠ pending\'s ' + c}`, 'stage', ok);
  };
  if (st && st.found && st.flagNames.includes('post_pending') && POST_OF[c]) stageAdd(POST_OF[c], st, 'post_pending', `post stage of code ${c} (post transfer ${hex8(r.pendingId)}, flags post_pending, pending_id→evidence id ✓=${st.refsPending})`, true);
  if (os && os.found && os.flagNames.includes('void_pending') && VOID_OF[c]) stageAdd(VOID_OF[c], os, 'void_pending', `void stage of code ${c}, found in TigerBeetle (void transfer ${hex8(os.id)}, flags void_pending); evidence row still says PENDING — releaseLock uses the best-effort void, which skips the evidence update`, false);
  if (os && os.found && os.flagNames.includes('post_pending') && POST_OF[c]) stageAdd(POST_OF[c], os, 'post_pending', `post stage of code ${c}, found in TigerBeetle (post transfer ${hex8(os.id)}); evidence row still PENDING`, false);
  if (st && st.found && st.flagNames.includes('void_pending') && VOID_OF[c]) stageAdd(VOID_OF[c], st, 'void_pending', `void stage of code ${c} (void transfer ${hex8(r.pendingId)}, flags void_pending, pending_id→evidence id ✓=${st.refsPending})`, true);
}

// ---- 2. judge every candidate on both axes (never throws on an unknown code) ----
function judge(x) {
  const t = x.row.tb, r = x.row;
  if (x.code === 80) {
    const k = `${t.debitAccCode}>${t.creditAccCode}`;
    const pair = !!EXP80[k] && r.debitCode === MN[t.debitAccCode] && r.creditCode === MN[t.creditAccCode];
    return { pair, role: true, roleNA: true, stage: x.stageOk, ok: pair && x.stageOk, cell: k };
  }
  const exp = expFor(x.code, r);
  if (!exp) return { unexpected: EXP_BY_EVENT[x.code] ? `stored code ${x.code} with eventCode ${r.eventCode} has no appendix B expectation` : `stored code ${x.code} has no appendix B expectation` };
  if (x.via === 'stored' && STAGE_ONLY.has(x.code)) return { unexpected: `stored code ${x.code} is a post/void stage code (R34: never stored; TB keeps the pending's code)` };
  const pair = t.debitAccCode === exp[0] && t.creditAccCode === exp[1] && r.debitCode === MN[exp[0]] && r.creditCode === MN[exp[1]];
  const role = roleOK(t.debitDesc, exp[2]) && roleOK(t.creditDesc, exp[3]);
  return { pair, role, roleNA: !exp[2] && !exp[3], stage: x.stageOk, ok: pair && role && x.stageOk, exp };
}
for (const x of cands) { x.fixture = isFixture(x.row); x.j = judge(x); }
const product = cands.filter((x) => !x.fixture);
const fixture = cands.filter((x) => x.fixture);
const prodUnexpected = product.filter((x) => x.j.unexpected);
const prodJudged = product.filter((x) => !x.j.unexpected);
const bad = prodJudged.filter((x) => !x.j.ok);
const distinctRows = (list) => new Set(list.map((x) => x.set + '|' + x.row.tbTransferId)).size;

// ---- 3. product sample table: one sample per code (code 80: one per distinct debit>credit cell) ----
const lines = [];
const missing = [];
const listOf = (code) => prodJudged.filter((x) => x.code === code);
const markCell = (okFlag, na) => (na ? '—' : okFlag ? '✓' : '✗');
const emit = (code, list, pick, appendixText) => {
  const r = pick.row, t = r.tb, j = pick.j;
  const allOk = list.filter((x) => x.j.ok).length;
  lines.push(`| ${code} | ${pick.set} | \`${r.eventCode}\` | \`${r.tbTransferId}\` | ${pick.kind} | ${r.debitCode} / ${r.creditCode} | ${t.debitAccCode} / ${t.creditAccCode} | ${short(t.debitDesc) || '—'} ⟶ ${short(t.creditDesc) || '—'} | ${appendixText} | ${markCell(j.pair)} | ${markCell(j.role, j.roleNA)} | ${allOk}/${list.length} |`);
};
for (const code of CODES) {
  const list = listOf(code);
  if (!list.length) { missing.push(code); continue; }
  if (code === 80) {
    const cells = {};
    for (const x of list) (cells[x.j.cell] = cells[x.j.cell] || []).push(x);
    for (const [k, cl] of Object.entries(cells)) emit(80, cl, cl[0], EXP80[k] || '（不在附录 B 的 80 号格内）');
    continue;
  }
  if (EXP_BY_EVENT[code]) {
    // one sample per eventCode shape; every row of every shape is still judged above
    const shapes = {};
    for (const x of list) (shapes[x.row.eventCode] = shapes[x.row.eventCode] || []).push(x);
    for (const [ev, sl] of Object.entries(shapes)) {
      const e = EXP_BY_EVENT[code][ev];
      emit(code, sl, sl[0], e ? `${MN[e[0]]} / ${MN[e[1]]} (${ev})` : `（无期望：${ev}）`);
    }
    continue;
  }
  const exp = EXP[code];
  // prefer a one-shot / stage row as the sample, then the first
  const pick = list.find((x) => /one-shot|post stage|void stage/.test(x.kind)) || list[0];
  emit(code, list, pick, `${MN[exp[0]]} / ${MN[exp[1]]}${exp[2] || exp[3] ? ` (${exp[2] ? 'Dr ' + roleText(exp[2]) : ''}${exp[2] && exp[3] ? ', ' : ''}${exp[3] ? 'Cr ' + roleText(exp[3]) : ''})` : ''}`);
}
const out = [];
out.push('| 码 | 取自 | eventCode | 凭证号（evidence.tbTransferId，TB u128 hex） | 记录形态 | evidence 借 / 贷助记码 | TB 实记借 / 贷科目码 | 借方户名 ⟶ 贷方户名 | 附录 B 期望（波一 / 波二列） | 借贷对 | 钱包角色 | 该码全部产品行 ✓/行数 |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
out.push(...lines);

const nPair = prodJudged.filter((x) => x.j.pair).length;
const roleApplicable = prodJudged.filter((x) => !x.j.roleNA);
const nRole = roleApplicable.filter((x) => x.j.role).length;
const stageCands = prodJudged.filter((x) => x.via === 'stage');
const nStage = stageCands.filter((x) => x.j.stage).length;
const sumLines = [];
sumLines.push(`Evidence rows: ${distinctRows(cands) + noTb.length} (${sets.map((s) => `${s.label} ${s.data.rows.length}`).join(' + ')}) = product ${distinctRows(product)} + fixture ${distinctRows(fixture)} + no-TigerBeetle-transfer ${noTb.length}.`);
sumLines.push(`Product comparisons: ${prodJudged.length} (every candidate row of every code, not just the sample; a two-phase lock row also counts once under its post / void stage code); borrow-lend pair ✓ ${nPair}/${prodJudged.length}; wallet role ✓ ${nRole}/${roleApplicable.length} (appendix B names a role; ${prodJudged.length - roleApplicable.length} comparisons name none, incl. all of code 80); stage-transfer record ✓ ${nStage}/${stageCands.length}; match ${prodJudged.length - bad.length}; mismatch ${bad.length}; UNEXPECTED ${prodUnexpected.length}.`);
sumLines.push(`Codes with no product row in the supplied DB(s): ${missing.join(', ') || 'none'}.`);
sumLines.push(`Stage transfers found in TigerBeetle (post / void): ${stageStat.looked}; stored code = their pending's code: ${stageStat.inherits}; stored code 0: ${stageStat.zero}; other: ${stageStat.other}.`);
out.push('', sumLines.join('\n\n'));

// ---- 4. fixture section ----
out.push('', '### 夹具行（e2e fixture，不是产品落账；不计入上表的符合 / 不符）', '');
out.push(`判定标记：\`eventCode\` 为 \`E2E_*\`，或 \`sourceNo\` 以 \`E2E-\` 开头（原始行里实际出现的就是这两种）。这些行由 e2e 用例直接调记账服务造出来（给客户 / 公司钱包预充值），不是产品流程的落账；下面照样跑同两项检查，仅供参考。其中 \`E2E_FIRM_FIXTURE\` 用码 70 给 \`Company Fees\` 钱包预充值（\`test/recon-aging-write-off\`、\`recon-reattribution\`、\`recon-adjustment-money-arcs\` 三支 e2e），借方因此是 Fees 而不是产品注资（\`CAPITAL_INJECTION\`）的 Operations——这是夹具与产品落账的差别，不是产品账错。`);
out.push('');
if (!fixture.length) out.push('本次喂入的库里没有夹具行。');
else {
  const groups = new Map();
  for (const x of fixture) {
    const t = x.row.tb;
    const sig = x.j.unexpected ? 'UNEXPECTED' : `${x.j.pair ? 1 : 0}${x.j.role ? 1 : 0}${x.j.stage ? 1 : 0}`;
    const key = [x.set, x.code, x.row.eventCode, roleOf(t.debitDesc), roleOf(t.creditDesc), t.debitAccCode, t.creditAccCode, sig].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  out.push('| 取自 | 码 | eventCode | 行数 | sourceNo | TB 借 / 贷科目码 | 借 / 贷方钱包角色 | 借贷对 | 钱包角色 | 若当产品行会怎样 |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const gl of groups.values()) {
    const x = gl[0], t = x.row.tb, j = x.j;
    const nos = gl.map((g) => g.row.sourceNo);
    const noText = nos.length <= 4 ? nos.map((n) => `\`${n}\``).join('<br>') : nos.slice(0, 2).map((n) => `\`${n}\``).join('<br>') + `<br>…（共 ${nos.length} 条）`;
    const verdict = j.unexpected ? `UNEXPECTED：${j.unexpected}` : j.ok ? '符合' : `不符（${!j.pair ? '借贷对 ' : ''}${!j.role ? '角色：附录 B 要求 ' + [j.exp[2] && 'Dr ' + roleText(j.exp[2]), j.exp[3] && 'Cr ' + roleText(j.exp[3])].filter(Boolean).join(', ') : ''}${!j.stage ? '阶段记录 ' : ''}）`;
    out.push(`| ${x.set} | ${x.code} | \`${x.row.eventCode}\` | ${gl.length} | ${noText} | ${t.debitAccCode} / ${t.creditAccCode} | ${roleOf(t.debitDesc)} / ${roleOf(t.creditDesc)} | ${j.unexpected ? '—' : markCell(j.pair)} | ${j.unexpected ? '—' : markCell(j.role, j.roleNA)} | ${verdict} |`);
  }
  out.push('', `夹具行共 ${distinctRows(fixture)} 条（比对 ${fixture.length} 次）。`);
}

// ---- 5. no-TB rows and UNEXPECTED codes (explicit even when empty) ----
out.push('', '### 没有 TigerBeetle 转账的 evidence 行', '');
if (!noTb.length) out.push('0 行（预期 0）。');
else {
  out.push(`${noTb.length} 行（预期 0）：`, '');
  for (const n of noTb) out.push(`- ${n.set} \`${n.r.eventCode}\` ${n.r.sourceType} ${n.r.sourceNo} \`${n.r.tbTransferId}\``);
}
out.push('', '### 无附录 B 期望的转账码（UNEXPECTED）', '');
const allUnexpected = cands.filter((x) => x.j.unexpected);
if (!allUnexpected.length) out.push('0 行（预期 0）。TB 里存的转账码全部落在附录 B 有期望的集合内，且没有任何阶段码（6 / 7 / 9 / 12 / 15 / 20）作为存储码出现。');
else {
  out.push(`${allUnexpected.length} 行（产品行 ${prodUnexpected.length}，夹具行 ${allUnexpected.length - prodUnexpected.length}）：`, '');
  for (const x of allUnexpected) out.push(`- ${x.fixture ? '[fixture] ' : ''}${x.set} 码 ${x.code} \`${x.row.eventCode}\` ${x.row.sourceNo} \`${x.row.tbTransferId}\`：${x.j.unexpected}`);
}
fs.writeFileSync(outMd, out.join('\n') + '\n');
console.log(sumLines.join('\n'));
console.log(`fixture rows ${distinctRows(fixture)} (not counted); no-TB rows ${noTb.length}; UNEXPECTED product ${prodUnexpected.length} / fixture ${allUnexpected.length - prodUnexpected.length}`);
if (bad.length || prodUnexpected.length || noTb.length) {
  console.log('PROBLEMS:');
  for (const b of bad) console.log('MISMATCH', b.code, b.set, b.row.eventCode, b.row.sourceNo, b.row.tbTransferId, b.j.pair ? '' : 'PAIR', b.j.role ? '' : 'ROLE', b.j.stage ? '' : 'STAGE', b.row.tb.debitAccCode, b.row.tb.creditAccCode, b.row.tb.debitDesc, '|', b.row.tb.creditDesc);
  for (const u of prodUnexpected) console.log('UNEXPECTED', u.code, u.set, u.row.eventCode, u.row.sourceNo, u.row.tbTransferId, u.j.unexpected);
  for (const n of noTb) console.log('NO-TB', n.set, n.r.eventCode, n.r.sourceNo, n.r.tbTransferId);
  process.exitCode = 1;
}
