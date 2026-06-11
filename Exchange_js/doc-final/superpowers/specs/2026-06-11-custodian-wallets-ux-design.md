# Custodian Wallets 列表/详情打磨 — 设计 spec

日期:2026-06-11
状态:已确认(6 问诊断 + 3 决策:F_* 同 Zand/FiatX、脏数据 SQL 原位修正、Surface 删除)
范围:钱包列表/详情两页 + wallets 查询接口 + seed 银行信息 + verify 脚本治本。只读查询增强与展示数据修正,无状态机/记账变更。

---

## 0. 诊断结论(脑暴定案)

| # | 问题 | 根因 |
|--|---|---|
| 1 | walletNo 双格式 | `scripts/verify-two-book.ts:145/156` 手搓 `WA-VERIFY-*`,未走统一编号器;生产链路全部标准 `WA26…` |
| 2 | Owner 单列混排 | 前端单列;姓名缺后端 enrich |
| 3 | CMA 银行信息错 | 2026-05-20 文档定的是 `Zand Bank PJSC`/`FiatX Ltd`;seed 写成 `FiatX Internal Bank`/`Platform C_CMA (AED)`,脱节 |
| 4 | vIBAN 继承 | 机制已存在且正确(create-workflow C_VIBAN 分支复制 CMA bank 字段);verify 脚本绕过了它 |
| 5 | 详情分组乱 + Surface 不明 | Surface = `classifyWalletSurface(ownerType, walletRole)` 推导的资金面分类,非存储字段;决策:**删除** |
| 6 | 搜索失灵 | 旧 `ownerId` 参数按 UUID 等值匹配,输 CU 号搜不到 |

---

## 1. 数据修正

### 1.1 seed(prisma/seed.business.ts 法币平台钱包段)

- 全部 FIAT_BANK 平台钱包(C_CMA/F_SET/F_FEE/F_OPS/F_LIQ):`bankName: 'Zand Bank PJSC'`、`accountName: 'FiatX Ltd'`。
- IBAN 改合规 AE 格式:`AE` + 2 位校验数字 + 3 位银行码 + 16 位账号(共 23 字符)。从既有 sha256 hash 取数字位确定性生成(reseed 幂等;不要求真实 mod-97 校验,但格式必须全数字、长度合规)。
- 存量平台行靠 seed upsert 的 update 分支刷新(跑一次 `db:biz:init` 级 seed 即可)。

### 1.2 存量脏数据(一次性 SQL,保留验收数据)

- `WA-VERIFY-DEP-…`(crypto):walletNo 换标准格式号(确定性生成、不与现有冲突,如 `buildDeterministicNo('WA','C_DEP', 'VERIFY', …)` 同式样的 `WA26…` 号)。
- `WA-VERIFY-VIBAN-…`(fiat):同样换号;`bankName='Zand Bank PJSC'`、`accountName='FiatX Ltd'`(继承语义);iban 保留原值(客户专属 vIBAN)。
- 实现为一段幂等 SQL/小脚本,在实施中直接对 branch DB 执行并贴前后对比。

## 2. verify 脚本治本(scripts/verify-two-book.ts)

- 造 C_DEP/C_VIBAN 钱包处改用标准编号器(`buildDeterministicNo('WA', …)`,产出 `WA26…` 式样)。
- C_VIBAN 的 bankName/accountName 改为查 ACTIVE CMA 复制(与 create-workflow 同语义);iban 保持脚本自定。

## 3. 后端查询接口(wallets.controller + wallet-query.service)

- `GET /admin/custodian-wallets`(以实际路由为准)新增:`walletNo`(contains)、`ownerNo`(contains);与既有 ownerType/walletRole/type/status/assetId AND 组合;旧 `ownerId` 参数保留兼容。
- 列表与详情响应 enrich `ownerName: string | null`:CUSTOMER 行按 ownerId 批量查 customer_main(firstName+lastName,单次 IN,无 N+1);PLATFORM/LP 行 null。
- **`surfaceCategory` 从列表与详情响应中移除**(wallet-query.service.ts:21/41 两处)。**`classifyWalletSurface` util 本身必须保留**——safeguarding-reconciliation.service.ts:434/445 是真实消费者(对账分类逻辑),只删钱包查询响应与 UI 展示,不动 util。

## 4. 前端列表(CustodianWalletList.tsx)

- 搜索区:`Wallet No` 输入框 + `Customer No` 输入框(Enter/Search 触发),**删除**旧 "Owner ID / No" 框;ownerType/walletRole/type/status 下拉保留。
- 列:Wallet No | Role | **Owner No** | **Owner Name** | Asset | Network | Balance (mock) | Status | Created。
  - Owner No:CUSTOMER 行显 customerNo,可点击 `navigate(\`/dashboard/customer/${ownerId}\`)`(stopPropagation);PLATFORM 行显 `PLATFORM` 文本(不链接);
  - Owner Name:CUSTOMER 显姓名,无名/非客户显 `—`。
- Balance 表头标注 `(mock)`。

## 5. 前端详情(CustodianWalletDetail.tsx)

- hero 区:walletNo + role/status badge;**删除 Surface 字段及 SURFACE_LABELS 映射**。
- 分区顺序:
  1. **Detail**:Role / Owner Type / Owner No(CUSTOMER 可点击跳客户详情)/ Owner Name / Asset / Network / Vault ID(crypto 有值时)
  2. **Balance**:mock 余额(label 标注 mock)
  3. **Bank Account**(fiat):Bank Name / Account Holder / IBAN;或 **Crypto Address**(crypto):Address / Vault ID
  4. **Deposit Collection**(仅 C_DEP,现有区保留)
  5. **Audit**:Created / Updated
- sidebar 同步:删 Surface;Owner 信息拆 No(链接)/Name。

## 6. 测试与验收

- 后端:wallet-query.service.spec 加用例——walletNo/ownerNo 参数 where 构造、ownerName enrich(单次 IN)、响应不含 surfaceCategory。TDD 先红后绿。
- 前端:admin tsc 零错误;两页 vite 编译 200。
- 手验动线:搜 `WA26` 前缀命中、搜 `CU2601019430` 命中其钱包、点 Owner No 跳客户详情、CMA/F_* 显示 Zand Bank PJSC + FiatX Ltd、vIBAN 行(SQL 修正后)同样显示 Zand、两条原 WA-VERIFY 行已是标准号。
- 默认行为不变量:无新参数时列表接口结果与现状一致(除 enrich 字段与 surface 移除)。

## 7. 范围外

- 真实 IBAN mod-97 校验、钱包创建表单的银行字段预填(创建工作流已有继承)、LP 钱包页、balance 实时化。
