// T12 Step 3 · T1 open item: a REAL LP application walked through the real HTTP API on the self stack
// (treasury applies -> compliance assesses -> sends for approval -> CFO approves) must open two code-51 accounts (AED + USDT).
const API = 'http://127.0.0.1:3110';
const { execFileSync } = require('child_process');
const DB = '/tmp/exchange_js_wt_campaign_e_wave2_e761d7/dev.db';
const q = (sql) => execFileSync('sqlite3', ['-json', DB, sql]).toString() || '[]';
async function login(email) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: '123456' }) });
  const b = await r.json(); if (!r.ok) throw new Error(`login ${email} ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  return b.access_token;
}
async function call(tok, method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  console.log(method, path, r.status, JSON.stringify(j).slice(0, 220));
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}`);
  return j;
}
(async () => {
  const before = JSON.parse(q("select ownerNo, ledger, code, description from tb_account_registry where ownerType='LP' and code=51 order by ownerNo, ledger"));
  console.log('BEFORE code-51 rows:', before.length, JSON.stringify(before.map((r) => r.ownerNo + '/L' + r.ledger)));
  const tre = await login('treasury@fiatx.com');
  const created = await call(tre, 'POST', '/admin/lp-profiles', {
    name: 'T12 Walk Capital Ltd', registeredIn: 'United Arab Emirates', registrationNo: 'T12-REG-0001', licensingAuthority: 'VARA', licenceNo: 'T12-LIC-0001',
    tradingTypes: ['SPOT_EXCHANGE'], expectedMonthlyVolume: '1000000', volumeCurrency: 'AED', applicationReason: 'T12 wave-2 closing walk: real LP approval opens the due-from-LP accounts',
    agreementRef: 'T12-AGR-0001', contactName: 'T12 Contact', contactEmail: 't12-walk@example.com',
  });
  const lpNo = created.lpNo;
  const co = await login('compliance_lead@fiatx.com');
  await call(co, 'POST', `/admin/lp-profiles/${lpNo}/assessment/screening-records`, { subjectKind: 'COMPANY', subjectName: 'T12 Walk Capital Ltd', listsChecked: ['UN', 'OFAC', 'EU', 'UAE_LOCAL', 'PEP', 'ADVERSE_MEDIA'], result: 'GREEN' });
  await call(co, 'PATCH', `/admin/lp-profiles/${lpNo}/assessment`, { riskTier: 'LOW', opinion: 'T12 walk: all lists green, low risk' });
  const sent = await call(co, 'POST', `/admin/lp-profiles/${lpNo}/assessment/conclude`, { conclusion: 'SENT_FOR_APPROVAL' });
  const cfo = await login('cfo@fiatx.com');
  await call(cfo, 'POST', `/admin/control-gates/approvals/${sent.approvalNo}/approve`, { reason: 'T12 walk: CFO approves the LP application' });
  for (let i = 0; i < 20; i++) {
    const st = JSON.parse(q(`select status from liquidity_providers where lpNo='${lpNo}'`))[0];
    if (st && st.status === 'ACTIVE') { console.log('LP status ACTIVE after', i, 'polls'); break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const after = JSON.parse(q("select ownerNo, ledger, code, description from tb_account_registry where ownerType='LP' and code=51 order by ownerNo, ledger"));
  console.log('AFTER code-51 rows:', after.length, JSON.stringify(after.map((r) => r.ownerNo + '/L' + r.ledger + ' ' + r.description)));
  const mine = after.filter((r) => r.ownerNo === lpNo);
  console.log('NEW LP', lpNo, 'code-51 rows:', mine.length, mine.length === 2 ? 'OK (AED + USDT)' : 'MISMATCH');
  if (mine.length !== 2) process.exit(1);
})().catch((e) => { console.error('WALK FAILED', e.message); process.exit(1); });
