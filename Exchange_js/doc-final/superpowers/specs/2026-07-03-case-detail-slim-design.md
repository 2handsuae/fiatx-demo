# Case 详情页瘦身（问题优先重排）设计

> 日期：2026-07-03 ｜ 状态：设计定稿（脑暴可视化对比，用户选定方案乙）
> 范围：仅 `admin-web/src/pages/ReconciliationCasesDetailPage.tsx` 一个文件（+ rules 文档登记）
> 上游：Round3 T8 交付的 case 详情页首版信息冗余过高（用户反馈），本轮做展示收敛，零后端改动。

---

## 1. 冗余审计（现状问题，代码行号为证）

| 字段 | 现出现位置 | 次数 | 处置 |
|---|---|---|---|
| Asset 币种 | Hero 格(:404) + Owner 卡(:439) + 差额解释标题(:486) + 侧栏(:740) | 4 | 留差额解释标题 + 身份行，各 1 |
| Δ 差额 | Hero 格(:407) + 五格(:533) + 侧栏(:741) | 3 | 留五格 + 侧栏快扫 |
| Book | Hero 格(:402) + Owner 卡(:442) + 侧栏(:739) | 3 | 并入身份行 1 处 |
| Status | Hero 文本行(:400) + 侧栏(:738) | 2 | Hero 转徽章 + 侧栏快扫 |
| run 引用 | Linked Run 卡 + 观察历史横条 | 2 | 删卡，观察历史独担 |
| 时间戳 | Lifecycle 卡 + 侧栏 Lifecycle + 观察历史首见 | 3 组 | 删主体 Lifecycle 卡，侧栏独担 |

## 2. 新页面结构（方案乙 · 问题优先）

```
[导航条]  ← Cases + Refresh（不动）
[Hero]    caseNo + 桶徽章 + severity 徽章 + status 徽章（三徽章一排；删 STATUS/BOOK/ASSET/Δ 四行 grid）
[结论句]  一句人话（生成规则见 §3），紧贴 Hero 下方
[① 差额解释五格]  内部 / 外部 / Δ / 在途解释 / 未解释残差（区块不变，位置提升到第一）
[② 账户身份单行]  钱包 walletNo · 客户 ownerNo · 科目 coaCode · 币种·Book（"USDT-TRON · CUSTOMER"）
                  —— 原 4 卡（Wallet/Owner/Linked Run/Lifecycle）合并为 1 行；Linked Run 卡、Lifecycle 卡删除
[③ 观察历史横条]  不动（run 引用的唯一出现点）
[④ 流水下钻单表]  不动
[⑤ Related Views] 不动
[侧栏]    Identity = Case No / Status / 桶 / Δ（4 行；删 Book、Asset）；Lifecycle = SLA / Created / Updated（不动）
```

## 3. 结论句生成规则（纯前端派生，输入 = bucket + explain + flowSummary + caseReason + status）

| 优先级 | 条件 | 模板 | 配色 |
|---|---|---|---|
| 1 | walletNo=null 且 coaCode=null（无主头前端判据——后端 caseReason 未持久化、API 不返回，本期不动后端） | `外部账户 {walletRef} 无法归属任何钱包，余额 {actualExternal} 待认领` | 红 |
| 2 | bucket=BREAK 且 explain.inTransitSigned=0 | `外部比内部{少/多} {abs(Δ)} {币种}，无在途解释 → 全额待排查` | 红 |
| 3 | bucket=BREAK 且 explain.inTransitSigned≠0 | `差额 {Δ} 中 {inTransitSigned} 由在途解释，残差 {residual} 待排查` | 红 |
| 4 | bucket=IN_TRANSIT | `差额 {Δ} 已被在途单全额解释，等待外部确认后自愈` | 蓝 |
| 5 | bucket=SOFT_FLAG | `余额已对平，但 {异常行数} 笔流水配不上 → 假匹配待核` | 琥珀 |
| 6 | bucket 为 null（历史 case） | 不渲染结论句 | — |

- 方向措辞：Δ<0 → "外部比内部少"；Δ>0 → "外部比内部多"（少 = 钱可能丢，语义更重）。
- status=RESOLVED：按同规则生成，配色统一转中性灰（`adm-t2`），前缀加 `已解决 · `。
- 异常行数 = flowSummary.orphanInternal + orphanExternal + mismatch。
- 金额格式沿用页内既有 `formatAmount`。

## 4. 删减明细（实现对照清单）

1. Hero grid 四行（STATUS/BOOK/ASSET/Δ，:399-407）→ 删除；status 以 `StatusPill` 徽章形式追加到桶徽章、severity 徽章之后
2. `Account Identity` DetailCard（4 卡）→ 替换为单行紧凑身份条（1 个 DetailCard 内一行 flex，四段：钱包/客户/科目/币种·Book）；Wallet 的 coa 副标签并入"科目"段
3. Linked Run 卡 → 删除（观察历史已含首见/最后 run）；Lifecycle 卡（First seen/Last update）→ 删除（侧栏 Created/Updated + 观察历史首见已覆盖）
4. 差额解释五格 → 内容不动，位置提到身份行之前（第一区块）
5. 侧栏 Identity：删 `Book`、`Asset` 两行，加 `桶`（BUCKET_LABELS 双语）一行 → Case No / Status / 桶 / Δ 共 4 行（符合 3-5 规则）
6. 观察历史 / 流水表 / Related Views / 侧栏 Lifecycle → 不动

## 5. 文档登记义务

`doc-final/rules/frontend-admin.md` Per-entity Sidebar Fields 表的 **ReconciliationCase** 行更新为：
Identity Summary = `caseNo`, `status` badge, `bucket` badge, `deltaAmount`；Lifecycle = `slaDeadline`, `createdAt`, `updatedAt`。

## 6. 验收标准

- [ ] `npx tsc -b`（admin-web）0 错
- [ ] preview 截图：BREAK / IN_TRANSIT / SOFT_FLAG 三种桶 case 各一张，对照 §2 结构 + §3 结论句正确生成（含 IN_TRANSIT 蓝句、SOFT_FLAG 琥珀句）
- [ ] 冗余复查：Asset 全页 ≤2 处、Δ 主体区 1 处（+侧栏 1）、Book 1 处、run 引用 1 处、主体区时间戳 0 组
- [ ] 历史 case（bucket=null）不渲染结论句、不崩

## 7. 明确不做

后端/DTO 改动｜流水表列变更｜Run 详情页改动｜处置按钮（下期平账）｜结论句进 API（纯前端派生，规则变更零后端成本）
