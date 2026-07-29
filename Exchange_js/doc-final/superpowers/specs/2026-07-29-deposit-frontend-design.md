# 充值前端(admin + client)+ 演示开关 — 设计 spec

> **日期**:2026-07-29　**状态**:设计(未实现)
> **背景**:计划1(KYT-only 状态机引擎)与计划2(四条动钱弧)已落地,后端 deposit 状态从 9 个增至 **15 个**;两个前端仍停在旧世界(admin 认 10 态、client 认 9 态,均不认 MANUAL_CHECKING/RETURNING/RETURNED/SEIZING/SEIZED),admin 亦无上缴/解冻入口。
> **范围**:两个前端的充值全部页面 + 甲方案(演示开关 + 场景一键喂)。

## 0. 已定决策(脑暴逐段确认)

| # | 决策 |
|---|---|
| 1 | **架构走"甲"**:抽状态映射为单一真相源 + 扩展现有页面;不逐处补 case(乙),不大重构(丙) |
| 2 | **客户可见性**:退回明示、**冻结/上缴/人工校验一律模糊为"审核中,请联系客服"**(tipping-off 合规) |
| 3 | **admin 审批**:只做发起 + 审批状态可见,实际审批走现有审批中心,不重复造界面 |
| 4 | **甲方案并入本轮**(新页面没 fixture 驱动就无法验证/演示;sandbox 造不出制裁/PEP) |
| 5 | **FAILED 保留**;**REJECTED / EXPIRED 将来删**(已登记 BACKLOG `d7b4456e`)——本轮仅保留映射兜底展示,**不给操作入口、不做筛选项** |
| 6 | **全英文文案铁律**:两个前端**所有**用户可见文字一律英文,**不得出现任何中文**(业主 2026-07-29 定)。含本轮新增与**顺带清理的既有残留** |

### 0.1 全英文铁律(硬约束)

**所有页面文案(徽章 / 按钮 / 提示 / 空态 / 错误 / tooltip)必须是英文,零中文字符。**

**已实测的既有残留(本轮一并清理)**:
- `admin-web/src/pages/DepositTransactionDetail.tsx:291` —— 没收在途提示是**英文/中文双语拼接**,删掉中文半句
- `client-web/src/pages/Deposit.tsx:487,488` —— 模拟充值下一步提示,纯中文
- `client-web/src/pages/Deposit.tsx:498` —— "…模拟充值已创建成功,下一步请去 Admin 继续推进"
- `client-web/src/pages/Deposit.tsx:505` —— "查看历史" → `View history`

**验收**:`grep -P '[\x{4e00}-\x{9fff}]'` 扫两个前端的充值相关文件,**必须零命中**(纳入 §5 硬闸)。
> 注:代码注释可用中文(与项目现有风格一致);**仅"用户可见文案"强制英文**。

## 1. 状态映射:一个数据、两套口径(核心)

**为什么是核心**:15 个状态 × 两套口径,没有单一真相源必然出错;客户面误显示"已上缴"即合规事故。

### 1.1 admin 映射(`admin-web/src/utils/depositStatusMap.ts`,如实)
**徽章文案即最终英文串**(照抄进代码):

**状态徽章一律全大写**(与项目既有惯例一致:client `Deposit.tsx:511/519`、admin 表头 `:256` 均用 `uppercase`)。

| 状态 | 徽章(英文,最终) | 归组 | 配色 |
|---|---|---|---|
| PAYIN_PENDING | `AWAITING PAYIN` | In progress | 中性 |
| COMPLIANCE_PENDING | `COMPLIANCE REVIEW` | In progress | 中性 |
| ACTION_PENDING | `AWAITING CUSTOMER` | Waiting | 琥珀 |
| **MANUAL_CHECKING** | `MANUAL CHECKING` | Needs officer | 琥珀 |
| SUCCESS | `SUCCESS` | Completed | 绿 |
| **FROZEN** | `FROZEN` | Needs officer | 红 |
| **RETURNING / RETURNED** | `RETURNING` / `RETURNED` | Disposing / Completed | 橙 / 灰蓝 |
| **SEIZING / SEIZED** | `SEIZING` / `SEIZED` | Disposing / Completed | 橙 / 灰蓝 |
| CONFISCATING / CONFISCATED | `CONFISCATING` / `CONFISCATED` | Disposing / Completed | 橙 / 灰蓝 |
| FAILED | `FAILED` | Exception | 灰红 |
| REJECTED / EXPIRED | `REJECTED` / `EXPIRED` | Exception(**待删,仅兜底**) | 灰 |

