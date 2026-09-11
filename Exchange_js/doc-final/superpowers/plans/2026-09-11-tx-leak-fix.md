# 开机铺数据偶发失败修复（事务漏传 + 种子撞号）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 云端 2 核服务器每次开机从零铺数据都成功——补齐 8 处"事务里调别的服务没把事务带下去"，并让种子留痕撞号时换号。

**Architecture:** 按 `rules/backend.md:18` 既有惯例把事务句柄沿调用链传下去：被调方已有可选 tx 就在调用处传入，没有就补一个可选参数，函数体 `const client = tx ?? this.prisma`，不传时行为逐字不变。验收用"连接池限 1 条"（`DATABASE_URL?connection_limit=1`）把漏传从偶发变必现，本机、云端各跑一次；最终以云端默认配置连续开机 10 次 10/10 为准。

**Tech Stack:** NestJS + Prisma 5.22 + SQLite；TigerBeetle 0.17.3；jest 30（ts-jest）；bash（脚本兼容 macOS bash 3.2，Bash 工具外壳是 zsh）。

**Spec:** `doc-final/superpowers/specs/2026-09-11-tx-leak-fix-design.md`（业主 2026-09-11 批准）。

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用（本任务命中：改了交易三域 / 动了钱 / 改了种子 / 每轮收尾——见 spec §4 末段）。
- 本轮特有：
  - **只有一种改法**：事务回调里、以及拿到事务的函数里，每一次读写库都走这个事务。被调方已有可选事务参数 → 调用处补传；被调方没有 → 按 `backend.md:18` 补一个可选参数（照该文件现有写法：`tx?: Prisma.TransactionClient`，或文件里惯用的 `client?: any` / `tx?: Record<string, any>`），函数体 `const client = tx ?? this.prisma`。**不传时行为与现在逐字一致**，事务外的调用方一行不改。
  - **不动**：事务边界（哪些写在同一个事务里）、调用顺序、审计写在事务内还是事务后（失败结局的审计本来就在事务结束后写，如 `swap-workflow.service.ts:497`、`approvals.service.ts` 的 `recordSoDDenied`）、业务规则、状态机、记账口径。
  - **不做**：加锁、加重试、改超时 / 连接池 / SQLite 模式、抽公共 helper、合并重复代码、顺手改无关注释、事务外的调用也改成传事务、事务里 `emit` 出去的广播、其它单号生成器。
  - **测试**：不新增"调用时带了 tx"这类 mock 断言（测写法不测行为）；旧断言只因新增的尾参数而失败的，按新签名更新（把 tx 参数加进期望），不改测试逻辑。
  - **种子撞号**：撞 `eventNo` 唯一约束就换号再写，上限 10（= `AuditLogsService.MAX_NO_RETRIES`），其它错误照旧抛出。
  - **环境**：每条 node / npm / npx / jest / tsc / prisma 命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`（本机默认 node18）；jest 在 `Exchange_js/` 下跑，先 `export DATABASE_URL=file:/tmp/exchange_js_wt_cloud_deploy/dev.db`（部分 spec 直连 Prisma，缺它假红）；退出码不隔着管道取，用 `cmd > log 2>&1; echo EXIT=$?`。
  - **git**：只 `git add <具名文件>`；不 `git stash`；提交信息不加署名行；前缀 `fix(事务)`。所有命令（含 git）在 worktree 的 `Exchange_js/` 下执行，文中路径都相对它。
  - **栈**：子代理不启停 / 重置任何栈、不跑 `on-stack.sh` / `stack.sh` / `cloud-*` 脚本——探测、闸门、云端验收由主会话跑。主会话只碰本 worktree 的 self 栈（3100–3103、`/tmp/exchange_js_wt_cloud_deploy/`），绝不碰 main（3000–3003）。

## 项目要点（派子代理时随 prompt 带上；CLAUDE.md §0–§5 摘要）

- 虚拟币 / 法币 broker-dealer **演示系统**，观众是同事；不是生产系统，不追求健壮性。
- 禁做：幂等、去重、重试与回放、补偿与 repair、并发锁、向后兼容层、管理 API 权限加固、输入防御性校验、性能优化、边界防御、为让测试通过而修测试框架。
- 允许的假设：单人顺序操作；外部系统准时回调且只回一次；数据随时可重铺。
- 六条铁律：操作必留痕（审计）；门不可绕（onboarding / 合规 / maker-checker）；各管各的（主体只写自己的表，跨主体只在 workflow）；状态只能沿迁移表的边走；钱动必过账（资金单镜像 + 账本分录，记账失败即流程失败）；对外用业务单号。
- 本任务不改任何一条铁律涉及的行为：只是让已有的读写走它本该走的那个事务。

## 文件地图

| 文件 | 改什么 | 任务 |
|---|---|---|
| `src/modules/asset-treasury/wallets/wallet-query.service.ts` | `hasReceivingAccount` 补 `tx?`（A） | 2 |
| `src/modules/funds-layer/domain/system-wallet-resolver.service.ts` | `networkOf` / `resolve` / `resolveCustomer` 补 `tx?`（B） | 2 |
| `src/modules/accounting/tigerbeetle/accounting.service.ts` | `resolveTbAccountId` 补 `tx?`，传给登记表（C、G） | 2 |
| `src/modules/trading/swap-transactions/swap-leg-accounting.ts` | `resolveAcct` / `resolveWallet` / `walletRefForCode` / `resolveLegWalletRefs` / `resolveLegWallets` 补 `client?`；`initiateLegPending` 传入（B、C） | 2 |
| `src/modules/identity/customers/customer-restrictions.service.ts` | `listOpen` 补 `tx?`（D） | 2 |
| `src/modules/identity/customers/customer-access.service.ts` | `resolve` 补 `tx?`（D） | 2 |
| `src/modules/trading/swap-transactions/swap-workflow.service.ts` | `:399`、`:1475`、`:1617`、`:1623` 传事务；`assertSwapCustomerAccessOrHalt` 补 `client?` 并传给四处（A、B、D、E） | 2 |
| `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` | `:510`、`:516` 传 `tx`（G） | 2 |
| `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts` | 只因新尾参数失败的断言按新签名更新 | 2 |
| `src/modules/governance/approvals/approval-policy.service.ts` | `isSameUserMakerCheckerDenied` 补 `tx?`（F） | 3 |
| `src/modules/governance/approvals/approvals.service.ts` | `resolveDecisionRole` 补 `tx?`，`approve` / `reject` 传入（F） | 3 |
| `src/modules/identity/customers/customer-restriction-workflow.service.ts` | `audit()` 里 `:358` 改用传进来的 `tx`（H） | 3 |
| `prisma/seed-audit.helper.ts` | 撞 `eventNo` 换号再写（种子撞号） | 3 |
| `scripts/seed-audit-helper.spec.ts`（新建） | 种子撞号的行为测试（放 `scripts/`：jest 的 `roots` 不含 `prisma/`，见 `jest.config.js:33`） | 3 |
| `doc-final/rules/backend.md` | `:18` 下补一条子项 | 4 |
| `doc-final/superpowers/specs/2026-09-11-cloud-demo-deploy-design.md` | §2 / §8 / §10 改正归因、加例外 | 4 |
| `doc-final/PRODUCTION-NOTES.md` | 撤回子代理未提交的那一行 | 4 |

主会话脚本（不入库，放本会话 scratchpad `/private/tmp/claude-501/-Users-songshengwei-Documents-codex-projects----/a1d8a3d6-ac5e-4b85-ba07-ad759fb0c26d/scratchpad/`，下称 `$SCR`）：`txleak-detector.sh`（Task 1）、`txleak-gates.sh`（Task 4）、`txleak-cloud.sh`（Task 5）。

---

### Task 1（主会话执行）：本机探测器 + 修前复现红

**Files:** Create `$SCR/txleak-detector.sh`（不入库）

**Interfaces:**
- Produces：`bash $SCR/txleak-detector.sh` → 末行 `DETECTOR: PASS — …` 退出 0，或 `DETECTOR: FAIL — …` 退出 1；日志在 `$SCR/txleak-run/`（`reset.log` / `build.log` / `api.log` / `demo-all.log` / `recon.log`）。Task 2 之后、Task 4 里复用。

为什么这样搭：`demo:all` 与 `verify:rbac` 按 `<worktree>/.stackports`（本树 = 3100）找后端，不能另开端口，所以借用 self 栈：`stack.sh reset self` 从零重铺（种子不开事务——`prisma/` 下 0 处 `$transaction`——所以种子不带探测参数），再用探测参数起后端、跑 `demo:all` 与 `recon:demo:break`。`RECON_DEMO_MANIFEST_PATH` 显式指到 self 目录（默认值指向 main 的 tmp，见 TOOLING-DEBT 已登记条目）。

- [ ] **Step 1：写探测脚本**

```bash
#!/usr/bin/env bash
# txleak-detector.sh — 本机"连接池限 1 条"探测（tx-leak spec §4 第 1 条）。
# self 栈从零重铺（种子不开事务，不带探测参数）→ 后端与 demo:all / recon:demo:break 都用
# DATABASE_URL?connection_limit=1。事务里有漏传 → 5 秒后必现 P2028 → FAIL。
# 只碰本 worktree 的 self 栈（3100–3103、/tmp/exchange_js_wt_cloud_deploy/）。退出码 0=PASS，1=FAIL。
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"

