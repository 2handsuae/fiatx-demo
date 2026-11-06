// A4 table generator. usage (any cwd): node a4-table.js <outMd> <label1>=<raw1.json> [<label2>=<raw2.json> ...]
// Reads raw JSON produced by a4-evidence.js (evidence row + REAL TigerBeetle transfer/accounts), and per transfer code in the
// brief's list (1-21, 30-38, 70, 80-87) picks one sample row, comparing its debit/credit account codes to charter appendix B (波一 column).
const fs = require('fs');
const [, , outMd, ...inputs] = process.argv;
const MN = { 1: 'A.CLIENT_CASH', 50: 'A.FIRM_CASH', 100: 'L.CLIENT_PAYABLE', 101: 'L.DEPOSIT_SUSPENSE', 200: 'E.FIRM_EQUITY',
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
  81: [50, 50, 'Company Settlement', 'Company Operations'], 82: [301, 50], 83: [1, 100],
  84: [200, 50, null, 'Company Operations'], 85: [50, 200, 'Company Liquidity'], 86: [50, 50, 'Company Operations', 'Company Liquidity'], 87: [300, 50, null, 'Company Operations'],
};
// code 80 = 调账单各处置格（附录 B「平账调账单」）
const EXP80 = {
  '100>1': '客户池冲正/冲销/认损·REDUCE：借应付 / 贷客户现金', '1>100': '客户池·INCREASE：借客户现金 / 贷应付',
  '200>50': '公司池更正/冲销·REDUCE：借公司权益 / 贷公司现金', '50>200': '公司池·INCREASE：借公司现金 / 贷公司权益',
  '300>50': '补记银行杂费：借银行与托管费用 / 贷公司现金', '50>212': '补记银行利息 / 核销（托管多出）：借公司现金 / 贷其他收入',
  '301>50': '核销（托管少了）：借对账核销损失 / 贷公司现金', '100>100': '改记·应付对：借应付·错记方 / 贷应付·正主', '1>1': '改记·现金对：借现金·正主 / 贷现金·错记方',
};
// 两段式：锁定码 -> 落账码 / 作废码（post/void 记录在 TigerBeetle 里 code=0，继承 pending；码名只落在 evidence 的事件上）
const POST_OF = { 5: 6, 8: 9, 10: 11, 13: 14 };
const VOID_OF = { 5: 7, 8: 20, 10: 12, 13: 15 };
const CODES = [...Array(21).keys()].map((i) => i + 1).concat([30, 31, 32, 33, 34, 35, 36, 37, 38, 70, 80, 81, 82, 83, 84, 85, 86, 87]);