筛选项(下拉,非徽章,用 Title case):`Manual checking` / `Frozen` / `Disposing` / `Returned` / `Seized`。

配色用 `adm-*` 令牌(rules 强制),不用裸 Tailwind 色。

### 1.2 client 映射(`client-web/src/utils/depositStatusView.ts`,面向客户)
**文案即最终英文串**(照抄进代码):

**状态徽章一律全大写;副文案(说明句)用正常句式大小写。**

| 后端状态 | 客户徽章(全大写,最终) | 副文案 |
|---|---|---|
| PAYIN_PENDING / COMPLIANCE_PENDING | `PROCESSING` | — |
| ACTION_PENDING | `ACTION REQUIRED` | `Please provide additional information` + CTA(§3.C) |
| SUCCESS | **`SUCCESS`** | 金额 |
| **RETURNING** | `RETURNING` | `Funds are being returned to the original sender` |
| **RETURNED** | `RETURNED` | `Funds were returned to the original sender` |
| **FROZEN / SEIZING / SEIZED / MANUAL_CHECKING** | `UNDER REVIEW` | `Please contact support` + 客服入口 |
| CONFISCATING / CONFISCATED | (服务端已过滤,客户不可见) | — |
| FAILED / REJECTED / EXPIRED | `FAILED` / `UNSUCCESSFUL` / `EXPIRED` | 中性 |

**三条铁律(写进文件头注释 + 单测锁住)**:
1. 本文件**永不**出现制裁/执法语义词 —— 违禁词表(大小写不敏感):`sanction` / `seiz` / `frozen` / `freeze` / `confiscat` / `enforcement` / `government` / `police`。单测遍历 15 态断言输出不含任一。
   > 注意:`UNDER REVIEW` 是刻意选的中性词,**不得**因为"更准确"而改成 `FROZEN`/`SEIZED`。
   > 违禁词检测**大小写不敏感**——全大写徽章同样受约束(`FROZEN`/`SEIZED` 一样会被单测拦下)。
2. **未知状态兜底**:client 回落 `Processing`(绝不裸奔状态码);admin 显示原始码 + 警告色(便于发现漏配)。
3. **零中文**(§0.1):本文件及所有客户可见文案全英文。

## 2. admin 页面

### 2.1 列表 `DepositTransactionList.tsx`
- 徽章改查表渲染(§1.1),15 态全覆盖;保留现有 BELOW MIN 徽章。
- 筛选新增:人工校验 / 冻结 / 处置中(退回·上缴·没收)/ 已退回 · 已上缴。**不加** REJECTED/EXPIRED。

### 2.2 详情 `DepositTransactionDetail.tsx` — 处置区按状态门控
| deposit 状态 | 可用动作 |
|---|---|
| below-min 挂起 | PASS 豁免 / 发起没收(**现有,不动**) |
| **FROZEN** | **发起上缴**(`POST :id/seize`,需 orderRef)/ **发起解冻**(`POST :id/unfreeze`,需 orderRef)← 新增 |
| MANUAL_CHECKING | **无动作** + 提示"处置在 Sumsub 控制台完成(officer 打 tag 后重拍 Reject)" |
| 处置中(RETURNING/SEIZING/CONFISCATING) | **无动作** + 在途提示 |
| 终态(SUCCESS/RETURNED/SEIZED/CONFISCATED/FAILED/…) | **无动作** |

> 顺手治 BACKLOG:36「终态仍全显 6 按钮」的老毛病 —— 按终态统一门控通用组。

### 2.3 审批状态卡(新)
单子有关联审批(`approvalCaseId`)时显示:`已提交上缴审批单 AP-xxxx · 待 MLRO 审批 · [去审批中心]`。**只读 + 跳转**,不在此审批。