WT=/Users/songshengwei/Documents/codex/projects/重做版/.claude/worktrees/cloud-deploy
EJ="$WT/Exchange_js"
SELF=/tmp/exchange_js_wt_cloud_deploy
DB_URL="file:$SELF/dev.db?connection_limit=1"
API_PORT=3100
TB_ADDRESS=127.0.0.1:3103
TB_DATA_FILE="$SELF/0_0.tigerbeetle"
OUT=/private/tmp/claude-501/-Users-songshengwei-Documents-codex-projects----/a1d8a3d6-ac5e-4b85-ba07-ad759fb0c26d/scratchpad/txleak-run
API_PID=""
mkdir -p "$OUT"
cd "$EJ" || exit 1

DATAMD=Exchange_js/doc-final/demo/data.md
DATAMD_WAS_CLEAN=0
[[ -z "$(git -C "$WT" status --porcelain -- "$DATAMD")" ]] && DATAMD_WAS_CLEAN=1

finish() {   # $1 = PASS|FAIL，$2 = 说明
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null
  if [[ "$DATAMD_WAS_CLEAN" == 1 && -n "$(git -C "$WT" status --porcelain -- "$DATAMD")" ]]; then
    git -C "$WT" checkout -- "$DATAMD"
  fi
  echo "P-codes: $(grep -ohE 'P[0-9]{4}' "$OUT"/*.log 2>/dev/null | sort | uniq -c | tr '\n' ' ')"
  echo "DETECTOR: $1 — $2"
  if [[ "$1" == PASS ]]; then exit 0; fi
  exit 1
}

[[ "$(tr -dc '0-9' < "$WT/.stackports")" == "$API_PORT" ]] || finish FAIL ".stackports 不是 $API_PORT"

echo "[1/5] 从零重铺 self 栈（先删 dev.db：reset 不清 audit_log_events）"
rm -f "$SELF/dev.db" "$SELF/dev.db-journal"
bash scripts/stack.sh reset self > "$OUT/reset.log" 2>&1 || finish FAIL "reset self（$OUT/reset.log）"

echo "[2/5] 编译后端（本 worktree 的 dist/，与 self 栈同一处）"
npm run -s build > "$OUT/build.log" 2>&1 || finish FAIL "build（$OUT/build.log）"

echo "[3/5] 起后端：探测模式，端口 $API_PORT"
lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN > /dev/null 2>&1 && finish FAIL "端口 $API_PORT 已被占用"
API_PORT="$API_PORT" DATABASE_URL="$DB_URL" TB_ADDRESS="$TB_ADDRESS" node dist/main > "$OUT/api.log" 2>&1 &
API_PID=$!
up=0
for _ in $(seq 1 120); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$API_PORT") 2>/dev/null; then up=1; break; fi
  sleep 1
done
[[ "$up" == 1 ]] || finish FAIL "后端 120 秒没起来（$OUT/api.log）"

echo "[4/5] demo:all（探测模式）"
DATABASE_URL="$DB_URL" TB_ADDRESS="$TB_ADDRESS" TB_DATA_FILE="$TB_DATA_FILE" npm run -s demo:all > "$OUT/demo-all.log" 2>&1
ec=$?
if [[ "$ec" != 0 ]] || ! grep -q 'demo:all DONE ✅' "$OUT/demo-all.log"; then
  grep -m1 -A25 'FATAL' "$OUT/demo-all.log"
  finish FAIL "demo:all exit=$ec（$OUT/demo-all.log）"
fi

echo "[5/5] recon:demo:break（探测模式）"
DATABASE_URL="$DB_URL" TB_ADDRESS="$TB_ADDRESS" TB_DATA_FILE="$TB_DATA_FILE" \
  RECON_DEMO_MANIFEST_PATH="$SELF/recon-demo-manifest.json" \
  npm run -s recon:demo:break > "$OUT/recon.log" 2>&1
ec=$?
eq() { [[ "$1" =~ ([0-9]+)/([0-9]+) ]] && [[ "${BASH_REMATCH[1]}" == "${BASH_REMATCH[2]}" ]] && (( BASH_REMATCH[2] > 0 )); }
sc="$(grep -oE 'scenarios: [0-9]+/[0-9]+ DETECTED' "$OUT/recon.log" | tail -1)"
wl="$(grep -oE 'wallets: +[0-9]+/[0-9]+ bucket OK' "$OUT/recon.log" | tail -1)"
co="$(grep -oE 'casesOpened [0-9]+/[0-9]+' "$OUT/recon.log" | tail -1)"
if [[ "$ec" != 0 ]] || ! eq "$sc" || ! eq "$wl" || ! eq "$co" || grep -qE '^ *BAD ' "$OUT/recon.log"; then
  finish FAIL "recon exit=$ec sc='$sc' wl='$wl' co='$co'（$OUT/recon.log）"
