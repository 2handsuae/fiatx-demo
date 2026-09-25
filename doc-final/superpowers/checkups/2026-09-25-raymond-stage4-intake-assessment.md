# 同事包收编评估：fiatx stage 4（Raymond，2026-09-24 交付）

> 来源：Lark 群「FiatxPay（VARA审核版）」Raymond 2026-09-24 发的 `fiatx stage 4_raymond0924.zip`（286MB），解压于 `~/Downloads/fiatx-stage4-raymond0924/`
> 方法：三路 sonnet 扫描取数（全景盘点 / 投诉+文档深读 / 通知+LP 深读）→ 主会话抽查复现载重结论 → 主会话判读
> 消费方：战役甲总纲 §5 岔口⑥（投诉→波一/波五）；丙战役底案（文档+通知）；乙战役底案（LP，结论为负）
> **一次性快照，不是活文档**

## 1. 这是什么：我方仓库约 5 月版本的分叉

- **同源坐实**（主会话抽查）：两侧根 `package.json` 的 `name` 均为 `exchange_js`；`customerNo/depositNo/swapNo/withdrawNo` 同一套业务键体系 + `no-generator` 工具；trading 三域模块与 orchestrators 同名同构。
- **分叉点在我方结构改造之前**：我方 6 月后的五次结构级改造——TigerBeetle 账本、funds_orders 三合一、RBAC 13 域 62 桶、audit-logging 重设计、业务键全量收口——**特征物全部不存在**（rbac.catalog.ts / audit-logging 模块 / FundsOrder / tigerbeetle 均零命中，各附搜索命令于扫描留底）；反而保留了我方**已删除**的旧账务设计（Journal/JournalLine/JournalTemplate、Clearing/ClearingLine、Payin/Payout）。
- 包内无 `.git`，无法精确定位分叉 commit。此后他独立演化出"stage 4"：投诉、文档签署、通知体系、Dashboard 磁贴、LP 登记、邮箱/钱包验证等。

## 2. 资产地图（规模：57 model ｜ 21 后端模块 ｜ src 260 文件 36,847 行 ｜ admin 68 页 / client 17 页 ｜ 51 个 spec 多为占位）

| 他的域 | 对我方框架战役的映射 | 一句话 |
|---|---|---|
| Complaint + VerificationEvent | 甲·波五（投诉） | 全生命周期页面齐（admin 10 页），但工程质量差距大（见 §3） |
| DocCategory/Doc/DocLog/DocApproval/CustomerSignature | 丙·协议文档 | **包里成熟度最高的一块**（见 §4） |
| 通知 7 表 + InAppNotification + 模板/分组管理台 | 丙·客户触达 | 信息架构完整，但只有站内信真的通（见 §5） |
| LiquidityProvider/LiquidityConfiguration | 乙·LP 资金流 | **纯登记簿，零资金流动**，对乙无骨架价值（见 §6） |
| Dashboard 磁贴（TileDefinition/布局/59KB 需求文档 v2.7） | 界面糖，暂无对应战役 | 需求文档质量好，留档备用 |

## 3. 投诉域：设计可用，代码不可收编

**设计资产（值得留）**：Complaint↔VerificationEvent 1:1 拆分（投诉单 vs 核实调查单）；10 态生命周期（CREATED→ACKNOWLEDGED→INVESTIGATING→PENDING_APPROVAL→…→CLOSED）；CO 审批概念；里程碑卡片（received/acknowledged/resolve due/solution sent/closed）；`.trae/specs` 里两份流程收敛决策（final-response 单轮化、escalate 走通知文案不进系统）。

**铁律对照（逐条实证，载重三条已主会话复现）**：

| 铁律 | 实测 |
|---|---|
| ①留痕 | **零审计**——service 不接审计，PATCH 改状态/CO 决定/结案全不留痕（本项目有 AuditLogEventService，投诉域没调） |
| ②门不可绕 | **CO 审批是字段不是门**——同一次 PATCH 可同时提单+批准，无 maker≠checker；且 controller **零鉴权**（`UseGuards` 计数=0，✅主会话复现），6 端点含 DELETE 公网裸奔 |
| ④状态沿边走 | **无迁移表**——`currentStatus` 随 `...rest` 透传直写（service:284，✅主会话复现），任意跳 |
| ⑥业务键 | eventId（`CMP-时间戳`）只做展示，寻址全用 UUID |
| SLA | `dueAt` 由**前端**计算提交，后端无任何超期比较/流转；escalate 系统内零实现 |
| 测试 | 两个 `should be defined` 占位 |

