# V3 · 财务配置（资产 / 钱包 / 提现地址 / 费率 / 限额 / 定价）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-02（四模块治愈 第一幕六站真人走查复核；底稿 truth 2026-08-13 + 旧 test-cases TC-03/04〔已封箱〕+ 费率定价锚点本轮补核）
> 演示幕次：第一幕「开业」后半 ｜ 验收：第一幕后半走查（`demo/script.md`）+ 本篇 §4
> 注：费率与定价两节为**首次成文**——旧 truth 无此两篇，底稿取自验收用例与代码。

## 0. 一句话定位

管**交易的静态参数**：上什么资产、钱放在哪个物理容器、收多少费、限多少额、按什么价。不管单据怎么流转（V4–V6 的事）、不管客户是谁（V2 的事）。第一幕"开业"的下半场：店铺货架就是在这里摆出来的。

## 1. 业务叙事

最重要的一件事：**交易的每一个参数都有身世——谁配的、谁批的、什么时候生效，都答得上来。** 五样东西各讲一句：

**资产的一生。** 创建的同一笔事务里就把账本科目开好（先有账、后有货）；要上架得过两道就绪检查（账本户齐全 + 至少一个可用钱包），然后由 CISO 批准激活。激活、暂停、恢复是三种独立审批。资产的身份（币种/网络/精度）终身锁定——能改的只有运营开关。

**钱包不是钱。** 钱包只是物理容器的地址：虚拟币在 HexTrust（vault），法币在 Zand（IBAN）。**余额的唯一真相在账本**，钱包表上没有余额。客户收款账户按"客户 × 资产"恒只有一个（重复请求原样复用，总数不变）；平台侧系统钱包（运营/结算/手续费/流动性）受保护，运营停不掉。

**提现地址是资金安全闸。** 新登记的地址要过 24 小时冷却才能用——防的是"账号被盗后立刻把钱提到陌生地址"。唯一例外：**首个法币银行账户登记即生效**，因为它是一切业务的起点（没有它，充值兑换提现全部进不去——这是交易起始的前置门）。客户可以自助停用地址，但最后一个法币地址和有在途提现的地址停不掉。

**费率是有受众的。** 费率等级绑定资产/币对，按金额分档；受众要么是所有人（默认档），要么由谓词圈定（客户标签 + 时间窗——比如"新客 30 天内享优惠档"）。客户拿报价时，系统在他够格的档里**选最便宜的**。改费率走审批，且批准落地那一刻会核对快照：如果现值已被别人改过，这次批准作废——两个人不会互相踩掉对方的修改。

**限额是三种门。** 单笔门（每资产的上下限，原生币种）、累计门（按客户档位 × 日/月，AED 口径）、大额审批门（超阈值的提现要人批）。提现和兑换在**建单之前**就判；充值是被动入金拦不住，只能收下后挂起等处置。

## 2. 状态机

| 主体 | 状态流 |
|---|---|
| 资产 Asset | `PROVISIONING → ACTIVE ⇄ SUSPENDED`（无下架终态；身份字段创建即锁定） |
| 托管钱包 Wallet | `CREATING → ACTIVE ⇄ DISABLED`；外部开立失败 → `FAILED`（系统钱包受保护不可停用） |
| 提现地址 | `PENDING_ACTIVATION →(24h)→ ACTIVE`；冷却内可取消 → `CANCELLED`；管理员可 `SUSPENDED`；客户自助 → `DEACTIVATED`（终态归档） |
| 费率等级 | `PENDING_APPROVAL → ACTIVE`；创建被否决 = **直接删除**（不是置废）；变更走独立请求单（快照守卫） |
| 限额规则 | 创建/变更经审批生效（三种门型行形状锁死，唯一键防重） |

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 资产创建 | 持「资产管理」包（TECH_OFFICER 独有） | **无审批**（同事务开账本户） | 创建≠上架，上架才要批 |
| 资产激活 / 暂停 / 恢复 | 同上 | **CISO** 独立审批 ×3 | 激活前跑两道就绪检查 |
| 费率等级创建 / 变更 | **CFO**（费率包唯一持有者，2026-08-30 起由运营改财务） | **OPS_OFFICER 单步**（48h 时限，未变） | maker≠checker；变更落地过 configHash 快照守卫 |
| 限额规则创建 / 变更 | **OPS_OFFICER**（限额包唯一持有者，未变） | **SENIOR_MANAGEMENT_OFFICER 单步**（2026-08-30 起由运营改高管，解自批死锁） | 落地时 before-vs-current 冲突守卫 |
| 地址跳过冷却 | **金库专员**（提现地址写权限唯一持有者） | 后门端点，**必留审计** | 演示加速用，讲清是后门 |
| 托管钱包创建 | **金库专员**（钱包写权限唯一持有者） | **CISO** 单步 | 站 4「货架」的钱包环节 |
| 客户收款账户停用 / 恢复 | **金库专员**（2026-08-30 起由运营改金库专员，钱放哪归他） | 直接执行（Manage 包） | 系统钱包拒绝停用 |

## 4. 演示脚本（第一幕 · 后半）

