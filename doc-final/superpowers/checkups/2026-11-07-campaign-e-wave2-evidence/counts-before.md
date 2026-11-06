# 计数基线（改前）— 戊波二 T0，代码头 `0c6eb7b0`

T12 用**同一批命令**重跑，逐项与本表对照。所有命令在 worktree 根跑，前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；每条命令的退出码都是 0。

> 说明（裁定 R7）：任务书里「spec §1 末尾两条 node 一行命令」并不存在，下面五条是 T0 自己写的、可复现的取数命令。能 import 真常量的都 import 真常量（`ts-node` transpile-only + `tsconfig-paths`）；`verify-rbac.ts` 里的 `MAKER_*` 是**函数内局部常量**、无法 import，改用 TypeScript AST 数对象字面量属性（比正则稳）。

## 汇总（测得 vs 预期）

| 项 | 命令 | 测得 | 预期 | 一致 |
|---|---|---|---|---|
| 审批策略 `DEFAULT_APPROVAL_POLICIES` | C1 | **55** | 55 | 是 |
| `MAKER_GROUP_BY_POLICY` 条目 | C2 | **54** | 54 | 是 |
| `MAKER_GROUP_EXEMPT` 豁免 | C2 | **1** | 1 | 是 |
| 两表并集 = 策略全集 | C2 | **55，双向差集为空** | 55 | 是 |
| （附）`MAKER_CHECKER_OVERLAP_EXEMPT` / `S5_KNOWN_DEADLOCKS` | C2 | 7 / 0 | — | 仅记录 |
| S9 表 `DETAIL_READ_GROUP_BY_POLICY` 行数 | C3 | **45** | 45 | 是 |
| 管理台回链路由表 `ENTITY_ROUTE_BY_ACTION` 行数 | C3 | **45**（与 S9 键集双向差集为空，且 ⊆ 策略全集） | 45 | 是 |
| 审计码（`audit-vocabulary-closure.spec.ts` 的 `REGISTRIES` 十八册） | C4 | **378**（18 册，去重后仍 378） | 378 / 18 | 是 |
| TB 科目码 `TB_ACCOUNT_CODES` | C5 | **11** | 11 | 是 |
| TB 转账码 `TB_TRANSFER_CODES` 最大值 | C5 | **87**（共 37 个码，值互异，最小 1） | 87 | 是 |
| 账本科目（户）数，`verify:coa`（demo:all 之后、recon:demo 之前） | C6 | **87**（「87 个科目全部 ≥ 0」） | 87 | 是 |

**没有任何一项与预期不同。**

## C1 审批策略总数

```bash
node - <<'JS'
require('ts-node').register({ transpileOnly: true });
require('tsconfig-paths/register');
const { DEFAULT_APPROVAL_POLICIES } = require('./src/modules/governance/approvals/constants/approval.constants');
console.log('DEFAULT_APPROVAL_POLICIES', Object.keys(DEFAULT_APPROVAL_POLICIES).length);
JS
```
```
DEFAULT_APPROVAL_POLICIES 55
```

## C2 MAKER 三表 + 与策略全集对账

```bash
# verify-rbac.ts 里 MAKER_* 是函数内局部常量（无法 import），用 TypeScript AST 数对象字面量的属性，再与 DEFAULT_APPROVAL_POLICIES 键集对账
node - <<'JS'
require('ts-node').register({ transpileOnly: true });
require('tsconfig-paths/register');
const ts = require('typescript'), fs = require('fs');
const { DEFAULT_APPROVAL_POLICIES } = require('./src/modules/governance/approvals/constants/approval.constants');
const f = 'scripts/verify-rbac.ts';
const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
const want = ['MAKER_GROUP_BY_POLICY', 'MAKER_GROUP_EXEMPT', 'MAKER_CHECKER_OVERLAP_EXEMPT', 'S5_KNOWN_DEADLOCKS'];
const keys = {};
(function v(n) {
  if (ts.isVariableDeclaration(n) && want.includes(n.name.getText()) && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
    keys[n.name.getText()] = n.initializer.properties.map((p) => p.name.getText().replace(/^["']|["']$/g, ''));
  }
  ts.forEachChild(n, v);
})(sf);
for (const k of want) console.log(k, keys[k].length);
const policies = Object.keys(DEFAULT_APPROVAL_POLICIES);
const union = new Set([...keys.MAKER_GROUP_BY_POLICY, ...keys.MAKER_GROUP_EXEMPT]);
console.log('DEFAULT_APPROVAL_POLICIES', policies.length);
console.log('MAKER_GROUP_BY_POLICY + MAKER_GROUP_EXEMPT =', keys.MAKER_GROUP_BY_POLICY.length + keys.MAKER_GROUP_EXEMPT.length, '(union size ' + union.size + ')');
console.log('policies not covered by the two tables:', JSON.stringify(policies.filter((p) => !union.has(p))));
console.log('table keys not in policies:', JSON.stringify([...union].filter((k) => !policies.includes(k))));
JS
```
```
MAKER_GROUP_BY_POLICY 54
MAKER_GROUP_EXEMPT 1
MAKER_CHECKER_OVERLAP_EXEMPT 7
S5_KNOWN_DEADLOCKS 0
DEFAULT_APPROVAL_POLICIES 55
MAKER_GROUP_BY_POLICY + MAKER_GROUP_EXEMPT = 55 (union size 55)
policies not covered by the two tables: []
table keys not in policies: []
```