const short = (d) => (d || '').replace(/^Company Cash · /, 'CoCash·').replace(/^Client Cash · /, 'ClCash·');
const cands = {}; // logical code -> [{set,row,kind}]
const add = (code, set, row, kind) => { (cands[code] = cands[code] || []).push({ set, row, kind }); };
for (const s of sets) for (const r of s.data.rows) {
  if (!r.tb) continue;
  const c = r.tb.code;
  const st = r.stage;
  // direct row: the TB-stored code on the evidence id
  add(c, s.label, r, st && st.found ? (st.flagNames.includes('void_pending') ? 'lock-record, later VOIDED' : st.flagNames.includes('post_pending') ? 'lock-record, later POSTED' : 'lock-record') : (r.tb.flagNames.includes('pending') ? (r.openStage && r.openStage.found ? 'lock-record, later ' + (r.openStage.flagNames.includes('void_pending') ? 'VOIDED (TB)' : 'POSTED (TB)') : 'pending (open)') : 'one-shot posted'));
  // stage rows: logical post / void codes ride on the same evidence record
  if (st && st.found && st.flagNames.includes('post_pending') && POST_OF[c]) add(POST_OF[c], s.label, r, `post stage of code ${c} (post transfer ${r.pendingId.slice(0, 8)}…, flags post_pending, pending_id→evidence id ✓=${st.refsPending})`);
  const os = r.openStage;
  if (os && os.found && os.flagNames.includes('void_pending') && VOID_OF[c]) add(VOID_OF[c], s.label, r, `void stage of code ${c}, found in TigerBeetle (void transfer ${os.id.slice(0, 8)}…, flags void_pending); evidence row still says PENDING — releaseLock uses the best-effort void, which skips the evidence update`);
  if (os && os.found && os.flagNames.includes('post_pending') && POST_OF[c]) add(POST_OF[c], s.label, r, `post stage of code ${c}, found in TigerBeetle (post transfer ${os.id.slice(0, 8)}…); evidence row still PENDING`);
  if (st && st.found && st.flagNames.includes('void_pending') && VOID_OF[c]) add(VOID_OF[c], s.label, r, `void stage of code ${c} (void transfer ${r.pendingId.slice(0, 8)}…, flags void_pending, pending_id→evidence id ✓=${st.refsPending})`);
}
const lines = [];
let nOk = 0, nBad = 0; const missing = []; const bad = [];
const rowsOf = (code) => (cands[code] || []);
for (const code of CODES) {
  const list = rowsOf(code);
  if (!list.length) { missing.push(code); continue; }
  if (code === 80) continue;
  const exp = EXP[code];
  // verify EVERY candidate row for this code, show one sample (prefer a one-shot/direct row, then first)
  let ok = 0, ko = 0;
  for (const x of list) {
    const t = x.row.tb;
    const dOk = t.debitAccCode === exp[0] && t.creditAccCode === exp[1] && x.row.debitCode === MN[exp[0]] && x.row.creditCode === MN[exp[1]];
    if (dOk) ok++; else { ko++; bad.push({ code, row: x.row, set: x.set }); }
  }
  nOk += ok; nBad += ko;
  const pick = list.find((x) => /one-shot|post stage|void stage/.test(x.kind)) || list[0];
  const t = pick.row.tb, r = pick.row;
  const dMn = MN[t.debitAccCode], cMn = MN[t.creditAccCode];
  const match = t.debitAccCode === exp[0] && t.creditAccCode === exp[1] && r.debitCode === dMn && r.creditCode === cMn;
  const roleOk = (!exp[2] || (t.debitDesc || '').includes(exp[2])) && (!exp[3] || (t.creditDesc || '').includes(exp[3]));
  lines.push(`| ${code} | ${pick.set} | \`${r.eventCode}\` | \`${r.tbTransferId}\` | ${pick.kind} | ${r.debitCode} / ${r.creditCode} | ${t.debitAccCode} / ${t.creditAccCode} | ${short(t.debitDesc) || '—'} ⟶ ${short(t.creditDesc) || '—'} | ${MN[exp[0]]} / ${MN[exp[1]]}${exp[2] || exp[3] ? ` (${exp[2] ? 'Dr ' + exp[2] : ''}${exp[2] && exp[3] ? ', ' : ''}${exp[3] ? 'Cr ' + exp[3] : ''})` : ''} | ${match && roleOk ? '✓' : '✗'} | ${ok}/${list.length} |`);
  if (!roleOk) bad.push({ code, row: r, set: pick.set, role: true });
}
// code 80: one sample per distinct (debitAccCode>creditAccCode) cell found
const l80 = rowsOf(80); const cells = {};
for (const x of l80) { const k = `${x.row.tb.debitAccCode}>${x.row.tb.creditAccCode}`; (cells[k] = cells[k] || []).push(x); }
for (const [k, list] of Object.entries(cells)) {
  const x = list[0]; const t = x.row.tb; const r = x.row;
  const ok = !!EXP80[k] && r.debitCode === MN[t.debitAccCode] && r.creditCode === MN[t.creditAccCode];
  if (ok) nOk += list.length; else { nBad += list.length; bad.push({ code: 80, row: r, set: x.set }); }
  lines.push(`| 80 | ${x.set} | \`${r.eventCode}\` | \`${r.tbTransferId}\` | ${x.kind} | ${r.debitCode} / ${r.creditCode} | ${t.debitAccCode} / ${t.creditAccCode} | ${short(t.debitDesc) || '—'} ⟶ ${short(t.creditDesc) || '—'} | ${EXP80[k] || '（不在附录 B 的 80 号格内）'} | ${ok ? '✓' : '✗'} | ${list.length}/${list.length} |`);
}
const out = [];
out.push('| 码 | 取自 | eventCode | 凭证号（evidence.tbTransferId，TB u128 hex） | 记录形态 | evidence 借 / 贷助记码 | TB 实记借 / 贷科目码 | 借方户名 ⟶ 贷方户名 | 附录 B 波一 | 对照 | 该码全部行 ✓/行数 |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|');
out.push(...lines);
const sum = `Checked rows: ${nOk + nBad} (each logical code's every candidate row, not just the sample); match ${nOk}; mismatch ${nBad}. Codes with no row in the supplied DB(s): ${missing.join(', ') || 'none'}.`;
fs.writeFileSync(outMd, out.join('\n') + '\n\n' + sum + '\n');
console.log(sum);
if (bad.length) { console.log('MISMATCHES:'); for (const b of bad) console.log(b.code, b.set, b.row.eventCode, b.row.tbTransferId, b.role ? 'ROLE' : 'PAIR', b.row.tb.debitAccCode, b.row.tb.creditAccCode, b.row.tb.debitDesc, '|', b.row.tb.creditDesc); }