**波五消费提示**：他的"escalate 走系统外文案"与我方甲总纲"投诉升级=转事件"是**对撞点**，波五脑暴时拿两案对比拍板。

## 4. 文档/协议域：包里最值得抄设计的一块

**设计资产（丙的协议文档 spec 可直接当底稿）**：分类级 `needSign/multiLang` 开关；版本 `V{major}.{minor}.{patch}.{build}` 自动递增；approve 时同分类+语言旧 effective **自动转 archived**；`CustomerSignature @@unique([userId, docNo, docVersion])` 按版本签署；双签署方法（注册自动签 `registration` / 主动补签 `active_sign`）+ IP 留存；客户端 `useRequireSignatures` 敏感操作前拦截未签用户；submit/approve/reject/archive/立即生效五段流转。

**工程面**：两域中唯一有**显式状态守卫**（approve/reject 校验必须 pending、非法跃迁抛异常）；每次写操作**事务内**落 DocLog（operator/oldStatus/newStatus）。缺口：无自批校验（approver 可 = createdBy）、全项目零 RolesGuard 故管理/客户 JWT 不分、管理侧用 cuid 寻址（客户侧用 docNo 是正面例子）、`pdfUrl` 实为 HTML 预览链接（名不符实）、正文直接存 DB、**零测试**。

## 5. 通知域：架子好看，只有站内信是真的

7 表信息架构完整（事件/模板/多语言内容/收件人规则/分组/发送日志/站内信），管理台四页齐。但实测：**EMAIL/SMS 从不外发**（无任何邮件/短信依赖，只写发送日志且 status 硬编码 'success'）；cron/scheduled 触发是空壳字段；WebSocket 网关与站内信无关（客户端 30 秒轮询）；发送失败不落库不重试；**业务接入只有投诉+合格投资人+模拟器——充值/提现/兑换三域零通知**（他也有跟我们一样的洞）。
**丙的价值**：7 表的信息架构与"事件→模板→收件人规则→发送日志"这条骨架值得参考；渠道实现与业务接线仍要自己做。

## 6. LP 域：对乙没有骨架价值

结论（扫描证据链五条，均附命令留底）：**纯静态登记簿 + 参数 CRUD，零资金流动**——LiquidityConfiguration 无任何消费方（兑换定价走另一套独立的 RateConfig）；Payin/Payout 无 lpId 字段；Clearing 的 LP 对手方分支是**不可达死代码且带 bug**（查询不存在的 `lpNo` 字段、空 catch 吞错）；LP 钱包无人创建。乙战役（LP-IN/OUT 资金单 + 库存水位 + 记账联动）照旧从零设计；仅 LP 名录/配置字段可作参考。

## 7. 佐证质量总评的旁证

他包内自带的 `CODE_OPTIMIZATION_REPORT.md` 与 `critical_issues.md` 自曝：`(this.prisma as any)` 泛滥、全局异常过滤器被注释、测试套件大面积失败（DI 未配置）、60+ 处硬编码 API 地址、前端白屏风险。兑换域状态机为散落 if 任意跳（充值/提现反而有显式迁移表）。

## 8. 结论（三选一 → 乙案：只取设计，重写代码）

1. **代码不融合**。三条理由：①分叉在五次结构改造之前，他的代码建立在我方**已拆除的地基**上（旧账务体系、无 RBAC、无统一审计），逐模块适配成本 ≥ 照设计重写；②铁律差距是**系统性**的（零鉴权、零审计、无状态机、UUID 寻址），不是补丁级；③零可信测试兜底。
2. **设计高价值收编**，三份去向：投诉字段模型+流程决策 → 甲波一（客户类事件参考）与波五 spec 输入；文档签署整套设计 + 通知 7 表架构 → 丙底案；Dashboard 需求文档留档备用。
3. **LP 部分对乙为负结论**，乙从零设计不受影响。

## 9. 风险与待办

- ⚠️ 包内含 `admin_token.txt`（疑似凭据，本评估未读其内容）与多份 `dev.db` 数据库文件——**建议业主确认非生产凭据/敏感数据，并提醒 Raymond 分发包前清理**。
- 包保留在 `~/Downloads/fiatx-stage4-raymond0924/` 供波五/丙期查阅设计；不进本仓库。
- 待办：波五脑暴时对撞"升级=转事件 vs escalate 走文案"两案。