fi
finish PASS "demo:all DONE ✅ · $sc · $wl · $co"
```

- [ ] **Step 2：修前跑一次，必须红**

Run: `bash $SCR/txleak-detector.sh > $SCR/txleak-red.log 2>&1; echo EXIT=$?`
Expected: `EXIT=1`，末行 `DETECTOR: FAIL — demo:all …`，FATAL 块里是 `Transaction already closed … 5000 ms`（P2028），栈指向 `swap-workflow.service.ts` 的 `initiateSwap`（`:372` 事务、`:399` 漏传；报错行可能显示为同一循环下一轮的 `:395`）。**若不红**：探测器本身不成立，停下查原因，不进 Task 2。

- [ ] **Step 3：记台账**

在 `.superpowers/sdd/progress.md` 追加一行：`tx-leak Task 1: detector red on HEAD <sha7>（<FATAL 首行>）`。

---

### Task 2：兑换 / 提现下单与推腿不再卡死（开机主路 6 处病根：A、B、C、D、E、G）

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallet-query.service.ts:1-3, 25-31`
- Modify: `src/modules/funds-layer/domain/system-wallet-resolver.service.ts`（全文件，47 行）
- Modify: `src/modules/accounting/tigerbeetle/accounting.service.ts:399-405`
- Modify: `src/modules/trading/swap-transactions/swap-leg-accounting.ts:79-88, 138-150, 169-219, 243-251, 304-306`
- Modify: `src/modules/identity/customers/customer-restrictions.service.ts:358-364`
- Modify: `src/modules/identity/customers/customer-access.service.ts:1-2, 77-86`
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:399, 1475, 1617, 1623, 1780-1794`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:510-520`
- Test: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`（只改因新尾参数失败的断言）

**Interfaces:**
- Consumes：已有 `TbAccountRegistryService.resolve(params, tx?: Prisma.TransactionClient)`、`FundsOrderService.findById(id, tx?)`、`SwapTransactionsService.setNeedsReview(id, flag, tx?)`、`SwapWorkflowService.swapAudit(swap, input, client?)`。
- Produces（Task 3 不依赖，但后续调用方可用）：
  - `WalletQueryService.hasReceivingAccount(customerId: string, network: string, tx?: Prisma.TransactionClient): Promise<boolean>`
  - `SystemWalletResolver.resolve(assetId: string, vaultCode: string, tx?: Prisma.TransactionClient)`、`resolveCustomer(assetId: string, walletRole: string, ownerId: string, tx?: Prisma.TransactionClient)`
  - `AccountingService.resolveTbAccountId(params, tx?: Prisma.TransactionClient): Promise<bigint>`
  - `SwapLegAccounting.resolveLegWallets(spec, ctx, client?: any)`
  - `CustomerRestrictionsService.listOpen(customerId: string, tx?: Record<string, any>)`
  - `CustomerAccessService.resolve(customerId: string, tx?: Prisma.TransactionClient): Promise<CustomerAccess>`

这组改动的"失败测试"是 Task 1 的探测器（修前必红）；单测只做回归。

- [ ] **Step 1：A——`wallet-query.service.ts`**

第 1 行后加一行导入：

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
```

`:25-31` 换成：

```ts
  /** R4：客户在该网络上有没有 ACTIVE 的收款行（CLIENT_DEPOSIT vault） */
  async hasReceivingAccount(customerId: string, network: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const client = tx ?? this.prisma;
    const n = await client.wallet.count({
      where: { ownerType: 'CUSTOMER', ownerId: customerId, vaultCode: 'CLIENT_DEPOSIT', network, status: 'ACTIVE' },
    });
    return n > 0;
  }
```

- [ ] **Step 2：B 末端——`system-wallet-resolver.service.ts` 全文件换成**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

/** 钱包行按网络而非资产挂——同一条链上的所有币共用一个地址（HexTrust：一 vault 一链一地址）。
 *  调用方仍传 assetId（资金单上记的是资产），这里先取资产的 network 再找行。 */
@Injectable()
export class SystemWalletResolver {
  constructor(private readonly prisma: PrismaService) {}

  private async networkOf(assetId: string, tx?: Prisma.TransactionClient): Promise<{ network: string; code: string }> {
    const client = tx ?? this.prisma;
    const asset = await client.asset.findUnique({ where: { id: assetId }, select: { network: true, code: true } });
    if (!asset) throw new BadRequestException({ code: 'ASSET_NOT_FOUND', message: `Asset ${assetId} not found` });
    return asset;
  }

