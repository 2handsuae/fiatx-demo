# TB 总账管理页 UX 打磨 — 设计 spec

日期:2026-06-11
状态:已确认(账户页客户名+搜索;证据页 ID 列+三合一搜索+COA 筛选;客户跳转)
范围:admin 总账两组页面(LedgerAccount List/Detail、TransferEvidence List/Detail)+ `admin/tb` 两个查询接口。纯只读查询增强,无记账/状态变更,无审计写入需求。

---

## 1. 账户页(LedgerAccountList / LedgerAccountDetail)

### 1.1 后端 `GET /admin/tb/accounts`(TbAccountRegistryService.findAll)

- 返回行新增 `ownerName: string | null`:对 CUSTOMER 行,批量收集 `ownerUuid`,一次 `customer_main.findMany({ where: { id: { in } }, select: { id, firstName, lastName } })`,`ownerName = [firstName, lastName].filter(Boolean).join(' ') || null`。SYSTEM 行恒为 null。**禁止 N+1**。
- 新增查询参数 `q`(可选,trim 后非空才生效),OR 语义:
  1. `ownerNo contains q`(客户号)
  2. 姓名反查:`customer_main`(firstName contains q OR lastName contains q)取 id 列表 → `ownerUuid in ids`(列表为空则跳过该分支)
  3. `description contains q`
- 现有参数(assetCurrency/ownerType/code/skip/take)语义不变,与 q 为 AND 关系。

### 1.2 后端 `GET /admin/tb/accounts/:tbAccountId`

- 返回同样附 `ownerName`(单行查一次 customer_main)。

### 1.3 前端列表(LedgerAccountList.tsx)

- 列:`Account | Code | Ledger | Owner | Customer | Asset | Status | Created`
  - Owner 列:ownerType badge(SYSTEM/CUSTOMER)
  - Customer 列:CUSTOMER 行显 `customerNo · ownerName`(无名只显 customerNo);**customerNo 为跳转链接**到客户详情页(路由按 admin 现有客户详情页复用,plan 阶段从 App.tsx 确认 path);SYSTEM 行显 `—`
  - 原 Owner No 列并入 Customer 列(删除)
- 筛选区(Zone 2):新增**搜索框 q**,placeholder `Customer no / name / description`,Enter 或 Search 触发;现有 Asset/Owner Type/Code 三个下拉保留;Reset 连 q 一起清。

### 1.4 前端详情(LedgerAccountDetail.tsx)

- Owner 组新增 `Customer` 行:`customerNo · ownerName`,customerNo 同样跳转链接;SYSTEM 账户不显示该行。

---

## 2. 证据页(TransferEvidenceList / TransferEvidenceDetail)

### 2.1 后端 `GET /admin/tb/transfers`(TbEvidenceService.findAll)

- 新增 `q`(可选),OR 语义:
  1. `tbTransferId = q`(hex 等值,统一小写比较;若 q 以 0x 开头先剥前缀)
  2. `sourceNo contains q`
  3. `traceId contains q`
- 新增 `coa`(可选,值如 `A.CLIENT_BANK`):`OR [debitCode = coa, creditCode = coa, debitCode = <数字串>, creditCode = <数字串>]`,数字串由 COA 名经 COA_TO_TB_CODE 反查(兼容改造前的历史行,如 `'100'`)。
- 现有参数(sourceType/assetCurrency/eventCode/transferType/skip/take)不变,与新参数 AND。

### 2.2 前端列表(TransferEvidenceList.tsx)

- **新增第一列 `ID`**:mono 显示 `前8位…后6位`,带 copy 按钮(点击不触发行导航,stopPropagation),title=全量 hex。
- 筛选区:新增**搜索框 q**,placeholder `Transfer ID / source no / trace`;新增 **Account 下拉**(14 个 COA,选项文案 `A.CLIENT_BANK` 式,数据源复用 ledger-account.constants 的字典派生,值传 `coa` 参数);现有 Source/Asset/Event/Type 筛选保留;Reset 全清。
- 列总数 10,注意空态 colSpan 同步。

### 2.3 前端详情(TransferEvidenceDetail.tsx)

- 确认 `tbTransferId` 在头部/侧栏醒目展示 + copy(已有 CopyBtn 模式,plan 阶段核对,缺则补)。

---

## 3. 测试与验收

- 后端:tb-account-registry.service spec 加 q/enrich 用例(mock prisma,断言 IN 批量与 OR 条件);tb-evidence.service spec 加 q/coa 用例(含历史数字串兼容)。
- 前端:admin tsc 零错误;两页手验(搜索单号 SWP/WD/DEP 能命中、COA 筛出全部分录、客户名展示+跳转)。
- 不变量:接口默认行为(无新参数时)与现状逐字节一致——分页/排序不动。

## 4. 范围外

- 独立"科目流水"页、日期范围筛选、列表页余额列(TB 逐行查询太贵)、evidence 导出。