## C3 S9 表与管理台回链路由表

```bash
# S9 表（verify-rbac.tables.ts）与管理台回链路由表（admin-web approvalEntityRoutes.ts）：取真常量的键集。
# admin-web 是 "type":"module" 包，ts-node 的 require 会报 ERR_REQUIRE_ESM，故该文件用 ts.transpileModule 转 CJS 后求值（该文件无任何 import）。
node - <<'JS'
require('ts-node').register({ transpileOnly: true });
require('tsconfig-paths/register');
const ts = require('typescript'), fs = require('fs');
const { DEFAULT_APPROVAL_POLICIES } = require('./src/modules/governance/approvals/constants/approval.constants');
const { DETAIL_READ_GROUP_BY_POLICY } = require('./scripts/verify-rbac.tables');
const code = ts.transpileModule(fs.readFileSync('admin-web/src/pages/approvalEntityRoutes.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', code)(m, m.exports);
const { ENTITY_ROUTE_BY_ACTION } = m.exports;
const s9 = Object.keys(DETAIL_READ_GROUP_BY_POLICY), rt = Object.keys(ENTITY_ROUTE_BY_ACTION), pol = Object.keys(DEFAULT_APPROVAL_POLICIES);
console.log('S9 DETAIL_READ_GROUP_BY_POLICY', s9.length);
console.log('ENTITY_ROUTE_BY_ACTION', rt.length);
console.log('S9 keys not in routes:', JSON.stringify(s9.filter((k) => !rt.includes(k))));
console.log('route keys not in S9:', JSON.stringify(rt.filter((k) => !s9.includes(k))));
console.log('S9 keys not in policies:', JSON.stringify(s9.filter((k) => !pol.includes(k))));
JS
```
```
S9 DETAIL_READ_GROUP_BY_POLICY 45
ENTITY_ROUTE_BY_ACTION 45
S9 keys not in routes: []
route keys not in S9: []
S9 keys not in policies: []
```

## C4 审计码（按 spec 自己枚举名册的口径）

```bash
# 按 audit-vocabulary-closure.spec.ts 自己的口径枚举名册：用 AST 取该 spec 里 REGISTRIES 对象字面量的成员名，再对真常量数键；
# 另以「audit-actions.constant 里所有 *_AUDIT_ACTIONS 导出（去掉 DEPRECATED_AUDIT_ACTIONS）」交叉核对名册集合
node - <<'JS'
require('ts-node').register({ transpileOnly: true });
require('tsconfig-paths/register');
const ts = require('typescript'), fs = require('fs');
const mod = require('./src/modules/audit-logging/constants/audit-actions.constant');
const f = 'src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts';
const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
let names = null;
(function v(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText() === 'REGISTRIES' && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
    names = n.initializer.properties.map((p) => p.name.getText());
  }
  ts.forEachChild(n, v);
})(sf);
const per = names.map((nm) => [nm, Object.keys(mod[nm]).length]);
const all = names.flatMap((nm) => Object.keys(mod[nm]));
console.log('rosters in spec REGISTRIES:', names.length);
console.log('total codes (sum of keys):', all.length, '| distinct:', new Set(all).size);
console.log('per roster:', per.map(([n, c]) => n + '=' + c).join(' '));
const exported = Object.keys(mod).filter((k) => /_AUDIT_ACTIONS$/.test(k) && k !== 'DEPRECATED_AUDIT_ACTIONS');
console.log('exports named *_AUDIT_ACTIONS (excl. DEPRECATED):', exported.length);
console.log('exported but not in spec REGISTRIES:', JSON.stringify(exported.filter((k) => !names.includes(k))));
console.log('in spec REGISTRIES but not exported:', JSON.stringify(names.filter((k) => !exported.includes(k))));
console.log('DEPRECATED_AUDIT_ACTIONS length:', mod.DEPRECATED_AUDIT_ACTIONS.length);
JS
```
```
rosters in spec REGISTRIES: 18
total codes (sum of keys): 378 | distinct: 378
per roster: V1_AUDIT_ACTIONS=107 V4_DEPOSIT_AUDIT_ACTIONS=50 V5_WITHDRAW_AUDIT_ACTIONS=34 V6_SWAP_AUDIT_ACTIONS=26 V8_RECON_AUDIT_ACTIONS=9 V2_CUSTOMER_AUDIT_ACTIONS=31 V7_TREASURY_AUDIT_ACTIONS=7 INCIDENT_AUDIT_ACTIONS=9 REG_FILING_AUDIT_ACTIONS=11 COMPLIANCE_OFFICE_AUDIT_ACTIONS=28 COMPLAINT_AUDIT_ACTIONS=10 CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS=9 CAMPAIGN_B_LP_EXCHANGE_AUDIT_ACTIONS=9 CAMPAIGN_B_CAPITAL_INJECTION_AUDIT_ACTIONS=6 CAMPAIGN_B_VENDOR_PAYMENT_AUDIT_ACTIONS=6 CAMPAIGN_B_PRUDENTIAL_AUDIT_ACTIONS=2 CAMPAIGN_C_NOTIFICATION_AUDIT_ACTIONS=15 LP_ADDRESS_AUDIT_ACTIONS=9
exports named *_AUDIT_ACTIONS (excl. DEPRECATED): 18
exported but not in spec REGISTRIES: []
in spec REGISTRIES but not exported: []
DEPRECATED_AUDIT_ACTIONS length: 123
```