管理台 3001，11 职务账号见 `demo/data.md` ｜ 完整 6 站剧本见 `demo/script.md`。本模块对应**站 2「一笔配置要过门」**、**站 4「货架」**、**站 5「三种门与容器」**，此处只补 script.md 未展开的技术细节，不重复整段走查：

1. **站 2 · 费率页**：`cfo@`（财务负责人）给兑换费改一档提交 → `ops_officer@`（运营）批准 → 切客户端拿报价，**费率立刻变**（这条线直通第四幕钱换）
2. **站 4 · 资产页**：看 USDT / AED 的状态与身世 → `tech_admin@` 现场新建一个资产 → 停在 `PROVISIONING`，点激活 → 就绪检查报"缺钱包"——**上架是有门槛的，不是填个表**；换 `treasury@`（金库专员）建一个托管钱包 → 提交审批 → `ciso@` 批准，钱包转 `ACTIVE` → 回资产页再次激活，`ciso@` 批准，资产转 `ACTIVE`
3. **站 5 · 限额页**：三个 tab 各看一眼（单笔 / 累计 / 大额），说清楚三种门在哪一刻拦人 → `ops_officer@` 改一条单笔限额提交 → `sm@`（高管）批准（2026-08-30 起裁决人由运营改高管，解自批死锁）
4. **站 5 · 提现地址**（切客户端）：登记一个新链上地址 → 显示 24h 冷却倒计时 → 用它发起提现 → 被拒；对照：首个法币账户登记即生效（两者成对讲，反差就是重点）
5. **收款账户幂等**（补充走查，不属任何站）：对同一资产重复点创建 → 返回同一个账户，总数不变

## 5. 关键技术节点（≤30 行）

- 资产 `asset-treasury/assets/`：`assets.service.ts` ｜ `asset-activation-workflow.service.ts → checkReadiness()`（两道就绪检查）｜ `asset-provisioning.service.ts → provision()`（同事务开系统级账本户；客户级科目首笔交易懒解析，见 accounting-coa 篇）
- 钱包 `asset-treasury/wallets/`：`wallet-role-policies.constant.ts`（角色×ownerType 策略）｜ `system-wallet.util.ts`（系统钱包解析；C_MAIN/C_OUT 已退役）
- 提现地址 `asset-treasury/withdrawal-addresses/`：`withdrawal-address.service.ts → COOLING_PERIOD_HOURS=24 / createBankAccount()`（首法币免冷却判定）/ `deactivate()`（两道停用守卫）｜ `withdrawal-address-workflow.service.ts → registerAddress()`（crypto 登记的法币前置门）｜ `withdrawal-address-sweep.service.ts`（@Cron 每 5 分钟 + 查询前懒激活双机制）
- 限额 `asset-treasury/transaction-limits/`：`transaction-limit-rules.service.ts`（三门型 CRUD + 唯一预检）｜ `transaction-limit-gate.service.ts → evaluate()`（L1 引擎，提现/兑换建单前调）｜ `transaction-limit-rule-workflow.service.ts`（审批）｜ 种子 `seed.business.ts → seedTransactionLimitRules()`
- 费率（两族同构）`trading/{swap,withdrawal}-fee-level/`：`*-fee-level.service.ts` ｜ `*-creation-workflow` / `*-change-workflow`（+配对 approval 发射器）｜ 受众判定 `trading/shared/fee-audience.util.ts`（effectiveTags 求值 + resolveBestLevel 最便宜档）｜ 报价 `swap-quote.service.ts` / `withdraw-quote.service.ts`
- 定价 `trading/pricing-center/`：`pricing-engine.service.ts`（报价价源）
- 前端引导 `client-web`：`AuthGuard.tsx`（就绪门渲染 `TradingStartGuide.tsx`；路径匹配须段边界，防 `/withdraw` 误吞 `/withdrawal-addresses` 白屏）｜ `WithdrawalAddresses.tsx`（锁 Crypto tab 强制先加法币）
- 审计留痕：本域全部写点（资产/钱包/提现地址/限额/费率/客户标签，约 60 个写点）已随 V1 换名册四批入 `audit-actions.constant.ts` 合同（`domain: 'CONFIG'`，四属性齐备）——第一幕改的费率/限额那笔配置变更，第七幕按单号能查到；此前"V3 词汇未入册"的缺口已解，详见 `v1-governance.md` §5

## 6. 演示缺口（BACKLOG 有账）

- **资本注入流水缺一笔凭证**：公司自有资金注入在账本流水里少一行 evidence——第六幕对账讲公司户时会被问到
- **充值累计限额未接**：三种门里的累计门（B 档）对充值方向尚未消费——限额页讲三门时说明"充值只接了单笔下限（小额挂起）"
- **报价未落资格快照 / 费率 30 日历日生效闸未做**：改费率即刻生效，无"提前 30 天通知客户"的缓冲（合规应然，待决策）
- **费率与定价无 truth 前史**：本篇即第一份现状记录；定价中心只有引擎一件，价格配置的管理面待补篇幅
- 待决策两项：金额闸门矩阵扩展、费率变更通知客户方式

（提现建单不校验地址状态属安全加固类，已入 PRODUCTION-NOTES，不在演示缺口列。）