  /** ACTIVE platform 地址行（F_OPS / F_SET / F_FEE / F_LIQ）for the asset's network */
  async resolve(assetId: string, vaultCode: string, tx?: Prisma.TransactionClient) {
    const asset = await this.networkOf(assetId, tx);
    const wallet = await ((tx ?? this.prisma) as any).wallet.findFirst({
      where: { vaultCode, network: asset.network, ownerType: 'PLATFORM', ownerNo: 'PLATFORM', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!wallet) {
      throw new BadRequestException({
        code: 'SYSTEM_WALLET_NOT_FOUND',
        message: `No ACTIVE ${vaultCode} platform wallet on network ${asset.network} (asset ${asset.code})`,
      });
    }
    return wallet;
  }

  /** ACTIVE customer 收款行（C_DEP / C_VIBAN）for owner + the asset's network */
  async resolveCustomer(assetId: string, walletRole: string, ownerId: string, tx?: Prisma.TransactionClient) {
    const asset = await this.networkOf(assetId, tx);
    const wallet = await ((tx ?? this.prisma) as any).wallet.findFirst({
      where: { vaultCode: 'CLIENT_DEPOSIT', walletRole, network: asset.network, ownerType: 'CUSTOMER', ownerId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!wallet) {
      throw new BadRequestException({
        code: 'CUSTOMER_WALLET_NOT_FOUND',
        message: `No ACTIVE ${walletRole} wallet for customer ${ownerId} on network ${asset.network} (asset ${asset.code})`,
      });
    }
    return wallet;
  }
}
```

- [ ] **Step 3：C / G 共用——`accounting.service.ts:399-405`**

```ts
  async resolveTbAccountId(params: {
    code: number;
    ledger: number;
    ownerType: string;
    ownerUuid?: string;
  }): Promise<bigint> {
    const entry = await this.registryService.resolve(params);
```

换成（`Prisma` 已在本文件第 3 行导入；方法其余部分不变）：

```ts
  async resolveTbAccountId(
    params: {
      code: number;
      ledger: number;
      ownerType: string;
      ownerUuid?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<bigint> {
    const entry = await this.registryService.resolve(params, tx);
```

- [ ] **Step 4：B、C 中段——`swap-leg-accounting.ts`**（本文件事务参数惯用名是 `client: any`）

`:79-88` 换成：

```ts
  private async resolveAcct(
    code: number,
    ledger: number,
    ownerId: string,
    client?: any,
  ): Promise<bigint> {
    if (code === TB_ACCOUNT_CODES.CLIENT_PAYABLE) {
      return this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'CUSTOMER', ownerUuid: ownerId }, client);
    }
    return this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' }, client);
  }
```

`:138-150` 换成：

```ts
  private async resolveWallet(assetId: string, role: string, ownerId: string, client?: any): Promise<string | null> {
    try {
      const customerRoles = ['C_DEP', 'C_VIBAN'];
      if (customerRoles.includes(role)) {
        const w = await this.wallets.resolveCustomer(assetId, role, ownerId, client);
        return w?.id ?? null;
      }
      const w = await this.wallets.resolve(assetId, role, client);
      return w?.id ?? null;
    } catch {
      return null;
    }
  }
```

`walletRefForCode`（`:169-208`）：签名加第 5 个参数 `client?: any`，函数体里三处 `this.resolveWallet(...)` 末尾都加 `, client`：

```ts
  private async walletRefForCode(
    code: number,
    counterpartCode: number,
    spec: SwapLegSpec,
    ctx: SwapSettleCtx,
    client?: any,
  ): Promise<string | null> {
```

```ts
      return this.resolveWallet(assetId, customerRole, ctx.ownerId, client);
```

```ts
      return this.resolveWallet(assetId, equityRoleMap[code], ctx.ownerId, client);
```

```ts
      return this.resolveWallet(assetId, equityRoleMap[counterpartCode], ctx.ownerId, client);
```

`resolveLegWalletRefs`（`:211-219`）换成：

```ts
  private async resolveLegWalletRefs(
    a: LegAccounting,
    spec: SwapLegSpec,
    ctx: SwapSettleCtx,
    client?: any,
  ): Promise<{ debitWalletRef: string | null; creditWalletRef: string | null }> {
    const debitWalletRef = await this.walletRefForCode(a.debitCode, a.creditCode, spec, ctx, client);
    const creditWalletRef = await this.walletRefForCode(a.creditCode, a.debitCode, spec, ctx, client);
    return { debitWalletRef, creditWalletRef };
  }
```

`resolveLegWallets`（`:243-251`）换成：

```ts
  async resolveLegWallets(
    spec: SwapLegSpec,
    ctx: SwapSettleCtx,
    client?: any,
  ): Promise<{ fromWalletId: string | null; toWalletId: string | null }> {
    const assetId = spec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;
    const fromWalletId = await this.resolveWallet(assetId, spec.fromRole, ctx.ownerId, client);
    const toWalletId = await this.resolveWallet(assetId, spec.toRole, ctx.ownerId, client);
    return { fromWalletId, toWalletId };
  }
```

`initiateLegPending` 里 `:304-306` 换成：

```ts
      const debitId = await this.resolveAcct(a.debitCode, ledger, ctx.ownerId, client);
      const creditId = await this.resolveAcct(a.creditCode, ledger, ctx.ownerId, client);
      const { debitWalletRef, creditWalletRef } = await this.resolveLegWalletRefs(a, spec, ctx, client);
```

- [ ] **Step 5：D 末端——`customer-restrictions.service.ts:358-364`**（本文件事务参数惯用 `tx?: Record<string, any>`，照 `findByNo` 的写法）

```ts
  /** @param tx 传了就用它读（事务里查客户能力时用，见 CustomerAccessService.resolve），不传照旧读事务外的 base client。 */
  async listOpen(customerId: string, tx?: Record<string, any>): Promise<RestrictionRow[]> {
    const client = (tx ?? this.prisma) as Record<string, any>;
    const rows = await client.customerRestriction.findMany({
      where: { customerId, status: 'OPEN' },
      orderBy: [{ openedAt: 'desc' }, { scope: 'asc' }],
    });
    return this.toRows(rows);
  }
```

- [ ] **Step 6：D 中段——`customer-access.service.ts`**

第 1 行后加 `import { Prisma } from '@prisma/client';`。`:77-86` 换成（函数其余部分不变）：

```ts
  async resolve(customerId: string, tx?: Prisma.TransactionClient): Promise<CustomerAccess> {
    const client = tx ?? this.prisma;
    const customer = await client.customerMain.findUnique({
      where: { id: customerId },
      select: { id: true, customerNo: true, lifecycle: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const openRows = await this.restrictionsService.listOpen(customerId, tx);
```

若 tsc 不接受把 `Prisma.TransactionClient` 传给 `Record<string, any>`，只在这一处写成 `listOpen(customerId, tx as Record<string, any> | undefined)`，别处不动。

- [ ] **Step 7：A、B、D、E 调用点——`swap-workflow.service.ts`**

`:399`：

```ts
          if (!(await this.walletQuery.hasReceivingAccount(ownerId, assetRow?.network ?? '', tx))) {
```

`:1475`：

```ts
    const { fromWalletId, toWalletId } = await this.swapLegAccounting.resolveLegWallets(spec, ctx, tx);
```

`:1617`：

```ts
    if (!(await this.assertSwapCustomerAccessOrHalt(swap, 'leg-confirmed', client))) return;
```

`:1623`：

```ts
    const legFo = await this.fundsOrders.findById(event.fundsOrderId, client);
```

`:1780-1794` 换成（`:1866` 在事务外的那次调用保持不传）：

```ts
  private async assertSwapCustomerAccessOrHalt(swap: any, stage: string, client?: any): Promise<boolean> {
    const access = await this.customerAccessService.resolve(swap.ownerId, client);
    if (!access.blocked.has('SWAP')) return true;

    this.logger.warn(
      `Swap capability gate FAIL at ${stage}: swap ${swap.swapNo} — SWAP blocked → halting leg progression`,
    );
    await this.swapTransactionsService.setNeedsReview(swap.id, true, client).catch(() => undefined);
    await this.swapAudit(swap, {
      action: 'SWAP_LEG_HALTED_BY_RESTRICTION',
      reason: `Customer SWAP capability restricted at ${stage} — in-flight swap leg progression halted`,
      metadata: { stage },
    }, client);
    return false;
  }
```

- [ ] **Step 8：G——`withdraw-workflow.service.ts:510-520`**

```ts
            const clientPayableId = await this.accountingService.resolveTbAccountId({
              code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
              ledger,
              ownerType: 'CUSTOMER',
              ownerUuid: userId,
            }, tx);
            const clientAssetId = await this.accountingService.resolveTbAccountId({
              code: TB_ACCOUNT_CODES.CLIENT_ASSET,
              ledger,
              ownerType: 'SYSTEM',
            }, tx);
```

- [ ] **Step 9：确认没有漏掉的调用点**

Run（在 `Exchange_js/` 下）：

```bash
grep -rn --include='*.ts' --exclude='*.spec.ts' -e "hasReceivingAccount(" -e "resolveLegWallets(" -e "resolveLegWalletRefs(" -e "walletRefForCode(" -e "resolveWallet(" -e "resolveAcct(" -e "assertSwapCustomerAccessOrHalt(" src
```

Expected：事务里的调用都带上了事务（`swap-workflow.service.ts:399`、`:1475`、`:1617`；`swap-leg-accounting.ts` 内部链路）；`swap-workflow.service.ts:1866` 与 `trading-readiness.controller.ts` 等事务外调用不带——这是对的。

- [ ] **Step 10：tsc ①**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"; npx tsc --noEmit -p tsconfig.json > /tmp/txleak-t2-tsc.log 2>&1; echo EXIT=$?`
Expected：`EXIT=0`，日志为空。

- [ ] **Step 11：jest 相关目录**

Run：

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
export DATABASE_URL=file:/tmp/exchange_js_wt_cloud_deploy/dev.db
npx jest src/modules/trading src/modules/asset-treasury src/modules/funds-layer src/modules/funds-orders src/modules/accounting src/modules/identity/customers src/modules/identity/auth src/modules/clearing-settle/reconciliation > /tmp/txleak-t2-jest.log 2>&1; echo EXIT=$?
```

Expected：`EXIT=0`、全绿。已知会因新尾参数失败的断言：`swap-workflow.service.spec.ts:632-633`（`hasReceivingAccount` 现在多一个事务参数）——改成 `toHaveBeenCalledWith('cust-1', 'TRON', expect.anything())` / `toHaveBeenCalledWith('cust-1', 'AED_ZAND', expect.anything())`。其它只因多出尾参数（含多出 `undefined`）而失败的 `toHaveBeenCalledWith`，同法按新签名补上；**除此之外若有红，停下报告，不改测试逻辑。**

- [ ] **Step 12：提交**

```bash
git add src/modules/asset-treasury/wallets/wallet-query.service.ts src/modules/funds-layer/domain/system-wallet-resolver.service.ts src/modules/accounting/tigerbeetle/accounting.service.ts src/modules/trading/swap-transactions/swap-leg-accounting.ts src/modules/identity/customers/customer-restrictions.service.ts src/modules/identity/customers/customer-access.service.ts src/modules/trading/swap-transactions/swap-workflow.service.ts src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts src/modules/trading/swap-transactions/swap-workflow.service.spec.ts
git commit -m "fix(事务): 兑换/提现下单与推腿的读写走同一事务——补齐开机主路 6 处漏传（找钱包/找账户/查客户能力/读资金单）"
```

（spec 文件没改就别 add 它。）

- [ ] **Step 13（主会话）：探测器转绿**

Run: `bash $SCR/txleak-detector.sh > $SCR/txleak-t2.log 2>&1; echo EXIT=$?`
Expected：`EXIT=0`，末行 `DETECTOR: PASS — demo:all DONE ✅ · scenarios: N/N DETECTED · wallets: N/N bucket OK · casesOpened N/N`。
**仍红**：按 `demo-all.log` / `api.log` 里 P2028 / P1008 的调用栈找到事务里那次没带事务的调用，按同一改法补上（派修复子代理，附栈与本 plan 的改法），再跑，直到绿；新找到的点记进台账，最终报告逐条列出。任务评审（`opus`，本任务动了记账解析）在探测器转绿之后派。

---

### Task 3：审批自批检查、限制账审计、种子单号不再撞车（F、H + 种子撞号）

**Files:**
- Create: `scripts/seed-audit-helper.spec.ts`
- Modify: `prisma/seed-audit.helper.ts`（`writeSeedAudit` 与文件头部）
- Modify: `src/modules/governance/approvals/approval-policy.service.ts:147-152`
- Modify: `src/modules/governance/approvals/approvals.service.ts:481-486, 502, 701, 822`
- Modify: `src/modules/identity/customers/customer-restriction-workflow.service.ts:358-361`

**Interfaces:**
- Consumes：无（与 Task 2 独立）。
- Produces：`ApprovalPolicyService.isSameUserMakerCheckerDenied(tx?: any): Promise<boolean>`；`writeSeedAudit(prisma, input)` 签名不变。

- [ ] **Step 1：先写种子撞号的失败测试 `scripts/seed-audit-helper.spec.ts`**

```ts
import { writeSeedAudit } from '../prisma/seed-audit.helper';

// 放在 scripts/ 而不是 prisma/：jest 只在 roots（src / admin-web/src / scripts）里发现测试，见 jest.config.js。

function p2002(field: string) {
  return Object.assign(new Error(`Unique constraint failed on the fields: (\`${field}\`)`), {
    code: 'P2002',
    meta: { modelName: 'AuditLogEvent', target: [field] },
  });
}

function fakePrisma(create: jest.Mock) {
  return { auditLogEvent: { findUnique: jest.fn().mockResolvedValue(null), create } } as any;
}

const input = {
  action: 'TRANSACTION_LIMIT_SEEDED',
  subjectType: 'TRANSACTION_LIMIT_POLICY',
  subjectNo: 'TLR-SPEC',
  actorNo: 'RELEASE' as const,
  afterData: { gateType: 'SINGLE' },
};

describe('writeSeedAudit：审计单号撞车', () => {
  it('撞 eventNo 就换一个号再写，第二次成功即返回', async () => {
    const create = jest.fn().mockRejectedValueOnce(p2002('eventNo')).mockResolvedValueOnce({ id: 'row-2' });
    await expect(writeSeedAudit(fakePrisma(create), input)).resolves.toEqual({ id: 'row-2' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data.eventNo).toMatch(/^AUD\d{12}$/);
    expect(create.mock.calls[1][0].data.eventNo).toMatch(/^AUD\d{12}$/);
  });

  it('别的唯一约束冲突照旧抛出，不换号', async () => {
    const create = jest.fn().mockRejectedValueOnce(p2002('idempotencyKey'));
    await expect(writeSeedAudit(fakePrisma(create), input)).rejects.toMatchObject({ code: 'P2002' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('连撞 10 次就放弃并报错', async () => {
    const create = jest.fn().mockRejectedValue(p2002('eventNo'));
    await expect(writeSeedAudit(fakePrisma(create), input)).rejects.toThrow(/10/);
    expect(create).toHaveBeenCalledTimes(10);
  });
});
```

- [ ] **Step 2：跑，必须红**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"; npx jest scripts/seed-audit-helper.spec.ts > /tmp/txleak-t3-red.log 2>&1; echo EXIT=$?`
Expected：`EXIT=1`；第 1、3 条失败（现写法撞一次就抛、只调一次 `create`），第 2 条通过。

- [ ] **Step 3：改 `prisma/seed-audit.helper.ts`**

在 `export interface SeedAuditInput { … }` 之后加：

```ts
// 审计单号 = AUD + 日期 + 6 位随机数，同一天内会撞（生日问题）。服务侧
// AuditLogsService.createEventWithUniqueNo 撞 eventNo 就换号重写、上限 MAX_NO_RETRIES=10，这里照抄同一取号法。
const MAX_EVENT_NO_ATTEMPTS = 10;

function isEventNoConflict(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: string[] | string } };
  if (e?.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes('eventNo');
  return typeof target === 'string' && target.includes('eventNo');
}
```

把 `writeSeedAudit` 末尾的 `return prisma.auditLogEvent.create({ data: { … } });` 换成下面这段——`data` 里的字段与现在逐字相同，只是整段包进循环：

```ts
  for (let attempt = 0; attempt < MAX_EVENT_NO_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.auditLogEvent.create({
        data: {
          eventNo: generateReferenceNo('AUD'),
          category: 'SYSTEM',
          occurredAt,
          recordedAt: occurredAt,
          action: input.action,
          actionDomain: 'CONFIG',
          actorType: 'SYSTEM',
          actorNo: input.actorNo,
          actorDisplayName: input.actorNo,
          actorRolesAtTime: JSON.stringify(['SYSTEM']),
          sourcePlatform: 'SYSTEM',
          requestId,
          primarySubjectType: input.subjectType,
          primarySubjectNo: input.subjectNo,
          ownerCustomerNo: input.ownerCustomerNo ?? null,
          outcome: 'SUCCESS',
          afterData,
          correlationId,
          traceId: correlationId,
          payloadDigest,
          retainedUntil,
          idempotencyKey,
          metadata,
          subjects: {
            create: [
              { subjectType: input.subjectType, subjectNo: input.subjectNo, subjectRole: 'PRIMARY', occurredAt },
              ...(input.ownerCustomerNo
                ? [{ subjectType: 'CUSTOMER', subjectNo: input.ownerCustomerNo, subjectRole: 'OWNER', occurredAt }]
                : []),
            ],
          },
        },
      });
    } catch (error) {
      if (isEventNoConflict(error)) continue;
      throw error;
    }
  }
  throw new Error(`writeSeedAudit: eventNo collided ${MAX_EVENT_NO_ATTEMPTS} times (${input.action} ${input.subjectNo})`);
```

- [ ] **Step 4：跑，必须绿**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"; npx jest scripts/seed-audit-helper.spec.ts > /tmp/txleak-t3-green.log 2>&1; echo EXIT=$?`
Expected：`EXIT=0`，`3 passed`。

- [ ] **Step 5：F——`approval-policy.service.ts:147-152`**（照本文件 `upsertStepsConfig` 的 `tx?: any` + `tx || this.prisma` 写法）

```ts
  async isSameUserMakerCheckerDenied(tx?: any): Promise<boolean> {
    const db = tx || this.prisma;
    const rule = await db.approvalSodRule.findUnique({
      where: { ruleCode: ApprovalSoDRuleCodes.DENY_SAME_USER_MAKER_CHECKER },
    });
    return rule?.enabled ?? true;
  }
```

- [ ] **Step 6：F——`approvals.service.ts`**

`resolveDecisionRole` 签名（`:481-486`）加第 5 个参数（类型用本文件 `:44` 的 `ApprovalWriteClient`）：

```ts
  private async resolveDecisionRole(
    approval: ApprovalCaseRow,
    actor: ApprovalActorContext,
    requestedRole?: string,
    stepCandidateRoles?: string[],
    tx?: ApprovalWriteClient,
  ): Promise<string> {
```

`:502`：

```ts
      (await this.approvalPolicyService.isSameUserMakerCheckerDenied(tx))
```

`:701`（`approve()`）与 `:822`（`reject()`）：

```ts
        const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole, stepCandidateRoles, tx);
```

然后 `grep -n "resolveDecisionRole(" src/modules/governance/approvals/approvals.service.ts`——若还有别的调用点在事务里，同样传 `tx`；在事务外的不动。`:504-509` 那段注释不改。

- [ ] **Step 7：H——`customer-restriction-workflow.service.ts:358-361`**（`audit()` 已有 `tx?: Record<string, any>` 参数）

```ts
    const client = (tx ?? this.prisma) as Record<string, any>;
    const customer = await client.customerMain.findUnique({
      where: { id: row.customerId },
      select: { customerNo: true },
    });
```

- [ ] **Step 8：tsc ① + jest 相关目录**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
export DATABASE_URL=file:/tmp/exchange_js_wt_cloud_deploy/dev.db
npx tsc --noEmit -p tsconfig.json > /tmp/txleak-t3-tsc.log 2>&1; echo TSC_EXIT=$?
npx jest src/modules/governance/approvals src/modules/identity scripts/seed-audit-helper.spec.ts > /tmp/txleak-t3-jest.log 2>&1; echo JEST_EXIT=$?
```

Expected：`TSC_EXIT=0`、`JEST_EXIT=0`。只因新尾参数失败的断言按新签名补；其它红停下报告。

- [ ] **Step 9：提交**

```bash
git add scripts/seed-audit-helper.spec.ts prisma/seed-audit.helper.ts src/modules/governance/approvals/approval-policy.service.ts src/modules/governance/approvals/approvals.service.ts src/modules/identity/customers/customer-restriction-workflow.service.ts
git commit -m "fix(事务): 审批自批检查与限制账审计的读库走同一事务 + 种子留痕撞号换号（照服务取号法）"
```

- [ ] **Step 10（主会话）**：派任务评审（`sonnet`）；评审过后再跑一次探测器（Task 4 Step 1）。

---

### Task 4（主会话执行）：本机全量验收 + 文档

**Files:**
- Create: `$SCR/txleak-gates.sh`（不入库）
- Modify: `doc-final/rules/backend.md:18`（其下加子项）
- Modify: `doc-final/superpowers/specs/2026-09-11-cloud-demo-deploy-design.md`（§2、§8、§10）
- Modify: `doc-final/PRODUCTION-NOTES.md`（撤回未提交的那一行）

- [ ] **Step 1：探测器全绿**

Run: `bash $SCR/txleak-detector.sh > $SCR/txleak-final-local.log 2>&1; echo EXIT=$?` → Expected `EXIT=0`、`DETECTOR: PASS`。

- [ ] **Step 2：写闸门脚本 `$SCR/txleak-gates.sh`**

```bash
#!/usr/bin/env bash
# txleak-gates.sh — tx-leak spec §4 第 2–4 条：①②③ + ④ jest + e2e 基线 11 套 + 对账组 5 套 + ⑦ verify:coa + 收尾闸 ⑥。
# 只碰 self 栈。每步打印 "<name> EXIT=<码>"，日志进 $OUT/<name>.log；末尾汇总。
# 注意：recon-internal-transfer 的截止用"现在"，别跨 UTC 零点（新加坡时间 08:00）跑。
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
WT=/Users/songshengwei/Documents/codex/projects/重做版/.claude/worktrees/cloud-deploy
EJ="$WT/Exchange_js"
SELF=/tmp/exchange_js_wt_cloud_deploy
OUT=/private/tmp/claude-501/-Users-songshengwei-Documents-codex-projects----/a1d8a3d6-ac5e-4b85-ba07-ad759fb0c26d/scratchpad/txleak-gates
mkdir -p "$OUT"
cd "$EJ" || exit 1
RESULTS=""

run() {   # $1=名字，其余=命令
  local name="$1"
  shift
  "$@" > "$OUT/$name.log" 2>&1
  local ec=$?
  echo "$name EXIT=$ec"
  RESULTS="$RESULTS $name=$ec"
  return $ec
}
fresh_self() {   # reset 不清 audit_log_events，故先删 dev.db
  rm -f "$SELF/dev.db" "$SELF/dev.db-journal"
  bash scripts/stack.sh reset self
}
init_private_db() {   # $1=库文件名（baseline.md §e2e 第 1 条）
  rm -f "$SELF/$1" "$SELF/$1-journal"
  DATABASE_URL="file:$SELF/$1" npx prisma migrate deploy &&
    DATABASE_URL="file:$SELF/$1" npm run -s db:base:sync &&
    DATABASE_URL="file:$SELF/$1" TB_ADDRESS=127.0.0.1:3103 npm run -s db:biz:init
}

run tsc1 npx tsc --noEmit -p tsconfig.json
run tsc2 bash -c 'cd admin-web && npx tsc -b --noEmit'
run tsc3 bash -c 'cd client-web && npx tsc -b --noEmit'
run jest env DATABASE_URL="file:$SELF/dev.db" npx jest src/modules/trading src/modules/asset-treasury src/modules/funds-layer src/modules/funds-orders src/modules/accounting src/modules/identity src/modules/governance/approvals src/modules/clearing-settle/reconciliation scripts/seed-audit-helper.spec.ts

# e2e 基线 11 套：干净态 → 私库先铺 → 共用库先 demo:setup → --runInBand（前面不加 --）
run reset-e2e fresh_self
for db in e2e-customer-restrictions.db e2e-kyt-verdict-landing.db e2e-sla.db e2e-deposit-verdicts.db e2e-sanction-subject-split.db e2e-material-requests.db; do
  run "privdb-${db%.db}" init_private_db "$db"
done
run demo-setup-1 bash scripts/on-stack.sh self demo:setup
run e2e-base bash scripts/on-stack.sh self test:e2e --runInBand test/deposit-money-arcs.e2e-spec.ts test/withdraw-money-arcs.e2e-spec.ts test/swap-money-arc.e2e-spec.ts test/deposit-sumsub-verdicts.e2e-spec.ts test/withdraw-sumsub-scenarios.e2e-spec.ts test/swap-sumsub-scenarios.e2e-spec.ts test/kyt-verdict-landing.e2e-spec.ts test/sanction-subject-split.e2e-spec.ts test/material-requests.e2e-spec.ts test/customer-restrictions.e2e-spec.ts test/sla.e2e-spec.ts

# 对账组 5 套：干净库 + demo:setup；verify:coa 放在调账 e2e 之后（baseline.md:71）
run reset-recon fresh_self
run demo-setup-2 bash scripts/on-stack.sh self demo:setup
run e2e-recon bash scripts/on-stack.sh self test:e2e --runInBand test/recon-
run coa-after-recon bash scripts/on-stack.sh self verify:coa

# 收尾闸 ⑥：干净库 → 起栈（reset 不拉栈）→ demo:all → 再跑 coa
run reset-g6 fresh_self
run stack-up bash scripts/stack.sh up
run demo-all bash scripts/on-stack.sh self demo:all
run coa-after-demo bash scripts/on-stack.sh self verify:coa

echo "== 汇总 =="
echo "$RESULTS" | tr ' ' '\n'
grep -h 'Tests:' "$OUT/jest.log" "$OUT/e2e-base.log" "$OUT/e2e-recon.log"
echo "demo:all DONE 行数: $(grep -c 'demo:all DONE ✅' "$OUT/demo-all.log")"
echo "coa PASS: recon=$(grep -c 'ALL INVARIANTS PASS' "$OUT/coa-after-recon.log") demo=$(grep -c 'ALL INVARIANTS PASS' "$OUT/coa-after-demo.log")"
```

- [ ] **Step 3：跑闸门（后台，约 20–30 分钟）**

Run: `bash $SCR/txleak-gates.sh > $SCR/txleak-gates.out 2>&1; echo EXIT=$?`（`run_in_background`）
Expected：每个 `<name> EXIT=0`；`Tests:` 行 jest 全过、e2e 基线 `83 passed, 83 total`、对账组 `26 passed, 26 total`；`demo:all DONE 行数: 1`；`coa PASS: recon=1 demo=1`。任何一项红：看对应 `$OUT/<name>.log`，在修复前先按 spec §4 判断是不是本任务引起的；不是就停下报告业主。

- [ ] **Step 4：文档**

`doc-final/rules/backend.md`：第 18 行下面插入一条子项：

```markdown
  - 事务回调里（以及拿到事务的函数里）调别的服务方法，**必须把事务传下去**；被调方没有事务参数就按上一条补一个（不传时行为不变）。漏传的那次读写会另开一条连接，和还没提交的事务互等到超时——2026-09-11 云端 2 核开机铺数据约一半失败即此因。自查：`DATABASE_URL` 末尾加 `?connection_limit=1` 跑一遍 `demo:all`，漏传会在 5 秒后必现 P2028。
```

上云 spec `§2`"无持久数据、全部在内存"一条里，从"2026-09-11 四轮对照实验定的："到句末，换成：

```markdown
2026-09-11 对照实验：这块云硬盘同步写约 4 ms/次（Mac 约 0.1 ms），SQLite 放盘上 `demo:all` 必撞 Prisma `P1008`，挪进内存盘后解决。之后仍有约一半开机失败，当时判断为"卡在账本落盘"，于是把账本也挪进内存、升级到 8 GB；账本进内存后失败照旧（10 次成 4 次），根因后查明是业务代码的事务漏传（见 `2026-09-11-tx-leak-fix-design.md`），与磁盘无关。8 GB 只能升不能降；账本留在内存盘开机更快，保持现状。
```

上云 spec `§8` 最后一条换成：

```markdown
- 业务代码改动。例外两处：① `scripts/demo-lib.ts` 的 `writeDataMdSnapshot` 在 `data.md` 不存在时打印一行"跳过"并返回（服务器上不传 `doc-final`；main 上文件在，行为不变）；② 事务漏传修复 + 种子留痕撞号——2 核服务器上开机铺数据约一半失败的根因，单独立 spec 经业主审批（`2026-09-11-tx-leak-fix-design.md`）
```

上云 spec `§10`"8 GB 内存"一条换成：

```markdown
- **8 GB 内存**：账本进程 1.44 GiB + 账本内存盘文件 1.1 GB + API 与铺数据进程。2026-09-11 升级到 Starter 2 核 8 GB（每月 $10，只能升不能降）时的依据"账本落盘拖出失败"事后被证伪——真因是事务漏传（见 tx-leak spec）；账本放内存盘开机更快，保持现状。
```

`PRODUCTION-NOTES.md`：先 `git diff -- doc-final/PRODUCTION-NOTES.md` 确认 diff 只有子代理加的那一行（"`runSwaps()` 等制裁连带冻结广播…"）和它后面的空行，再 `git checkout -- doc-final/PRODUCTION-NOTES.md`。

- [ ] **Step 5：提交文档**

```bash
git add doc-final/rules/backend.md doc-final/superpowers/specs/2026-09-11-cloud-demo-deploy-design.md
git commit -m "docs(事务): backend.md 补'事务里调别的服务必须把事务传下去'+自查法；上云 spec 改正失败归因、§8 记例外"
```

（上云 spec 里此前未提交的 §1–§3 / §6 / §10 实测事实随这次一起提交——提交前 `git diff` 过一遍，确认都是本会话写的。）

---

### Task 5（主会话执行）：云端验收

**Files:** Create `$SCR/txleak-cloud.sh`（不入库）

- [ ] **Step 1：写云端脚本**

```bash
#!/usr/bin/env bash
# txleak-cloud.sh — tx-leak spec §4 第 1 条（云端探测）与第 5 条（默认配置 10 连开机）。前提：npm run cloud:deploy 已成功。
#   bash txleak-cloud.sh detector   # demo.env 临时加 ?connection_limit=1 → 重启 → cloud-verify → 改回 → 重启 → cloud-verify
#   bash txleak-cloud.sh boot10     # 默认配置连续重启 10 次，每次 cloud-verify（spec §5 六项）；要求 10/10
set -uo pipefail
EJ=/Users/songshengwei/Documents/codex/projects/重做版/.claude/worktrees/cloud-deploy/Exchange_js
OUT=/private/tmp/claude-501/-Users-songshengwei-Documents-codex-projects----/a1d8a3d6-ac5e-4b85-ba07-ad759fb0c26d/scratchpad/txleak-cloud
mkdir -p "$OUT"
cd "$EJ" || exit 1
# shellcheck source=/dev/null
source scripts/cloud-env.sh
set +e   # cloud-env.sh 开了 errexit；这里要自己数成败

REMOTE='set -euo pipefail
ENV=/opt/exchange-demo/demo.env
case "$1" in
  on)   sed -i "s|^DATABASE_URL=file:/run/exchange-demo/dev.db\$|DATABASE_URL=file:/run/exchange-demo/dev.db?connection_limit=1|" "$ENV" ;;
  off)  sed -i "s|^DATABASE_URL=file:/run/exchange-demo/dev.db?connection_limit=1\$|DATABASE_URL=file:/run/exchange-demo/dev.db|" "$ENV" ;;
  keep) ;;
esac
grep "^DATABASE_URL=" "$ENV"
rm -f /opt/exchange-demo/run/status
systemctl restart exchange-demo'

restart() { cloud_ssh "sudo bash -s -- $1" <<< "$REMOTE"; }

case "${1:-}" in
  detector)
    restart on
    bash scripts/cloud-verify.sh > "$OUT/detector-on.log" 2>&1
    ec_on=$?
    tail -n 12 "$OUT/detector-on.log"
    restart off
    bash scripts/cloud-verify.sh > "$OUT/detector-off.log" 2>&1
    ec_off=$?
    tail -n 12 "$OUT/detector-off.log"
    echo "CLOUD DETECTOR: on=$ec_on off=$ec_off"
    if [[ "$ec_on" == 0 && "$ec_off" == 0 ]]; then exit 0; fi
    exit 1
    ;;
  boot10)
    cloud_ssh "grep '^DATABASE_URL=' ${CLOUD_ROOT}/demo.env"
    pass=0
    for n in 1 2 3 4 5 6 7 8 9 10; do
      restart keep > "$OUT/boot$n-restart.log" 2>&1
      if bash scripts/cloud-verify.sh > "$OUT/boot$n.log" 2>&1; then
        pass=$((pass + 1))
        echo "boot $n: PASS"
      else
        echo "boot $n: FAIL（$OUT/boot$n.log）"
      fi
    done
    echo "BOOT10: $pass/10"
    if [[ "$pass" == 10 ]]; then exit 0; fi
    exit 1
    ;;
  *)
    echo "usage: $0 detector|boot10"
    exit 2
    ;;
esac
```

- [ ] **Step 2：部署修好的代码（默认配置）**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"; npm run cloud:deploy > $SCR/txleak-deploy.log 2>&1; echo EXIT=$?`
Expected：`EXIT=0`，验收六项全过，打印部署用时与转发给同事的那段话。

- [ ] **Step 3：云端探测**

Run: `bash $SCR/txleak-cloud.sh detector > $SCR/txleak-cloud-detector.out 2>&1; echo EXIT=$?`
Expected：`EXIT=0`，`CLOUD DETECTOR: on=0 off=0`；中间打印的 `DATABASE_URL=` 行先带 `?connection_limit=1`、后不带。

- [ ] **Step 4：默认配置连续开机 10 次（后台，约 10–15 分钟）**

Run: `bash $SCR/txleak-cloud.sh boot10 > $SCR/txleak-boot10.out 2>&1; echo EXIT=$?`（`run_in_background`）
Expected：`EXIT=0`，`BOOT10: 10/10`；开头 `DATABASE_URL=file:/run/exchange-demo/dev.db`（不带探测参数）。

- [ ] **Step 5：不到 10/10 → 停**

按 spec §4 第 6 条：停下，把失败那几次的 `boot<n>.log` 与服务器 `run/boot.log` 的 FATAL 块整理给业主；不叠加重试 / 锁 / 调超时。

- [ ] **Step 6：记台账**

`.superpowers/sdd/progress.md` 追加：`tx-leak Task 5: cloud detector on/off green; boot10 10/10（<日期时间>）`，并注明"上云 plan Task 3 的可靠性验收由此完成"。

---

## 收尾

- 本 plan 不另做整支终审：Task 2（`opus`）、Task 3（`sonnet`）各有任务评审；整支分支的终审在上云 plan Task 6 统一做（会覆盖本 plan 的全部提交）。上云终审的派发要点里写明：逐条对照本 spec §2 的 8 处 + 种子撞号，问"每处的代码在哪、探测器 / 10 连开机的证据在哪"。
- `CHANGELOG` 一行随上云任务合并时写（spec §6）。
- 然后回到上云 plan：Task 3 任务评审（范围 `501463e8..3da5c5ad` 三个上云提交）→ Task 4–6。
