# 战役丙「客户触达+披露」立纲前体检

> 2026-09-30 ｜ 委托：战役丙开局，按甲乙惯例先摸底再立纲。
> 方法：两路扫描（代码地面真相 / 文档债清册）降档取数、主会话判读；载重否定性结论已抽查复现（通知零调用方、同意不落库）。
> 搜索边界：src / admin-web/src / client-web/src（字面+正则，不含 AST/动态拼接）；doc-final 不含 archive 与 lark；roadmap 正文仅经 219 分诊报告间接覆盖。同日的 BD 参照系盘点（`2026-09-30-bd-landscape-vs-modules.md`）是本报告的上游，不重复其内容。

## 一页结论

丙的四块候选（通知地基 / 对客书面披露 / 定期对账单 statements / DSR）**代码侧全部接近空白，但每块都有一个"已有的一角"可接**；文档侧的债与判例座位齐全，其中**搁置的三域细化总纲波一「让客户听得见」+ 波三「价格说得清·面」合起来就是丙的骨架内容**——丙立纲实质上是把这两波从搁置状态捞出来，加上 statements/DSR 归属裁定与营销门裁定。tipping-off 三条既有判例是丙全域的设计红线；披露/冷静期/DSR 三类在 decisions 零判例，从零裁。

## §1 现状底账（代码地面真相）

| 块 | 现状 | 已有的一角 | 锚点 |
|---|---|---|---|
| 通知地基 | `core/notifications/` 仅孤儿 WebSocket gateway，唯一方法 `notifyComplianceUpdated` 全仓零调用方（类名/文件名/事件名三搜法）；三端 package.json 零 email/推送依赖；client-web `socket.io-client@^4.8.3` 是零 import 僵尸依赖；临时提示 = 10 处原生 `alert()` + 登录页一次性 toast | 4 个合规横幅组件已是触达面雏形：`ProfileBannerStack.tsx` 轮询 `GET /customers/me/profile-banners` + `ProfileBanner`/`RestrictionBanner`/`PendingActionBanner` | `grep -rn "notifyComplianceUpdated" src`（仅定义行）；`grep -rn "socket.io-client" client-web/src`（0） |
| 披露面 | 充值/提现页零风险提示（`grep -inE "risk\|warning\|风险" client-web/src/pages/Withdraw.tsx` = 0）；开户身份核验页零条款步骤；无本金身份/利益冲突/定价方法披露 | ① 注册页 `CustomerRegister.tsx:46-104` 已有 7 节条款抽屉（含 PDPL 数据主体权利、"DSR 由 dpo@fiatx.ae 30 天内处理"文案）——**但 `acceptTerms` 是纯前端闸，src+prisma 对 `acceptTerms\|termsAccepted\|consentAccepted` 零命中，同意不落库**（文件头注释 `:15-16` 自认）；② Swap 报价页已有 spread/fee 双点披露（`Swap.tsx:735,770-772,1026-1043`） | `grep -rn "acceptTerms" src prisma`（0） |
| 成交确认单 | 无回执/确认单概念（`receipt\|回执\|结单` 客户端零真实命中）；无 PDF/下载/导出能力（唯一 "PDF" 字样是条款静态文案"可应要求提供"） | 三域详情页已有结构化区块可升级：`SwapDetail` Amounts/Pricing/Timeline、`WithdrawDetail` +Route、`DepositDetail` 同款 | `grep -rniE "\bpdf\b\|\bdownload\b" client-web/src`（1 处静态文案） |
| statements | 无周期生成产物；`customer-statement.service.ts` 对 `cron\|monthly\|period` 零命中；src 内 300+ 处 `statement` 命中大多是**内部托管/银行对账**语境（`SimulatedCustodianStatementService`/`ExternalStatementLine`），与客户对账单两回事 | 即时查询读模型全链在跑：`TransactionHistory.tsx:127 fetchStatement()` → `GET /client/portfolio/statement`（`customer-portfolio.controller.ts:43`）→ `TbEvidenceService.getAccountStatement` → `CustomerStatementService.buildStatement`（2026-09-07 界面收口轮建） | `grep -niE "cron\|monthly" src/modules/asset-treasury/treasury/customer-statement.service.ts`（0） |
| DSR | 零后端实现，`GDPR` 全仓零命中；`PDPL` 其余命中全是事故上报语境（`PDPL_ART_9` 数据泄露上报），非客户自主请求 | ① 条款文案已承诺 access/rectification/erasure/portability（`CustomerRegister.tsx:93`）；② 证据包导出可按 `subjectNo`/`ownerCustomerNo` 过滤，但必填 `selectedEventIds`——锚定勾选审计事件，不是客户个人数据包（`audit-log.dto.ts:291-393`） | `grep -rniE "\bDSR\b\|data subject\|erasure" src`（0 实现） |

## §2 债清册与座位

**BACKLOG 未销行（丙域相关全集）**：

- `:276` ⭐🔴 通知 send/retry = STUB——V4-V6"通知未接"的共同根因（本体没做，不是没调）
- `:106` 兑换成功通知未接 ｜ `:120` 提现成功通知未接
- `:272` 订单列表去轮询、改"信号+拉取"（**业主 2026-09-15 拍板、脑暴已完成待立 spec**；设计三点已定：信号零内容走白名单 REST / 只在客户面收敛后状态变化时发 / JWT 按 token 入房；自划边界"I1 通知本体（消息中心）仍不做，这是传输层信号"；地基点名接活孤儿 gateway）
- `:336` 营销发布前合规审批门（甲总纲判"挂起非不建"，甲唯一挂起项，等丙裁）