名册集合双向核对：spec `REGISTRIES` 的 18 册 = `audit-actions.constant` 里全部 `*_AUDIT_ACTIONS` 导出（去掉 `DEPRECATED_AUDIT_ACTIONS`），两个方向差集都空。另附：退役词表 `DEPRECATED_AUDIT_ACTIONS` 123 条（不计入 378）。

## C5 TB 科目码与转账码

```bash
node - <<'JS'
require('ts-node').register({ transpileOnly: true });
require('tsconfig-paths/register');
const { TB_ACCOUNT_CODES } = require('./src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant');
const { TB_TRANSFER_CODES } = require('./src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant');
const tv = Object.values(TB_TRANSFER_CODES);
console.log('TB_ACCOUNT_CODES count:', Object.keys(TB_ACCOUNT_CODES).length, '| values:', Object.values(TB_ACCOUNT_CODES).join(','));
console.log('TB_TRANSFER_CODES count:', tv.length, '| distinct values:', new Set(tv).size, '| max:', Math.max(...tv), '| min:', Math.min(...tv));
JS
```
```
TB_ACCOUNT_CODES count: 11 | values: 1,50,100,101,200,210,211,212,300,301,302
TB_TRANSFER_CODES count: 37 | distinct values: 37 | max: 87 | min: 1
```

## C6 账本科目数（`verify:coa`）

```bash
bash scripts/stack.sh reset self && bash scripts/stack.sh up     # 等 customer_monthly_statements = 55
bash scripts/on-stack.sh self demo:all > <日志> 2>&1; echo $?        # 0；花名册 35/35、asserts 5/5 PASS
bash scripts/on-stack.sh self verify:coa > <日志> 2>&1; echo $?      # 0
```
```
✓ ledger 1 CLIENT 恒等 34107565
✓ ledger 1 FIRM 恒等 94870335
✓ ledger 2 CLIENT 恒等 8201620811
✓ ledger 2 FIRM 恒等 114035428189
✓ 负余额检查 通过 (87 个科目全部 ≥ 0)
ALL INVARIANTS PASS
```

取了两次，结果相同：第一次在客户侧快照所在的那次重铺上（`demo:all` 之后、拍快照之后）；第二次在收尾重铺的栈上（本任务交付给下一个任务的栈）。

## 边界

- 数的是**常量表 / 名册里的键**，不是运行期落库行数：审批策略 55 是代码里的默认策略数（运行期还会有用户新增的策略行，这里不涉及）；审计码 378 是十八册的**活词**数，退役闸 123 条不计。
- 失效验证（命令会红）：C2 的 AST 取数依赖变量名不改名。把命令副本里的 `'MAKER_GROUP_EXEMPT'` 换成不存在的名字 → 退出码 1，`TypeError: Cannot read properties of undefined (reading 'length')`；把 C4 副本里的 `'REGISTRIES'` 换成不存在的名字 → 退出码 1，`TypeError: Cannot read properties of null (reading 'map')`。两处都不会静默给出 0 或空数。C1/C3/C5 直接 import 真常量，常量被删 / 改名会 `undefined` 抛错。变异副本是 scratch 文件，未入库。
- C3 对管理台路由表用 `ts.transpileModule` 转 CJS 求值——因为 `admin-web` 是 `"type":"module"` 包，直接 `require` 会 `ERR_REQUIRE_ESM`（首次尝试即如此，已改）；该文件目前无 import，若以后加了 import，这条命令要跟着改。
- 「科目数 87」来自 `verify:coa` 打印的口径；它与账本科目页「Ledger Accounts · 87 accounts」是同一个数（波一收尾证据 `t13-ledger-accounts.png`），本任务没有重截图。
