# 对手方波一 · 收尾闸证据（2026-10-22）

> worktree `counterparty-wave1-address-book`，branch `worktree-counterparty-wave1-address-book`，栈端口 3100-3103。
> plan：`superpowers/plans/2026-10-22-counterparty-wave1-withdrawal-address-plan.md` Task 11。

## 随手闸（HEAD 上一次性连跑，exit 0）

- ① `npx tsc --noEmit -p tsconfig.json` → GATE1_PASS
- ② `cd admin-web && npx tsc -b --noEmit` → GATE2_PASS
- ③ `cd client-web && npx tsc -b --noEmit` → GATE3_PASS
- ④ `npx jest src/modules/asset-treasury/withdrawal-addresses src/modules/audit-logging` → 14 suites / **261 passed**
- `npm run test:client` → 12 files / **142 passed**

## 收尾闸

- ⑧ 重铺：`bash scripts/stack.sh reset self` → exit 0；`stack.sh up self` 三端口 200
- ⑥ `bash scripts/on-stack.sh self demo:all` → `DONE ✅ (all asserts pass)`，花名册 29/29、COA 四恒等式、`data.md 生成区已更新` 且 `git diff doc-final/demo/data.md` 零 diff
- `verify:act1` → **全绿 ACT1_PASS**（API_BASE=3100 显式首跑）。裸跑曾红：`.stackports` 路径两级爬升残留（压平前遗留）误落 3000——修复 `39fcb10f` 后裸跑 `API base: http://localhost:3100`、8 探针登录通，23/24（唯一红=首跑已占 alice 名额的数据态，预期）
- `verify:rbac` → 共 1 FAIL = S7 四行 sumsub demo 死行 = TOOLING-DEBT 既有基线红集**恒等**，零新增红；本波新路由 simulate-screening 被 S7 认活（确认行已追加进 TOOLING-DEBT 该条目）
- `verify:demo-data` → PASS（干净库）；**R5 失效验证**：UPDATE 一行 `WITHDRAWAL_ADDRESS_SEEDED` 审计 actorNo → 复跑 R5=1 精确点名 `WA2601016008` → 还原复跑回绿
- 种子点数：`withdrawal_addresses` traceId 前缀计 **11** 行（10 ACTIVE + 1 REJECTED）
- ⑦ verify:coa 不触发（本波不动钱）

## 走查实录（preview 3101/3102，截图在会话内逐步留存）

1. 客户端表单：Beneficiary 单选（默认 Myself）+ Wallet hosting 单选（必选无默认）；Third party 展开姓名+关系两必填 ✓
2. 拍 d：alice 登记第三方地址（Wang Fang · Sibling）→ THIRD PARTY 徽标 + 直接进冷却（ATTESTATION 即落定）✓
3. 拍 e·红旗+签名：alice 登记尾号 1111 自报 Self-custody → 停 Pending verification + Signature needed；详情「Verify wallet signature」mock 即过 → Cooling，**倒计时自签名时刻起算**（12:09:38）✓；名额 3/3 封顶提示（PENDING_VERIFICATION 占坑）✓
4. 拍 e·3333：bob 登记尾号 3333 → 提交成功、列表当场 **Not approved**、名额仍 1/3（REJECTED 不占坑）✓；客户面零筛查内情 ✓
5. 管理台：列表 Owner 列（Self/Third party）+ 两新态徽标；jack 种子 REJECTED 展品、kate 第三方 ACTIVE 在列 ✓
6. 管理台详情（1111 条目）：Attribution（VASP/Mock VASP Exchange/DID）＋ **红旗警示条**（Declared Self-Custody ≠ attributed VASP, flag only）＋ Beneficiary（Evidence=Wallet signature + Verified 时刻）＋ Screening（GREEN 徽+时刻）✓
7. ⚡覆写：compliance_lead 对冷却中条目 Feed RED（reason 必填）→ 绿条提示 + 刷新后 REJECTED、⚡区随 pending 消失 ✓（金库不持 DEMO_VERDICT_WRITE 看不见该区，RBAC 交叉同设计）
8. **第二幕回归拍**：现场注册 `demo_wave1_check@example.com` → 条款抽屉拉到底才可勾 → gate 页 Start verification → 五字段 CDD（姓名预填）→ 提交 IN VERIFICATION → compliance_lead ⚡Approve(GREEN) → **ACTIVE（直通不经人审）** → 首个法币账户用魔法 IBAN `AE…2222`（筛查 YELLOW）→ **即时 Active**（YELLOW 放行 + 首法币规则 + RED-才拦三者相互印证）→ Overview 交易门解锁（gate 横幅消失）✓

## 走查撞见

- 存量死链：Profile「Continue verification」→ 裸 `/verification` 空白页（路由只有 `/verification/:requestNo`）——BACKLOG 已登，本波零触碰该文件
- 走查后本 worktree 栈数据已被练手污染（alice/bob/新客的走查条目）——演示前照规矩重铺即可