**219 分诊座位**（`checkups/2026-09-17-roadmap-item-triage.md`）：

- 通知本体 = C 桶（要做）**排序第 1**：「唯一一个客户侧感知的洞……演示被问"客户怎么知道钱到了"直接卡壳，一条修完点亮四条」（L129）；V1 admin 生命周期通知/审批超时预警亦 ⛓通知本体（L142）
- V2 客户资金月度对账单 = C 桶要做，零动工（L144）；V3 资产对外披露信息页 = C 桶要做，⚠️L198 订正为"改锚组"（原挂靠已退役的上架 workflow）
- V6 本金身份+利益冲突+定价方法披露 ｜ 点差双点披露+成交确认单 = C 桶 **P0**（L152）
- V5 tipping-off 内外双轨 = B 桶部分做了，缺口="对客话术 MLRO 预审流程未建"（L58）
- V9 营销审批门 = C 桶要做（L158）——与 BACKLOG:336"挂起"措辞有差，立纲时对齐口径
- 否定面：A 桶（已做）与 D 桶（判冲突）零通知/披露/statement 条目——本域没有已完成项，也没有被否决项
- 组织件不做（E①在案，不翻案）：营销激励事前 confirmation、营销档案 8 年留存、托管安排官网公示

**搁置的三域细化总纲**（`specs/2026-09-24-three-domains-completion-charter.md`，⛔ 2026-09-25 改向框架优先，十波不执行，§1/§4 底账仍有效）：

- 波一「让客户听得见」（L42）= 通知本体复活 + 三域成功通知 + 退汇/退回/卡单对客通知接线——**即丙的通知半边**
- 波三「价格说得清·面」（L44）= 本金身份+利益冲突+定价方法披露（客户端）+ 点差双点披露 + 成交确认单（不可变），验收="客户端成交前后两个披露点+确认单页截图"——**即丙的披露半边骨架件**（BD 盘点已订正：这波不是装修）
- 两波在搁置总纲里互相独立、无先后依赖；波三无展开细节（十波都只有骨架行）

## §3 判例底账

**tipping-off 三判例 = 丙全域设计红线**（decisions.md）：

- `:122` [2026-09-14] 客户可见状态**跟着钱走**，无声性靠"与普通业务结局不可区分"，不靠"没有结局"——通知的发与不发、发什么，同受此约束
- `:11` [2026-08-07] 客户端接口层 tipping-off 收口（**响应体仍带真实 status**）缓做，待两域一起对齐——丙动客户端触达面时这条缓办债会撞上
- `:137` [2026-09-26] 对客沟通预审走登记本形态（报送台往来 `CUSTOMER_COMM` kind，MLRO 放行话术），不建独立审批门——三域订单通知的静态话术要不要走同款预审，立纲裁
- 另 `:65` [2026-09-05] 客户真经历过的余额变动必须可见、内部调查信息不外露（划转单不可见但流水行可见）——statements 内容口径的既定立场
- `:88` [2026-09-07] 对账单**弹层**退役（连带 `statementSourceLabel` 死码清除）——退役的是形态不是概念

**空白区**：`披露`（disclosure 义务语义）/`冷静期`/`DSR` 在 decisions 零判例，`披露` 在 modules/ 全目录零命中——立纲全部从零裁，无既定立场可循也无翻案风险。

## §4 演示承接点（demo/script.md 七幕）

- 通知类新场景：承接三幕（钱进）/四幕（钱换）/五幕（钱出）既有客户端环节——通知只是在既有状态变化点上加一层
- statements：承接六幕（账对）客户端流水场景（L187/L190 已示范两行流水文案）
- 披露+确认单：承接四幕（钱换）客户端报价/Confirm and Swap 环节
- tipping-off 对照现场在二幕（Carol/Ivy）与三/五幕（Jack/Grace/Frank"客户面看不出来"）——通知上线后这些场景要补"不发通知/发中性通知"的反面走查
- 第七幕纯管理台零客户端出场；丙若有管理台侧（营销门/DSR 台账）需自开新幕或挂第八/九幕后

## §5 立纲待裁岔口（不代裁，脑暴用）

1. **战场边界**：statements 与 DSR 收编进丙还是判负（BD 盘点点名"否则三役后成无主缺口"）
2. **搁置总纲波一+波三是否捞进丙**：不捞则丙没有实体骨架；捞则搁置总纲 §3 表要标注两波移交
3. **营销审批门归属**：BACKLOG:336 进丙 / 继续挂 / 判组织件
4. **BACKLOG:272 信号+拉取小专项与通知本体的关系**：272 已定案待立 spec（传输层），通知本体是消息层——同波做、分波做、还是 272 独立先行
5. **通知本体形态**：站内消息中心 / 模拟 email 留痕 / 两者——受"演示看得到讲得到"判准约束（真发邮件无依赖也无必要）
6. **通知话术与 tipping-off 的接线**：静态模板话术要不要走 `CUSTOMER_COMM` 同款 MLRO 预审（219 L58 缺口），还是模板本身收敛即够
7. **条款同意落库**：注册页 acceptTerms 前端闸要不要补后端留痕（涉铁律①操作必留痕的边界——客户动作算不算 operator 动作，从零裁）
8. **CRS/CARF 归属**（BD 盘点新发现）：开户采集一段与丙沾边，报送主体在丁——丙立纲时给座位判定即可，不必收编
