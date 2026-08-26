# Withdrawal Address 列表/详情打磨 — 设计 spec

日期:2026-06-11
状态:已确认(label 独立列、customerName 展示、customerNo 跳转、addressNo+地址二合一搜索;附加:Asset 下拉、address copy)
范围:withdrawal-address admin 查询接口 + 列表/详情两页。纯只读增强,无状态机/审计变更。

## 0. 诊断

- 模型无 walletNo;业务键 = `addressNo`;`label` 字段存在但列表未展示;模型有 customer 关联但服务端只 `include: { asset: true }` → 前端拿不到客户名。
- 列表筛选仅 customerNo/status/addressType;后端 DTO 的 `assetId` 参数前端从未暴露。
- 用户口中的"walletNo 筛选"确认为:**addressNo + 链上地址 + IBAN 三合一模糊搜索**。

## 1. 后端(withdrawal-address-admin.controller + withdrawal-address.service + ListWithdrawalAddressQueryDto)

- DTO 加 `q?: string`(IsString/IsOptional)。
- 列表 where:`q` 非空 → `OR [addressNo contains, address contains, iban contains]`,与既有条件 AND。
- 列表/详情 include customer(`select { firstName, lastName }`),响应铺平 `customerName: string | null`(firstName+lastName join,空则 null);include asset 保留。
- 既有参数语义零变化;无新参数时响应仅多 customerName 字段。

## 2. 列表页(WithdrawalAddressList.tsx)

- 列:`Address No | Customer No | Customer Name | Label | Asset | Network | Address | Type | Status | Registered`(8→10 列,colSpan 同步)。
  - Customer No:可点击 `navigate(\`/dashboard/customer/${row.customerId}\`)`(stopPropagation);
  - Customer Name / Label:空值 `—`;
  - Address 单元格:截断 + title 全量 + copy 图标(stopPropagation)。
- 筛选区:新增二合一搜索框(placeholder `Address No / address / IBAN`,Enter 触发)+ 新增 Asset 下拉(`/assets?take=100`,value=assetId,过滤 tbLedgerId 非空)+ 既有 Customer No 框、Status/Type 下拉保留;Reset 全清。

## 3. 详情页(WithdrawalAddressDetail.tsx)

- Details 区 `Customer`(现纯文本 customerNo)拆:**Customer No**(可点击跳客户详情)+ **Customer Name** 两行;其余分区不动(Label 已有)。

## 4. 测试与验收

- service spec:q 三路 OR where 构造、customerName 铺平(姓名 join/空值)用例,TDD。
- admin tsc 零错误;两页 vite 200。
- 手验:搜 addressNo/地址片段命中、Asset 下拉过滤、Label 列展示、Customer No 跳转、详情两行。

## 5. 范围外

- 地址创建/审核流程、Travel Rule 字段逻辑、客户端页面。
