# 依赖契约状态表——每个外部接口标真假

> 演示者视角的权威表在 `doc-final/demo/simulated-externals.md`；本表是开发视角：**每个外部依赖的结构能信到什么程度、真实契约去哪查**。三档定义——
> **真实**＝真组件真跑，结构与语义全可信 ｜ **忠实模拟**＝报文/契约结构照真实接口，触发时机是遥控的 ｜ **纯占位**＝连结构都别信，只为把流程演下去。

| 依赖 | 状态 | 可信边界 | 代码锚 | 真实契约 |
|---|---|---|---|---|
| TigerBeetle 复式账本 | ✅ 真实 | 真进程、真复式记账、真恒等式——演示的地基。生产可换引擎，但两阶段锁定与逐腿记账语义必须保留（语义合同 S7/S8/S9） | `src/modules/accounting/tigerbeetle/`（`tigerbeetle.service.ts`）；本地生命周期 `scripts/dev-tigerbeetle.sh` | tigerbeetle.com 官方文档 |
| Sumsub 申请人侧（KYC / 入驻 / 档位） | 🎭 忠实模拟 | webhook 报文结构照真实契约；裁决由管理台 ⚡ 面板喂（`SUMSUB_MOCK_MODE=true`）。Alice 挂真沙盒 applicant，其余客户是确定性 mock id | `src/modules/sumsub-applicant-client/sumsub.client.ts`（真实 HTTP 实现）＋ `src/modules/sumsub-ingestion/` | Sumsub Applicant API / webhook 文档 |
| Sumsub KYT（交易监控 / TR） | 🎭 忠实模拟 | HTTP client 按真实契约实现，演示走 mock 替身。**⚠ 切真前有三项合规前提未确认**（规则双类型作用域 / 聚合分桶 / 币种阈值覆盖，见 `PRODUCTION-NOTES.md` 2026-07-31 条），另有 `SUMSUB_SINGLE_TXN_SUBMIT` 过渡开关待收 | `src/modules/sumsub-shared/sumsub-txn-client.http.ts`（真契约）/ `.mock.ts`（替身）＋ 三域 `*-webhook.router.ts` | Sumsub Transaction Monitoring / Travel Rule 文档 |
| 链上（入金信号 / 提现广播 / 确认） | 🎭 纯占位 | 无真实链：txHash 是伪造值（0x 以太坊格式，对 TRON 不真实——登记在案）；确认/失败由模拟端点触发；无确认数、重组、合约失败现实 | ⚡ 面板 ＋ 各域 demo 场景服务 | —（生产接托管方/节点服务时另立契约） |
| 银行（法币入出金） | 🎭 纯占位 | 入账/出账确认由模拟端点触发；「银行对账单」由 `recon:demo` 脚本铸造；IBAN 只有格式校验 | `src/modules/asset-treasury/withdrawal-addresses/bank-validator.util.ts` ＋ recon 脚本 | — |
| 托管方回单（内部划转腿） | 🎭 纯占位（演示装置） | 划转腿一提交，模拟托管方就写外部对账单 OUT/IN 两行并增减当日收盘 | 见 `simulated-externals.md` 托管方行 | — |
| VASP 归属判断（对手方是否 VASP） | 🎭 纯占位 | 当前由客户端弹窗人工勾选（模拟 Sumsub wallet-attribution）；真实应由链上地址归属服务自动得出 | `PRODUCTION-NOTES.md` 2026-07-31「真实 VASP 归属服务未接」条 | Sumsub wallet-attribution |
| 价源（Binance）与 AED 钉住汇率 | 🎭 配置写死 | 无实时行情，价源与汇率随上币配置以版本上架；「按什么价」的语义在客户端报价预览讲清 | 上币配置（`decisions.md` 2026-09-03） | 生产接行情源时另立契约 |
| 时间（SLA / 账龄） | 🎭 可拨钟（演示装置） | 各域「Simulate SLA Timeout」与账龄拨钟把截止时间拨到过去，生产不存在此能力 | ⚡ 面板 | — |

**mock 转真的联动纪律**：任何一行从 🎭 变 ✅，更新本表＋检查语义合同 F4/F5 是否受影响＋在对应 PRD 变更记录里落一行（触碰检查第 ③ 问）。