### 2.4 Sumsub 引用区(新,只读)
展示 `sumsubFinanceTxnId` / `sumsubTravelRuleTxnId` + 处置 tag,供 operator 对号入座。
> 合规:项目规则禁展示裸 UUID;这两个是 **Sumsub 业务号**,可展示。

## 3. client 页面

### 3.A 抽 `depositStatusView.ts`
`Deposit.tsx` 现 1150 行 —— **不重构,但止血**:状态展示抽出,页面只管布局。

### 3.B 状态展示
按 §1.2 映射渲染列表/详情。

### 3.C ACTION_PENDING 补料 CTA(客户端唯一交互增量)
显示 Sumsub 认证链接/问卷入口,点击跳转。
> ⚠️ **未知,实现时先查**:后端是否已暴露 SDK token / verification link 字段?**若没有 → 降级为"请联系客服"并记 BACKLOG,不臆造字段。**

### 3.D below-min
服务端已过滤(`limitHoldReason != null` 对客户不可见)→ **客户端零改动**,不做任何提示。

## 4. 甲方案:演示开关 + 场景一键喂

### 4.A mock 开关(后端)
`DepositSumsubModule` provider 条件化:`SUMSUB_MOCK_MODE=true` → `MockSumsubTxnClient`(已存在);否则 `HttpSumsubTxnClient`(现状)。**命名与老 `sumsub.client.ts` 的同名开关对齐**,不另造。

### 4.B 场景端点(新)
`POST /admin/deposit-sumsub/demo/run-scenario`,body `{ depositId, scenario }` → 把 fixture 喂进**真** `ingestionService.ingest()`(与 e2e 同一条路)。
**三道安全闸**:
1. **仅当 `SUMSUB_MOCK_MODE=true` 才注册该 controller** —— 生产环境端点不存在
2. RBAC 照 `POST :id/confiscate` 登记 catalog
3. 写审计(谁、何时、喂了哪个场景)

### 4.C admin 演示面板
详情页"⚡ 演示"区,**仅 mock 模式可见**(照现有 `useSimulationMode` 门控范式),8 个场景按钮。

### 4.D 场景(复用 `fixtures/scenarios.ts`,零新增)
happy-fiat / happy-crypto / **制裁→冻结** / **PEP→补料→放行** / 脏钱→冻结 / 脏钱→退回 / 误报翻案 / onHold→SLA
> 粗体两个是 **sandbox 永远演不出**的 —— 甲方案的存在理由。

## 5. 验证

1. **单测**:两张映射表全状态覆盖;**client 违禁词断言**(15 态输出不含"制裁/冻结/上缴/执法"等)。
2. **渲染验证(硬性,项目铁律)**:声称前端完成前**必须真起服务 + 预览截图比对**,不能只 tsc 绿。用 mock 开关喂场景,把新状态逐个渲染截图(人工校验 / 退回中 / 已退回 / 上缴中 / 冻结 / 演示面板)。
3. **e2e 不新增**:后端 15/15 已覆盖状态流转;前端靠渲染验证。
4. **硬闸**:
   - 两个前端 `tsc` 0 + 后端 `jest` 不回归
   - **零中文扫描**:`grep -rP '[\x{4e00}-\x{9fff}]'` 扫本轮改动的所有前端文件的**用户可见文案**,必须零命中(注释除外)
   - **违禁词扫描**:client 映射输出不含 `sanction/seiz/frozen/freeze/confiscat/enforcement/government/police`(单测保障)

## 6. 交付物

`depositStatusMap.ts`(admin)+ `depositStatusView.ts`(client,含违禁词单测)+ admin 列表/详情改造(徽章·筛选·处置区门控·审批卡·Sumsub 引用区)+ client 状态展示与补料 CTA + mock 开关 + demo 端点 + admin 演示面板 + 渲染截图。

## 7. 未决 / 风险

- 🟡 **补料链接字段**(§3.C)后端是否已暴露 —— 实现时查,没有就降级 + BACKLOG。
- 🟡 REJECTED/EXPIRED 将来删除时,本轮的映射兜底需一并清理(BACKLOG 已记)。
- ⚠️ **admin/client 两套映射刻意不同**,禁止图省事共用;client 那套的违禁词单测是防线。
