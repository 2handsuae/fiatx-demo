# 资金单 Admin 列表页优化 — 设计

> Date: 2026-07-11 ｜ Status: 设计定稿(待评审) ｜ 范围:**甲(窄)= 仅列表页 + 菜单,详情页不动**
> 定调:业主 4 条诉求——①列表页全英文 ②菜单挪到 Swap Transactions 下 ③删类型 tab 改筛选栏 ④列表加 externalRef 列。**纯前端,2 文件,0 后端改动。**

---

## 0. 背景与现状

资金单 admin 有列表页(`FundsOrderList.tsx`)+ 详情页(`FundsOrderDetail.tsx`)。本次只优化**列表页 + 侧边栏菜单**;详情页及其双语文案本轮不动(甲)。

关键现状(勘查结论):
- 菜单(`DashboardLayout.tsx`):资金单在 Trading 组**末尾**(Swap Quotes 之后),label 带中文 `Funds Orders · 资金单`。
- 列表页中文源:标题 `Funds Orders · 资金单`、顶部类型 tab(`全部/充值/提现/兑换`)、状态标签走双语 util `formatFundsOrderStatusBilingual`("En / 中文")、若干注释。
- 状态 util `fundsOrderStatusMap.ts` **已内置英文路径**:`formatFundsOrderStatusLabel(status, assetType, 'en')`——列表英文化只需改调用,不动共享双语函数(详情页仍用双语,甲不受影响)。
- 后端 `FundsOrderService.findAllForAdmin` 返回的行 `...row` **已含 `txHash/referenceNo`**;前端类型未接。故 externalRef 列**无需后端改动**。

## 1. 目标 / 非目标

**目标**:列表页全英文;菜单挪到 Swap Transactions 正下方并去中文;类型筛选从 tab 改为筛选栏下拉;列表新增 External Ref 列。

**非目标**:不动详情页 `FundsOrderDetail.tsx`、不动两个共享 util 的双语渲染、不改后端、不改路由路径/权限。

## 2. 设计(2 文件)

### 2.1 `admin-web/src/components/DashboardLayout.tsx`
- 将 Funds Orders 菜单项(现 ~204-209,Trading 组末尾)**移动到 Swap Transactions 项(~185-189)正下方**。
- label `Funds Orders · 资金单` → `Funds Orders`(去中文)。
- 结果顺序:Deposit Transactions / Withdraw Transactions / **Swap Transactions** / **Funds Orders** / Withdraw Quotes / Swap Quotes。path、icon、`requiredPermissions` 不变。

### 2.2 `admin-web/src/pages/FundsOrderList.tsx`

**① 去中文**
- `PageTitleBar title` `"Funds Orders · 资金单"` → `"Funds Orders"`。
- 状态单元格:`formatFundsOrderStatusBilingual(item.status, item.asset?.type)` → `formatFundsOrderStatusLabel(item.status, item.asset?.type, 'en')`(改 import)。
- 顶部文件注释(line 5 含 `全部/充值/提现/兑换`)改英文。

**② 删类型 tab → 筛选栏下拉**
- 删除顶部 parent tabs 整块(~169-187)及 `TABS` 常量、`switchTab` 函数。
- `tab` 状态改名 `parentType`(仍 `'all' | 'deposit' | 'withdraw' | 'swap'`,默认 `'all'`)。
- 筛选栏(~190-219)在 status 之前加一个 Type `<select>`:选项 `All types / Deposit / Withdraw / Swap`(全英文)。
- **行为对齐 status**:选后**点 Search 生效**(`fetchItems` 读 `parentType`,`if (parentType !== 'all') params.set('parent', parentType)`);`handleReset` 把 `parentType` 也清回 `'all'`;`hasFilter` 纳入 `parentType !== 'all'`。

**③ 加 External Ref 列**
- `FundsOrderItem` 加 `txHash?: string | null` + `referenceNo?: string | null`。
- 前端解析器(镜像后端 `resolveExternalRef`):`String(asset?.type).toUpperCase()==='FIAT' ? referenceNo : txHash`;两者皆空 → `null`。
- 表头新增 `External Ref` 列,置于 **Parent 之后**(顺序:Funds Order No / Status / Parent / **External Ref** / Asset / Amount / Leg / Created)。
- 单元格:mono 小字,值截断(如 `slice(0,12)+'…'`)+ `title={full}` hover 显全 + 小复制按钮(`onClick` 内 `e.stopPropagation()` 防触发行跳转);空值显 `—`。
- **`colSpan` 由 7 改 8**(loading / empty 两处占位行)。

## 3. 边界与不变量
- swap 4 腿按**各腿自己的 asset.type** 分流解析(crypto 腿→txHash / fiat 腿→referenceNo)。
- 未到 CONFIRMED 或纯重分类腿(号未铸)→ External Ref 显 `—`。
- 详情页、`fundsOrderStatusMap`/`fundsOrderSimActionMap` 的双语输出**零改动**(甲)。
- 路由 `/admin/funds-orders`、权限 `FUNDS_ORDERS_READ` 不变。

## 4. 验收标准(□)
- □ 列表页(标题、类型筛选、状态标签、列头)**无任何中文**;`grep -P '[\x{4e00}-\x{9fff}]' FundsOrderList.tsx` 仅剩(若有)纯英文化后应为空。
- □ 侧边栏 Trading 组:Funds Orders 紧跟 Swap Transactions 之下,label 为纯英文 `Funds Orders`。
- □ 顶部无类型 tab;筛选栏有 Type 下拉,选 Deposit/Withdraw/Swap + Search 能正确过滤(`?parent=`),Reset 清回 All。
- □ 列表有 External Ref 列:crypto 单显 txHash、fiat 单显 referenceNo、无号显 `—`;复制按钮可用且不触发行跳转。
- □ `tsc`(admin-web)0 error;**渲染验证**:admin 页面截图确认上述四点视觉到位(UI 改动须渲染验证,不靠 tsc)。

## 5. 影响文件(锚点)
- `admin-web/src/components/DashboardLayout.tsx`(菜单移动 + 去中文 label)
- `admin-web/src/pages/FundsOrderList.tsx`(去中文 + 删 tab + Type 筛选 + External Ref 列)
- 不改:`FundsOrderDetail.tsx`、`utils/fundsOrderStatusMap.ts`(复用现成英文路径)、后端。
