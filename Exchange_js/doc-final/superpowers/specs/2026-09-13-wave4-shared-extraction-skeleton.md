# 波四 · 共享抽离（行为零变化）· Spec 骨架

> 总纲：`2026-09-09-acts345-trading-campaign-charter.md` §2 波四。本文件是骨架——波四新会话读总纲 + 下方承接记录后与业主脑暴展开，勿直接当 spec 执行。

## 承接上一波（波三业务红项修复收尾时填写，2026-09-13）

- 波三合并基线 commit：`2cf7ea77`（ff 合入 main；15 commits；主栈 reset+sync+demo:all+coa 收官全绿，后端日志零审计写失败）
- 总纲预告的抽离前提已就绪：`findNonTerminalByOwner` 三域均已带 `correlationId`（波三 A 族）——「三份逐字函数收编」可按修好后的版本收
- **§A 悬案根因已数据层坐实**（2026-09-13 现场取证，证据 `.superpowers/sdd/coa-evidence-20260913/`）：account_flows 落行 id 十六进制未补零（1/16 每 id）→ 字符串 join 读面随机丢行 → 幻影失衡；TB 与镜像双边齐全。BACKLOG §A 已改述。**波四动 deposit↔withdraw 共享面时 demo:all 判红按此秒诊**；修复本体（写镜像补零归一）待业主排期，不自动并入波四
- **留给波四的顺手项**（终审 triage 留档可合并清单，波四动到同文件时顺手清）：
  1. swap-workflow.service.ts 的 CustomerAccessService 双重注入（`customerAccess` :176 / `customerAccessService` :189 同一服务两参数名）——共享抽离动 swap 面时合并成一个
  2. swap-transactions.service.spec 补 `LEG_SETTLEMENT` operator 断言一行（波三 E3 六标签唯一无测试覆盖的）
  3. audit-logs.service.spec mock 行残留 entityType/entityId/entityNo 无效字面量（测试卫生）
  4. deposit-workflow.service.spec 冻结审计断言补 fromStatus/toStatus 两键（恰是 INHERIT 闸 requiredFields）
- **新判例三条**（波三沉淀，写 plan/扫描时用）：
  1. `grep -v` 过滤条件会把双关行滤掉（同行既有目标又有排除词）——普查配方新盲点形态，jest 红灯逮回的
  2. 工具按可见文本点击会命中外层 td 触发行级 onClick——截图器验证格内链接要用无行点击歧义的详情页
  3. 种子人设假设写进 brief 前先查 seed（Frank 的冻结是 demo:all 运行时才有，基础种子 SILENT 持有者是 Carol；Ivy 的 scopes 不含 DEPOSIT）
- **域外债在册待清**（不属波四范围，防误并）：审计证据包导出 deposit/withdraw 链引用 5 个不存在的 Prisma 模型（BACKLOG §H 已登记，措辞见该条）；广播冻结审计无 OWNER subject（BACKLOG 已登记）

## 已定事实（总纲阶段）

- deposit↔withdraw 镜像四件套抽公共底座（SLA / webhook router / kyt-verdict handler / demo 两件）；swap 按结构分叉程度决定接入面
- fee-level 双树合一（24 同名方法、3 对 approval 逐字）；16 个审批薄封装收敛
- 三份逐字函数收编（resolveSlaFields / toCustomerView asset 块 / findNonTerminalByOwner）
- `kyt-txn-type.resolver` 归位共享层
- **明确不动**：三个 workflow 本体（业务分叉真实）；SwapLegAccounting↔DispositionService 双胞胎引擎（业主已裁「合并零收益」）
- 验收：jest 全量 + demo:all 前后逐字一致 + 净减行数

## 待定岔口（脑暴时与业主定）

1. swap 对镜像四件套底座的接入面（无软 SLA、applicant-action 方法名完全不同——接几件）
2. 提现域波三新增的白名单/桶常量（WITHDRAW_CUSTOMER_*）与充值域同名设计是否随「逐字函数收编」一并抽共享（两域第三份镜像件候选）
3. 16 个审批薄封装收敛的形态（工厂/泛型）——总纲注明「收益小、顺手做」，做不做
