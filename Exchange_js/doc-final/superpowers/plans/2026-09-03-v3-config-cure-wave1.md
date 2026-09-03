# V3 财务配置治愈 · 波一「结构与退役」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把五块财务配置（资产 / 托管钱包 / 提现地址簿 / 限额 / 费率两族）的表结构、状态机、审批与权限收成 spec `2026-09-03-v3-config-cure-wave1-design.md` §2–§9 的终态，并把上币 / 建托管钱包 / 建限额三条旧路整条拔干净；本波不做新资产上线。

**Architecture:** 网络（`TRON` / `AED_ZAND`）成为一等实体（代码注册表，不建表、不做管理面）；资产 = 币种 × 网络 × 合约地址；钱包行 = 一个地址（vault × 网络 × 归属人）；提现地址簿按客户 × 网络；账本科目仍按资产、对账引擎不动。每块各自：schema 终态 + 迁移表常量 + 审计四属性入合同 + RBAC 行 + 页面；退役前逐键 `git grep`。

**Tech Stack:** NestJS 10 + Prisma（SQLite）+ TigerBeetle ｜ React（admin-web / client-web）｜ jest（单测 + `test/*.e2e-spec.ts`）｜ ts-node 判据脚本（`verify:rbac` / `verify:act1` / `verify:coa` / `verify:audit` / `demo:all` / `recon:demo:*`）。

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用；每个任务末尾列「本任务过哪几条」。
- 本轮特有（spec §0 / §11）：不做幂等 / 去重 / 重试 / 补偿 / 并发锁 / 兼容层 / backfill——schema 与状态值直接按终态改，改完 `bash scripts/stack.sh reset self` 重铺；不做新资产上线整条流程；平台钱包零增删改（只从种子来）。
- 退役前逐键 `git grep -n <键>`（体检快照会过期，上一轮三次撞上）；退役审计码只进 `DEPRECATED_AUDIT_ACTIONS`，不删码值；改了 `rbac.catalog.ts` / `approval.constants.ts` 必须 `bash scripts/on-stack.sh self db:base:sync` + 重启后端（`bash scripts/stack.sh down self && bash scripts/stack.sh up self`）。
- 网络码只许 `TRON` / `AED_ZAND`（`src/config/manifests/networks.manifest.ts`）；vault 码只许 `F_OPS` / `F_SET` / `F_FEE` / `F_LIQ` / `CLIENT_DEPOSIT`（`vaults.manifest.ts`）；三列 `Asset.network` / `Wallet.network` / `WithdrawalAddress.network` 写入前都过 `assertNetwork()`。
- 施工环境：worktree `重做版/.claude/worktrees/v3-wave1`（分支 `feat/v3-config-cure-wave1`，从 `main` 切），栈一律 `self`，脚本一律 `bash scripts/on-stack.sh self <script>`；每条命令前置 node 20：`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；worktree 内 `.stackports` 只有一行后端端口 `P`，管理台 = `P+1`，客户端 = `P+2`。
- 随手闸（每个任务末尾）：`npx tsc --noEmit -p tsconfig.json` ｜ `cd admin-web && npx tsc -b --noEmit && cd ..` ｜ `cd client-web && npx tsc -b --noEmit && cd ..` ｜ jest 只跑本任务目录且**全绿**；改了前端必起 preview 截图。
- 三份共享文件（`rbac.catalog.ts` / `approval.constants.ts` / `audit-actions.constant.ts`）并行会话高发冲突：合并前必 `git merge main` 复跑判据。
- 模型分层（CLAUDE.md §6）：任务执行与任务级 review → `sonnet`；Task 4 / 5 / 6 / 8 / 11 动钱或动状态机 → 评审升 `opus`；终审 `fable`。
- 每个任务的 prompt 必须带 CLAUDE.md §0–§5 要点（演示系统 / 判断标准 / 禁做清单 / 允许的假设 / 六铁律）。

### 本计划的四处裁定（spec 未展开，执行者不要再问）

1. **`Wallet` 保留内部列 `ownerId`**（客户 UUID，平台行 `null`）：spec §4 的列表只列对外列；`WithdrawalAddress.customerId + customerNo` 是同款先例。对外接口只露 `ownerNo`；唯一键按 spec `(vaultCode, network, ownerNo)`。
2. **`InboundTransferSignal` 表保留 `walletId` / `assetId` 两列**（服务端按新钥匙解析后落库）；只有入站 DTO 改钥匙。
3. **AED 的 `Asset.network` 由 `''` 改为 `AED_ZAND`；银行账户类提现地址的 `network` 由 `'FIAT'` 改为 `AED_ZAND`；`Asset.code` 不变**（`AED` / `USDT-TRON`）。客户端 `PATCH /client/withdrawal-addresses/:addressNo` **不登 `rbac.catalog.ts`**——既有三条客户端地址路由（POST / DELETE / deactivate）都只挂 `AuthGuard('jwt')` + 本人校验、都不在目录里，"照既有方式"即如此；管理端 `unsuspend` 照常登记。
4. **费率族没有码因"删行语义作废"**：`*_FEE_LEVEL_CREATION_CANCELLED` 的语义是"创建请求被否 / 取消"，与行是否物理删除无关，码与四属性原样保留，只是行从此停在 `REJECTED` / `CANCELLED` 而非消失。

## 文件地图

**新建**
- `src/config/manifests/networks.manifest.ts`、`vaults.manifest.ts`、`networks.manifest.spec.ts`
- `src/common/utils/tron-address.util.ts`（+ spec）
- `src/modules/asset-treasury/assets/asset-admin.controller.ts`（接管 suspend / reactivate 两条路由）
- `src/modules/asset-treasury/withdrawal-addresses/constants/withdrawal-address-transitions.constant.ts`（+ spec）、`dto/update-withdrawal-address.dto.ts`、`dto/unsuspend-withdrawal-address.dto.ts`
- `src/modules/trading/shared/fee-level-transitions.constant.ts`（+ spec）
- `src/modules/trading/swap-fee-level/swap-fee-level-retire-workflow.service.ts`、`swap-fee-level-retire-approval.service.ts`、`dto/retire-swap-fee-level.dto.ts`；`withdrawal-fee-level/` 同名三件
- `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts`
- `prisma/seed-audit.helper.ts`
- `prisma/migrations/<timestamp>_v3w1_*`（每块一份，共 5 份：asset / wallet / withdrawal_address / transaction_limit / fee_level）

**修改（后端）**：`prisma/schema.prisma`、`prisma/seed.business.ts`、`scripts/demo-lib.ts`、`scripts/demo-fixtures.ts`、`scripts/recon-demo.ts`、`scripts/verify-rbac.ts`、`scripts/verify-act1.ts`、`scripts/verify-audit.ts`；`src/modules/asset-treasury/assets/*`、`wallets/*`、`withdrawal-addresses/*`、`transaction-limits/*`；`src/modules/trading/{swap,withdrawal}-fee-level/*`、`deposit-transactions/{dto/inbound-transfer-signal.dto,inbound-transfer-signals.service,deposit-transactions.service}.ts`、`withdraw-transactions/{withdraw-transactions.service,withdraw-workflow.service}.ts`；`src/modules/funds-layer/domain/system-wallet-resolver.service.ts`；`src/modules/accounting/tigerbeetle/tb-evidence.service.ts`；`src/modules/identity/access-control/rbac.catalog.ts`；`src/modules/governance/approvals/constants/approval.constants.ts`；`src/modules/audit-logging/constants/audit-actions.constant.ts`；`test/*.e2e-spec.ts` 里 19 处建钱包夹具 + 4 处建地址夹具。

**修改（前端）**：admin-web `App.tsx`、`components/DashboardLayout.tsx`、`rbac/permissions.ts`、`utils/walletRole.util.tsx`、`pages/{AssetList,AssetDetail,CustodianWalletList,CustodianWalletDetail,WithdrawalAddressList,WithdrawalAddressDetail,TransactionLimitList,TransactionLimitDetail,SwapFeeLevelList,SwapFeeLevelDetail,WithdrawalFeeLevelList,WithdrawalFeeLevelDetail,ApprovalDetailPage}.tsx`；client-web `pages/{Deposit,WalletManagement,WithdrawalAddresses,Withdraw,TransactionHistory}.tsx`。

**删除**：`src/config/manifests/{asset-config,pricing-policies}.manifest.ts`；assets 目录的 `asset-listing-workflow.service.ts` / `asset-listing.controller.ts` / `asset-activation-workflow.service.ts` / `asset-activation-approval.service.ts` / `dto/submit-asset-listing.dto.ts` / `dto/update-asset.dto.ts`；wallets 目录的 `custodian-wallet-create-workflow.service.ts` / `custodian-wallet-create-approval.service.ts` / `custodian-wallet-create.controller.ts` / `dto/create-custodian-wallet.dto.ts` / `wallet-balance.service.ts`（+spec）/ `wallet-role-policies.constant.ts`（+spec）/ `customer-viban-bank.constant.ts`；withdrawal-addresses 目录的 `address-validator.util.ts`（+spec）；transaction-limits 目录的 `transaction-limit-creation-approval.service.ts`；admin-web `pages/{AssetCreate,AssetEdit,CustodianWalletCreateModal}.tsx`。

**文档**：`doc-final/modules/v3-financial-config.md`、`modules/overview.md`、`demo/script.md`、`demo/data.md`、`demo/baseline.md`、`BACKLOG.md`、`PRODUCTION-NOTES.md`、`TOOLING-DEBT.md`、`CHANGELOG.md`、`superpowers/specs/2026-09-03-v3-config-cure-wave2-design.md`（只写「承接上一波」段）。

## 任务顺序与阶段闸

| 阶段 | 任务 | 阶段闸 |
|---|---|---|
| A 地基 | Task 1 | tsc ①②③ + 新 spec 绿 |
| B 资产 | Task 2–3 | `assets/**` jest 绿；管理台截图 |
| C 钱包 | Task 4–7 | **Task 4–6 是一个运行时原子单元**：Task 4 结束 tsc / jest 绿但 `demo:all` 会红（充值 / 提现路径还按资产找钱包），直到 Task 6 末尾 `reset self → demo:all → verify:coa` 全绿；Task 7 前端截图 |
| D 地址簿 | Task 8–9 | `withdrawal-addresses/**` jest 绿；客户端 + 管理台截图 |
| E 限额与费率 | Task 10–12 | 各目录 jest 绿；截图 |
| F 治理面与收尾 | Task 13–16 | `verify:rbac` → `verify:act1` → `reset self` → `demo:all` → `verify:coa` → `verify:audit` → `recon:demo:pass/break` → `test:e2e` → jest 全量 → 真机走查站 2 / 4 / 5 |

开工前一次性准备（在主工作树执行）：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git worktree add .claude/worktrees/v3-wave1 -b feat/v3-config-cure-wave1 main
cd .claude/worktrees/v3-wave1/Exchange_js
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm run prisma:generate
bash scripts/stack.sh reset self && bash scripts/stack.sh up self
cat ../.stackports   # 记下后端端口 P；管理台 P+1，客户端 P+2
```

生成 Prisma 迁移的固定写法（每个动 schema 的任务都用这两行；`--create-only` 只生成 SQL 不套用，套用交给 `stack.sh reset self`）：

```bash
export DATABASE_URL="$(source scripts/db-env.sh && read_database_url "$PWD" self)"
npx prisma migrate dev --create-only --name <迁移名> && npx prisma generate
```

---

### Task 1: 网络注册表、vault 注册表、资产清单终态（地基）

**本任务做**：两份代码注册表 + 资产清单补齐 spec §2 / §3 字段 + TRON 假地址工具 + 单测；删两份零引用的旧清单。**不做**：不建表、不做管理面、不接任何消费方（消费方各自的任务接）。

**Files:**
- Create: `src/config/manifests/networks.manifest.ts`
- Create: `src/config/manifests/vaults.manifest.ts`
- Create: `src/config/manifests/networks.manifest.spec.ts`
- Create: `src/common/utils/tron-address.util.ts`、`src/common/utils/tron-address.util.spec.ts`
- Modify: `src/config/manifests/assets.manifest.ts`
- Delete: `src/config/manifests/asset-config.manifest.ts`、`src/config/manifests/pricing-policies.manifest.ts`

**Interfaces:**
- Produces: `NETWORKS`, `NETWORK_CODES`, `NetworkCode`, `NetworkDefinition`, `assertNetwork(code): NetworkDefinition`, `validateAddressForNetwork(code, address): { valid; reason? }`；`VAULTS`, `VaultCode`, `PLATFORM_VAULT_CODES`, `platformWalletSlots(): Array<{ vaultCode; network }>`（恒 7 项）；`DEFAULT_ASSETS`（含 `contractAddress / isNative / standard / minConfirmations / custodianAssetKey`）；`fakeTronAddress(seed): string`。

- [ ] **Step 1: 核实两份旧清单零引用**

```bash
git grep -n "asset-config.manifest\|pricing-policies.manifest" -- src prisma scripts test admin-web/src client-web/src
```
Expected: 无输出（只有 `assets.manifest` 被 `prisma/seed.business.ts:8` 引用）。有输出则先处理引用再删。

- [ ] **Step 2: 写失败的单测**

`src/config/manifests/networks.manifest.spec.ts`：

```ts
import { NETWORKS, NETWORK_CODES, assertNetwork, validateAddressForNetwork } from './networks.manifest';
import { VAULTS, platformWalletSlots } from './vaults.manifest';
import { DEFAULT_ASSETS } from './assets.manifest';

describe('网络注册表（spec §2）', () => {
  it('只有 TRON 与 AED_ZAND 两个网络码', () => {
    expect(NETWORK_CODES.sort()).toEqual(['AED_ZAND', 'TRON']);
    expect(NETWORKS.TRON.kind).toBe('CHAIN');
    expect(NETWORKS.AED_ZAND.kind).toBe('BANK_RAIL');
  });
  it('assertNetwork 拒绝未注册的码（旧的 FIAT / 空串都不再合法）', () => {
    expect(() => assertNetwork('FIAT')).toThrow(/Unknown network/);
    expect(() => assertNetwork('')).toThrow(/Unknown network/);
    expect(assertNetwork('TRON').custodian).toBe('HEXTRUST');
  });
  it('TRON 地址按 Base58 形态校验；0x 地址被拒', () => {
    expect(validateAddressForNetwork('TRON', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').valid).toBe(true);
    expect(validateAddressForNetwork('TRON', '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18').valid).toBe(false);
  });
  it('AED_ZAND 的地址形态是 AE + 21 位数字', () => {
    expect(validateAddressForNetwork('AED_ZAND', 'AE070860000000000000001').valid).toBe(true);
    expect(validateAddressForNetwork('AED_ZAND', 'GB29NWBK60161331926819').valid).toBe(false);
  });
});

describe('vault 注册表（spec §4）', () => {
  it('五个 vault；F_SET 只在法币通道', () => {
    expect(Object.keys(VAULTS).sort()).toEqual(['CLIENT_DEPOSIT', 'F_FEE', 'F_LIQ', 'F_OPS', 'F_SET']);
    expect(VAULTS.F_SET.networks).toEqual(['AED_ZAND']);
  });
  it('平台地址行恒 7 个槽位（4 vault × 2 网络 − F_SET 的 TRON）', () => {
    const slots = platformWalletSlots();
    expect(slots).toHaveLength(7);
    expect(slots).not.toContainEqual({ vaultCode: 'F_SET', network: 'TRON' });
  });
});

describe('资产清单（spec §3）', () => {
  it('两条资产，网络码都在注册表里，USDT-TRON 带 TRC-20 合约', () => {
    expect(DEFAULT_ASSETS).toHaveLength(2);
    for (const a of DEFAULT_ASSETS) expect(NETWORK_CODES).toContain(a.network);
    const usdt = DEFAULT_ASSETS.find((a) => a.code === 'USDT-TRON')!;
    expect(usdt.contractAddress).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    expect(usdt.standard).toBe('TRC-20');
    expect(usdt.isNative).toBe(false);
    const aed = DEFAULT_ASSETS.find((a) => a.code === 'AED')!;
    expect(aed.network).toBe('AED_ZAND');
    expect(aed.contractAddress).toBeNull();
  });
});
```

`src/common/utils/tron-address.util.spec.ts`：

```ts
import { fakeTronAddress } from './tron-address.util';
import { NETWORKS } from '../../config/manifests/networks.manifest';

describe('fakeTronAddress', () => {
  it('同一种子导出同一地址，且符合 TRON 地址形态', () => {
    const a = fakeTronAddress('DEMO|C_DEP|CU001');
    expect(a).toBe(fakeTronAddress('DEMO|C_DEP|CU001'));
    expect(a).toMatch(NETWORKS.TRON.addressPattern);
  });
  it('不同种子不同地址', () => {
    expect(fakeTronAddress('a')).not.toBe(fakeTronAddress('b'));
  });
});
```

- [ ] **Step 3: 跑单测确认红**

Run: `npx jest src/config/manifests src/common/utils/tron-address --no-coverage`
Expected: FAIL（模块不存在 / 字段缺失）。

- [ ] **Step 4: 写网络注册表**

`src/config/manifests/networks.manifest.ts`：

```ts
import { BadRequestException } from '@nestjs/common';

export type NetworkKind = 'CHAIN' | 'BANK_RAIL';
export type NetworkCode = 'TRON' | 'AED_ZAND';

/** 字段对齐 HexTrust 链字段（chainID / chainName / family / minBlockConfirmation）；
 *  银行通道用同一张表描述（family = BANK）。沙盒阶段 chainId / chainName 允许占位。 */
export interface NetworkDefinition {
  code: NetworkCode;
  kind: NetworkKind;
  chainId: string;
  chainName: string;
  family: string;
  custodian: 'HEXTRUST' | 'ZAND';
  /** 登记校验正则——取代旧 address-validator.util.ts 里按资产网络串挑正则 */
  addressPattern: RegExp;
  addressLabel: string;
  minConfirmations: number;
  explorerUrl: string | null;
  /** 只有银行通道有：客户虚拟账号的收款行与户名（原 customer-viban-bank.constant.ts） */
  bankName: string | null;
  accountName: string | null;
}

export const NETWORKS: Record<NetworkCode, NetworkDefinition> = {
  TRON: {
    code: 'TRON',
    kind: 'CHAIN',
    chainId: 'tron',
    chainName: 'Tron',
    family: 'TRON',
    custodian: 'HEXTRUST',
    addressPattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    addressLabel: 'Tron address (T + 33 Base58 chars)',
    minConfirmations: 19,
    explorerUrl: 'https://tronscan.org/#/transaction/',
    bankName: null,
    accountName: null,
  },
  AED_ZAND: {
    code: 'AED_ZAND',
    kind: 'BANK_RAIL',
    chainId: 'zand',
    chainName: 'Zand Bank',
    family: 'BANK',
    custodian: 'ZAND',
    addressPattern: /^AE\d{21}$/,
    addressLabel: 'UAE IBAN (AE + 21 digits)',
    minConfirmations: 0,
    explorerUrl: null,
    bankName: 'Zand Bank PJSC',
    accountName: 'FiatX Ltd',
  },
};

export const NETWORK_CODES = Object.keys(NETWORKS) as NetworkCode[];

export function isNetworkCode(code: string): code is NetworkCode {
  return Object.prototype.hasOwnProperty.call(NETWORKS, code);
}

/** Asset.network / Wallet.network / WithdrawalAddress.network 三列写入前都过它 */
export function assertNetwork(code: string): NetworkDefinition {
  if (!isNetworkCode(code)) {
    throw new BadRequestException({ code: 'UNKNOWN_NETWORK', message: `Unknown network: ${code || '(empty)'}` });
  }
  return NETWORKS[code];
}

export function validateAddressForNetwork(code: string, address: string): { valid: boolean; reason?: string } {
  const net = assertNetwork(code);
  if (!net.addressPattern.test(address)) {
    return { valid: false, reason: `Invalid format for ${net.code}. Expected: ${net.addressLabel}` };
  }
  return { valid: true };
}
```

- [ ] **Step 5: 写 vault 注册表**

`src/config/manifests/vaults.manifest.ts`：

```ts
import { NetworkCode } from './networks.manifest';

export type VaultCode = 'F_OPS' | 'F_SET' | 'F_FEE' | 'F_LIQ' | 'CLIENT_DEPOSIT';

/** vault = 用途容器（HexTrust 语义）：每个 vault 在每条网络上一个地址 */
export interface VaultDefinition {
  code: VaultCode;
  ownerType: 'PLATFORM' | 'CUSTOMER';
  label: string;
  networks: NetworkCode[];
}

export const VAULTS: Record<VaultCode, VaultDefinition> = {
  F_OPS: { code: 'F_OPS', ownerType: 'PLATFORM', label: 'Company Operations', networks: ['TRON', 'AED_ZAND'] },
  F_SET: { code: 'F_SET', ownerType: 'PLATFORM', label: 'Company Settlement', networks: ['AED_ZAND'] },
  F_FEE: { code: 'F_FEE', ownerType: 'PLATFORM', label: 'Company Fees', networks: ['TRON', 'AED_ZAND'] },
  F_LIQ: { code: 'F_LIQ', ownerType: 'PLATFORM', label: 'Company Liquidity', networks: ['TRON', 'AED_ZAND'] },
  CLIENT_DEPOSIT: { code: 'CLIENT_DEPOSIT', ownerType: 'CUSTOMER', label: 'Client Deposit Pool', networks: ['TRON', 'AED_ZAND'] },
};

export const VAULT_CODES = Object.keys(VAULTS) as VaultCode[];
export const PLATFORM_VAULT_CODES: VaultCode[] = ['F_OPS', 'F_SET', 'F_FEE', 'F_LIQ'];

export function isVaultCode(code: string): code is VaultCode {
  return Object.prototype.hasOwnProperty.call(VAULTS, code);
}

/** 平台侧地址行 = 4 个 vault × 各自网络（F_SET 只走法币通道）= 7 行，与种子一一对应 */
export function platformWalletSlots(): Array<{ vaultCode: VaultCode; network: NetworkCode }> {
  return PLATFORM_VAULT_CODES.flatMap((vaultCode) =>
    VAULTS[vaultCode].networks.map((network) => ({ vaultCode, network })),
  );
}
```

- [ ] **Step 6: 写 TRON 假地址工具**

`src/common/utils/tron-address.util.ts`：

```ts
import { createHash } from 'crypto';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** 演示用：从任意种子确定性导出一枚符合 TRON Base58 形态（T + 33 位）的地址，不做 checksum。
 *  种子 / demo-lib / e2e 夹具 / mock 托管方共用这一处——此前四处各写一套、有的还是 0x 形态。 */
export function fakeTronAddress(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest();
  let body = '';
  for (let i = 0; body.length < 33; i += 1) {
    body += BASE58[bytes[i % bytes.length] % BASE58.length];
  }
  return `T${body}`;
}
```

- [ ] **Step 7: 资产清单补齐终态字段**

`src/config/manifests/assets.manifest.ts` 整文件改为：

```ts
import { buildDeterministicNo } from '../../common/utils/no-generator.util';
import type { NetworkCode } from './networks.manifest';

/** 资产 = 币种 × 网络 × 合约地址（spec §3）。上币走开发流程：改这里 + 随版本重铺。 */
export interface AssetManifestEntry {
  assetNo: string;
  type: 'FIAT' | 'CRYPTO';
  currency: string;
  code: string;
  network: NetworkCode;
  description: string;
  decimals: number;
  contractAddress: string | null;
  isNative: boolean;
  standard: string | null;
  minConfirmations: number;
  /** HexTrust assetKey（chainID_ticker）；法币为空；沙盒占位 */
  custodianAssetKey: string | null;
}

export const DEFAULT_ASSETS: AssetManifestEntry[] = [
  {
    assetNo: buildDeterministicNo('AS', 'FIAT', 'AED', 'AED_ZAND'),
    type: 'FIAT',
    currency: 'AED',
    code: 'AED',
    network: 'AED_ZAND',
    description: 'United Arab Emirates Dirham',
    decimals: 2,
    contractAddress: null,
    isNative: true,
    standard: null,
    minConfirmations: 0,
    custodianAssetKey: null,
  },
  {
    assetNo: buildDeterministicNo('AS', 'CRYPTO', 'USDT', 'TRON'),
    type: 'CRYPTO',
    currency: 'USDT',
    code: 'USDT-TRON',
    network: 'TRON',
    description: 'Tether (TRC-20)',
    decimals: 6,
    contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    isNative: false,
    standard: 'TRC-20',
    minConfirmations: 19,
    custodianAssetKey: 'tron_USDT',
  },
];
```

（`status: 'ACTIVE'` 从清单删掉——状态是种子写的，不是清单的属性。`seed.business.ts` 在 Task 2 跟改。）

- [ ] **Step 8: 删两份旧清单**

```bash
git rm src/config/manifests/asset-config.manifest.ts src/config/manifests/pricing-policies.manifest.ts
```

- [ ] **Step 9: 跑单测 + tsc**

Run: `npx jest src/config/manifests src/common/utils/tron-address --no-coverage && npx tsc --noEmit -p tsconfig.json`
Expected: 两份 spec 全绿；tsc 这一步会因 `prisma/seed.business.ts` 里 `asset.status` / `asset.network` 类型变化报错——**允许**，Task 2 Step 3 修种子时消掉；本任务的 tsc 判据是"除 `prisma/seed.business.ts` 外零错误"。

- [ ] **Step 10: Commit**

```bash
git add src/config/manifests src/common/utils/tron-address.util.ts src/common/utils/tron-address.util.spec.ts
git commit -m "feat(v3): 网络与 vault 注册表 + 资产清单终态 + TRON 假地址工具（波一 T1）"
```

**本任务过哪几条**：改代码随手闸（tsc 例外已说明 + jest）；无前端、无 schema、无钱、无审计码——其余行不触发。

---

### Task 2: 资产块后端——表终态、两边状态机、退役上架 / 激活 / 编辑整条路

**本任务做**：`Asset` 表按 spec §3 收正 + 迁移；状态机只剩 `ACTIVE ⇄ SUSPENDED` 两边；暂停 / 恢复请求层改走迁移表并写 `approvalCaseNo`；退役 listing / activation / 编辑三条路（代码 + 路由 + 策略 + 审计码 + 权限桶）；`GET /assets/:id` → `:assetNo`；`ASSET_CONFIG_WRITE` 持有人 TECH_OFFICER → OPS_OFFICER；`verify:act1` B7 改写；种子跟改。**不做**：新资产上线整条流程（BACKLOG 已登记）；页面（Task 3）；`Asset.wallets` / `Asset.withdrawalAddresses` 两个关系（Task 4 / 8 随各自表删）。

**Files:**
- Modify: `prisma/schema.prisma`（`model Asset`，第 625–669 行）
- Create: `prisma/migrations/<ts>_v3w1_asset_terminal/migration.sql`（`prisma migrate dev --create-only` 生成）
- Modify: `prisma/seed.business.ts`（`seedAssets` 第 105–135 行）
- Modify: `src/modules/asset-treasury/assets/constants/asset-transitions.constant.ts`
- Modify: `src/modules/asset-treasury/assets/assets.service.ts`（整文件重写）
- Modify: `src/modules/asset-treasury/assets/assets.controller.ts`（`:id` → `:assetNo`）
- Create: `src/modules/asset-treasury/assets/asset-admin.controller.ts`
- Modify: `src/modules/asset-treasury/assets/asset-suspension-workflow.service.ts`、`asset-reactivation-workflow.service.ts`
- Modify: `src/modules/asset-treasury/assets/asset-provisioning.service.ts`（导出 `systemAccountCodesFor`）
- Modify: `src/modules/asset-treasury/assets/assets.module.ts`、`dto/asset.dto.ts`
- Modify: `src/modules/asset-treasury/assets/assets.service.spec.ts`、`asset-provisioning.service.spec.ts`
- Delete: `asset-listing-workflow.service.ts`、`asset-listing.controller.ts`、`asset-activation-workflow.service.ts`、`asset-activation-approval.service.ts`、`dto/submit-asset-listing.dto.ts`、`dto/update-asset.dto.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（第 404–411 行资产路由、第 690–697 行桶、第 933 / 963 行绑定）
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（删 `ASSET_ACTIVATION` 类型 / 策略 / 白名单）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（六码进退役闸）
- Modify: `scripts/verify-act1.ts`（B7，第 252–262 行）
- Modify: `client-web/src/pages/TransactionHistory.tsx`（第 76 行 `/assets/${assetId}` 消费方）

**Interfaces:**
- Consumes: Task 1 的 `DEFAULT_ASSETS`、`assertNetwork`。
- Produces: `AssetsService.findOne(assetNo)`、`suspendAsset(assetId, reason, tx?)`、`reactivateAsset(assetId, tx?)`、`linkApprovalCase(assetNo, approvalCaseNo, tx?)`、`clearApprovalCase(assetNo, tx?)`、`findByAssetNo`、`findByCode`；`ASSET_TRANSITIONS` 只含 `ACTIVE.SUSPEND / SUSPENDED.REACTIVATE`；`systemAccountCodesFor(type: 'FIAT' | 'CRYPTO')`；路由 `GET /assets/:assetNo`、`POST /admin/assets/:assetNo/suspend`、`POST /admin/assets/:assetNo/reactivate`。

- [ ] **Step 1: 退役前逐键 grep（记录到任务报告）**

```bash
for k in AssetListingWorkflowService AssetListingController AssetActivationWorkflowService AssetActivationApprovalService SubmitAssetListingDto UpdateAssetDto checkReadiness updateProvisioningFields createAsset activateAsset ASSET_ACTIVATION minDepositAmount maxDepositAmount minWithdrawAmount maxWithdrawAmount depositEnabled withdrawalEnabled preSuspendDepositEnabled ASSET_CREATED_AND_PROVISIONED ASSET_CREATION_FAILED ASSET_PROVISIONING_UPDATED ASSET_ACTIVATION_REQUESTED ASSET_ACTIVATED ASSET_ACTIVATION_FAILED; do echo "== $k"; git grep -n "$k" -- src prisma scripts test admin-web/src client-web/src | grep -v "\.md:" ; done
```
Expected: 每个键的命中都落在本任务 Files 列表或 Task 3 的前端文件里；出现列表之外的文件 → 先读那处再决定，不许盲删。

- [ ] **Step 2: 写失败的单测（状态机两边 + 服务）**

`src/modules/asset-treasury/assets/assets.service.spec.ts` 顶部两个 describe 改为：

```ts
describe('资产状态迁移表（波一 · 两边）', () => {
  it('ACTIVE --SUSPEND--> SUSPENDED；SUSPENDED --REACTIVATE--> ACTIVE', () => {
    expect(assertAssetTransition('ACTIVE', AssetAction.SUSPEND)).toBe('SUSPENDED');
    expect(assertAssetTransition('SUSPENDED', AssetAction.REACTIVATE)).toBe('ACTIVE');
  });
  it('非法跃迁：ACTIVE 不能 REACTIVATE、SUSPENDED 不能 SUSPEND', () => {
    expect(() => assertAssetTransition('ACTIVE', AssetAction.REACTIVATE)).toThrow(/Invalid transition/);
    expect(() => assertAssetTransition('SUSPENDED', AssetAction.SUSPEND)).toThrow(/Invalid transition/);
  });
  it('PROVISIONING 与 ACTIVATE 已退役：表里没有这两个键', () => {
    expect((ASSET_TRANSITIONS as any).PROVISIONING).toBeUndefined();
    expect((AssetAction as any).ACTIVATE).toBeUndefined();
  });
});
```
（import 行加 `ASSET_TRANSITIONS`。）文件下方凡引用 `activateAsset` / `createAsset` / `updateProvisioningFields` / `PROVISIONING` 的 `it` 整段删除；`suspendAsset` / `reactivateAsset` 的用例把 `preSuspend*` / `depositEnabled` 断言删掉，只断言 `status` 与 `suspendedAt` / `suspendReason`。

Run: `npx jest src/modules/asset-treasury/assets --no-coverage`
Expected: FAIL（`ASSET_TRANSITIONS.PROVISIONING` 仍存在）。

- [ ] **Step 3: schema 终态 + 迁移 + 种子**

`prisma/schema.prisma` 的 `model Asset` 改为（关系列除 `wallets` / `withdrawalAddresses` 外原样保留，这两条本任务不动）：

```prisma
model Asset {
  id                String    @id @default(uuid())
  assetNo           String    @unique
  type              String
  currency          String
  code              String    @unique
  network           String
  decimals          Int
  description       String?
  contractAddress   String?
  isNative          Boolean   @default(true)
  standard          String?
  minConfirmations  Int       @default(0)
  custodianAssetKey String?
  status            String    @default("ACTIVE")
  tbLedgerId        Int?      @unique
  approvalCaseNo    String?
  suspendedAt       DateTime?
  suspendReason     String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  depositTransactions            DepositTransaction[]
  inboundTransferSignals         InboundTransferSignal[]
  swapFromTransactions           SwapTransaction[]               @relation("SwapFromAsset")
  swapToTransactions             SwapTransaction[]               @relation("SwapToAsset")
  swapQuoteFroms                 SwapQuote[]                     @relation("SwapQuoteFromAsset")
  swapQuoteTos                   SwapQuote[]                     @relation("SwapQuoteToAsset")
  withdrawPricingQuotes          WithdrawPricingQuote[]
  wallets                        Wallet[]
  withdrawTransactions           WithdrawTransaction[]
  fundsOrders                    FundsOrder[]
  reconciliationCases            ReconciliationCase[]
  withdrawalAddresses            WithdrawalAddress[]
  withdrawalFeeLevels            WithdrawalFeeLevel[]
  swapFeeLevelsFrom              SwapFeeLevel[]                  @relation("SwapFeeLevelFromAsset")
  swapFeeLevelsTo                SwapFeeLevel[]                  @relation("SwapFeeLevelToAsset")

  @@unique([type, currency, network])
  @@map("assets")
}
```

```bash
export DATABASE_URL="$(source scripts/db-env.sh && read_database_url "$PWD" self)"
npx prisma migrate dev --create-only --name v3w1_asset_terminal && npx prisma generate
```
Expected: 生成的 `migration.sql` 是 SQLite 表重建（`CREATE TABLE "new_assets" … INSERT INTO "new_assets" … DROP TABLE "assets" … ALTER TABLE "new_assets" RENAME TO "assets"`），含 `assetNo TEXT NOT NULL`、`network TEXT NOT NULL`，不含被删的 9 列。

`prisma/seed.business.ts` 的 `seedAssets`：删掉 `normalizeNetwork` 函数及其调用（`network: ''` 的时代结束）；循环体第一行加 `assertNetwork(asset.network);`（import 自 `../src/config/manifests/networks.manifest`——spec §2：三列写入前都过它，种子也不例外）；upsert 改为：

```ts
    const record = await prisma.asset.upsert({
      where: { type_currency_network: { type: asset.type, currency: asset.currency, network: asset.network } },
      update: {
        assetNo: asset.assetNo,
        code: asset.code,
        decimals: asset.decimals,
        description: asset.description,
        contractAddress: asset.contractAddress,
        isNative: asset.isNative,
        standard: asset.standard,
        minConfirmations: asset.minConfirmations,
        custodianAssetKey: asset.custodianAssetKey,
        status: 'ACTIVE',
        tbLedgerId: ledger,
      },
      create: {
        assetNo: asset.assetNo,
        type: asset.type,
        currency: asset.currency,
        code: asset.code,
        network: asset.network,
        decimals: asset.decimals,
        description: asset.description,
        contractAddress: asset.contractAddress,
        isNative: asset.isNative,
        standard: asset.standard,
        minConfirmations: asset.minConfirmations,
        custodianAssetKey: asset.custodianAssetKey,
        status: 'ACTIVE',
        tbLedgerId: ledger,
      },
    });
```
系统 TB 科目那段的 `systemAccounts` 内联数组改为 `systemAccountCodesFor(asset.type)`（Step 6 导出）。同文件系统钱包 upsert 那段（第 163–235 行）本任务**不动**（Task 4 整段换成按网络铺 7 行）；只把 `normalizedNetwork` 变量替换为 `asset.network`，让它先能编译。

- [ ] **Step 4: 迁移表两边 + DTO**

`constants/asset-transitions.constant.ts`：

```ts
import { ConflictException } from '@nestjs/common';

export enum AssetAction {
  SUSPEND = 'SUSPEND',
  REACTIVATE = 'REACTIVATE',
}

/** 资产状态迁移表（法二）。波一：上架 / 激活整条路退役，只剩暂停与恢复两边（spec §3）。 */
export const ASSET_TRANSITIONS: Record<string, Partial<Record<AssetAction, string>>> = {
  ACTIVE:    { [AssetAction.SUSPEND]: 'SUSPENDED' },
  SUSPENDED: { [AssetAction.REACTIVATE]: 'ACTIVE' },
};

export function assertAssetTransition(from: string, action: AssetAction): string {
  const to = ASSET_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: asset in ${from} cannot ${action}`);
  return to;
}
```

`dto/asset.dto.ts`：`AssetStatus` 只留 `ACTIVE` / `SUSPENDED`；`CreateAssetDto` 与 `UpdateAssetStatusDto` 先 `git grep -n "CreateAssetDto\|UpdateAssetStatusDto" -- src`，零引用则删。

- [ ] **Step 5: 服务重写**

`assets.service.ts` 整文件：

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { assertAssetTransition, AssetAction } from './constants/asset-transitions.constant';

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.AssetWhereInput;
    orderBy?: Prisma.AssetOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({ skip, take, where, orderBy }),
      this.prisma.asset.count({ where }),
    ]);
    return { items, total };
  }

  /** 铁律⑥：对外只认 assetNo，内部 id 不再是查询键 */
  async findOne(assetNo: string) {
    const item = await this.prisma.asset.findUnique({ where: { assetNo } });
    if (!item) throw new NotFoundException('Asset not found');
    return item;
  }

  async findByAssetNo(assetNo: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.asset.findUnique({ where: { assetNo } });
  }

  async findByCode(code: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.asset.findUnique({ where: { code } });
  }

  async suspendAsset(assetId: string, reason: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const asset = await db.asset.findUnique({ where: { id: assetId }, select: { id: true, assetNo: true, status: true } });
    if (!asset) throw new NotFoundException('Asset not found');
    const to = assertAssetTransition(asset.status, AssetAction.SUSPEND);
    return db.asset.update({
      where: { id: assetId },
      data: { status: to, suspendedAt: new Date(), suspendReason: reason, approvalCaseNo: null },
      select: { id: true, assetNo: true, status: true },
    });
  }

  async reactivateAsset(assetId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const asset = await db.asset.findUnique({ where: { id: assetId }, select: { id: true, assetNo: true, status: true } });
    if (!asset) throw new NotFoundException('Asset not found');
    const to = assertAssetTransition(asset.status, AssetAction.REACTIVATE);
    return db.asset.update({
      where: { id: assetId },
      data: { status: to, suspendedAt: null, suspendReason: null, approvalCaseNo: null },
      select: { id: true, assetNo: true, status: true },
    });
  }

  /** 待批的暂停 / 恢复单号挂在资产上（详情页待批徽章读它） */
  async linkApprovalCase(assetNo: string, approvalCaseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.asset.update({ where: { assetNo }, data: { approvalCaseNo } });
  }

  async clearApprovalCase(assetNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.asset.update({ where: { assetNo }, data: { approvalCaseNo: null } });
  }
}
```

- [ ] **Step 6: provisioning 只留给种子用的纯函数**

`asset-provisioning.service.ts` 顶部（class 之前）加导出，class 内的 `systemCodes` 内联数组改为调用它：

```ts
/** 每个资产装载时必须先开好的系统级 TB 科目（先有账后有货）。
 *  波一起只有种子调用它（seed.business.ts#seedAssets）；AssetProvisioningService.provision()
 *  留给将来的上币流程（BACKLOG「新资产上线整条流程」），当下零运行时调用方。 */
export function systemAccountCodesFor(assetType: string): Array<{ code: number; desc: string }> {
  const isFiat = assetType === 'FIAT';
  return [
    { code: TB_ACCOUNT_CODES.CLIENT_ASSET, desc: 'CLIENT_ASSET' },
    { code: TB_ACCOUNT_CODES.FIRM_ASSET, desc: 'FIRM_ASSET' },
    { code: TB_ACCOUNT_CODES.FIRM_OPS, desc: 'FIRM_OPS' },
    { code: TB_ACCOUNT_CODES.INCOME_SWAP_FEE, desc: 'INCOME_SWAP_FEE' },
    { code: TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, desc: 'INCOME_WITHDRAW_FEE' },
    { code: TB_ACCOUNT_CODES.INCOME_OTHER, desc: 'INCOME_OTHER' },
    ...(isFiat ? [{ code: TB_ACCOUNT_CODES.FIRM_SET, desc: 'FIRM_SET' }] : []),
  ];
}
```
`asset-provisioning.service.spec.ts` 加一条：`systemAccountCodesFor('FIAT')` 7 个码含 `FIRM_SET`、`'CRYPTO'` 6 个码不含。`prisma/seed.business.ts` 顶部 `import { systemAccountCodesFor } from '../src/modules/asset-treasury/assets/asset-provisioning.service';`。

- [ ] **Step 7: 暂停 / 恢复请求层改走迁移表 + 挂待批单号**

`asset-suspension-workflow.service.ts#requestSuspension`：
- 把 `if (asset.status !== 'ACTIVE') { throw new ConflictException(...) }` 换成 `assertAssetTransition(asset.status, AssetAction.SUSPEND);`（import 自 `./constants/asset-transitions.constant`）。
- `objectSnapshot` 删 `depositEnabled` / `withdrawalEnabled` 两项；`beforeData` 改为 `{ status: asset.status }`。
- `createAndSubmit` 成功后、写审计前加：`await this.assetsService.linkApprovalCase(assetNo, approvalCase.approvalNo);`
- `handleApprovalDecided`：非 `APPROVED` 分支加 `await this.assetsService.clearApprovalCase(event.entityRef);`（`suspendAsset` 落地时自己清）。

`asset-reactivation-workflow.service.ts#requestReactivation` 同构：`assertAssetTransition(asset.status, AssetAction.REACTIVATE)` 取代 `!== 'SUSPENDED'` 判断；成功后 `linkApprovalCase`；非 APPROVED 分支 `clearApprovalCase`；`beforeData` 保留 `{ status, suspendedAt, suspendReason }`。

- [ ] **Step 8: 控制器——公共只读改 `:assetNo`，管理端只剩暂停 / 恢复**

`assets.controller.ts` 的 `findOne`：

```ts
  @Get(':assetNo')
  @ApiOperation({ summary: 'Get an asset by asset number' })
  findOne(@Param('assetNo') assetNo: string) {
    return this.service.findOne(assetNo);
  }
```

新建 `asset-admin.controller.ts`（取代 `asset-listing.controller.ts`）：

```ts
import { Controller, Post, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { AssetReactivationWorkflowService } from './asset-reactivation-workflow.service';
import { SuspendAssetDto } from './dto/suspend-asset.dto';

/** 波一：资产管理面只剩暂停 / 恢复（提单人运营，裁决人 CISO）；上架 / 激活 / 编辑整条路已退役。 */
@Controller('admin/assets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AssetAdminController {
  constructor(
    private readonly suspensionWorkflow: AssetSuspensionWorkflowService,
    private readonly reactivationWorkflow: AssetReactivationWorkflowService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin token required');
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: req.user.userId,
      userNo: req.user.userNo,
      role: req.user.role || 'ADMIN',
      roleCodes: req.user.roleCodes || [req.user.role || 'ADMIN'],
    };
  }

  @Post(':assetNo/suspend')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/suspend'))
  async suspendAsset(@Param('assetNo') assetNo: string, @Body() dto: SuspendAssetDto, @Req() req: any) {
    this.ensureAdmin(req);
    return this.suspensionWorkflow.requestSuspension(assetNo, dto.reason, this.buildAdminActor(req));
  }

  @Post(':assetNo/reactivate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/reactivate'))
  async reactivateAsset(@Param('assetNo') assetNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.reactivationWorkflow.requestReactivation(assetNo, this.buildAdminActor(req));
  }
}
```

`assets.module.ts`：controllers `[AssetsController, AssetAdminController]`；providers 删 `AssetListingWorkflowService` / `AssetActivationApprovalService` / `AssetActivationWorkflowService`；imports 删 `WalletsModule`（只有就绪检查用它）。

- [ ] **Step 9: 删文件**

```bash
git rm src/modules/asset-treasury/assets/asset-listing-workflow.service.ts src/modules/asset-treasury/assets/asset-listing.controller.ts src/modules/asset-treasury/assets/asset-activation-workflow.service.ts src/modules/asset-treasury/assets/asset-activation-approval.service.ts src/modules/asset-treasury/assets/dto/submit-asset-listing.dto.ts src/modules/asset-treasury/assets/dto/update-asset.dto.ts
```

- [ ] **Step 10: 策略、审计码、RBAC**

`approval.constants.ts`：删 `ApprovalActionTypes.ASSET_ACTIVATION` 键、`DEFAULT_APPROVAL_POLICIES` 里 `[ApprovalActionTypes.ASSET_ACTIVATION]` 段（第 245–250 行）、`V1_APPROVAL_ACTION_TYPES` 里那一项。`ASSET_SUSPENSION` / `ASSET_REACTIVATION`（CISO 12h）不动。

`audit-actions.constant.ts`：
- `V1_AUDIT_ACTIONS` 删六行：`ASSET_CREATED_AND_PROVISIONED`、`ASSET_CREATION_FAILED`、`ASSET_PROVISIONING_UPDATED`、`ASSET_ACTIVATION_REQUESTED`、`ASSET_ACTIVATED`、`ASSET_ACTIVATION_FAILED`；保留 `ASSET_SUSPENSION_*` / `ASSET_REACTIVATION_*` 六码。
- `DEPRECATED_AUDIT_ACTIONS` 末尾追加：

```ts
  // 2026-09-04 波一（V3 治愈）：上架 / 激活 / 编辑整条路退役（业主定「本轮不做新资产上线」），
  // 写点 asset-listing-workflow / asset-activation-workflow 已整文件删除，六码登退役闸
  'ASSET_CREATED_AND_PROVISIONED', 'ASSET_CREATION_FAILED', 'ASSET_PROVISIONING_UPDATED',
  'ASSET_ACTIVATION_REQUESTED', 'ASSET_ACTIVATED', 'ASSET_ACTIVATION_FAILED',
```
- `AuditBusinessWorkflowTypes.ASSET_CREATION` / `ASSET_ACTIVATION` 与 `AuditActions.ASSET_CREATION` / `ASSET_ACTIVATION`：`git grep` 零引用即删（`AuditActions` 平面键若删不掉——被 `audit-actions.constant.spec.ts` 或 map 引用——留着不动，它们在退役闸里不违反封册 ①）。
- 跑 `npx jest src/modules/audit-logging/constants --no-coverage`，四条封册全绿。

`rbac.catalog.ts`：
- 第 405 行 `route('GET', '/assets/:id', …)` 改 `route('GET', '/assets/:assetNo', 'Get asset detail', ['ASSET_CONFIG_READ'])`；删 `/admin/assets/listing`、`PATCH /admin/assets/:assetNo`、`/activate` 三行。
- 桶 `treasury.manage_assets`：`label: 'Suspend / reactivate assets'`，`description: 'Submit asset suspension and reactivation requests — CISO signs them off'`。
- `RBAC_ROLE_GROUP_BINDINGS`：`TECH_OFFICER` 那行 `'ASSET_CONFIG_READ', 'ASSET_CONFIG_WRITE',` 改成只留 `'ASSET_CONFIG_READ',`；`OPS_OFFICER` 的 `'ASSET_CONFIG_READ', 'WALLET_READ', 'WITHDRAWAL_ADDRESS_READ',` 改为 `'ASSET_CONFIG_READ', 'ASSET_CONFIG_WRITE', 'WALLET_READ', 'WITHDRAWAL_ADDRESS_READ',`。上面 `TREASURY_OFFICER` 注释里"与技术官的分界是「容器 vs 配置」"改为"暂停 / 恢复资产归运营"。

- [ ] **Step 11: verify:act1 B7 改写**

`scripts/verify-act1.ts` 第 252–262 行改为：

```ts
  // ══════════════════════ B7：资产状态迁移表（法二，铁律④）══════════════════════
  // 波一起：上架 / 激活退役，表只剩 ACTIVE⇄SUSPENDED 两边；提单人换运营。
  // 对 ACTIVE 资产打 reactivate 必须被迁移表拒绝（409 + 'Invalid transition'），
  // 而不是请求层另写一条 if——请求层已改走表（asset-reactivation-workflow.service.ts）。

  precheckRoute('POST', '/admin/assets/:assetNo/reactivate');
  const activeAsset = await prisma.asset.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  const b7 = await call('POST', `/admin/assets/${activeAsset.assetNo}/reactivate`, tokens.ops_officer);
  const b7MsgOk = typeof b7.json?.message === 'string' && b7.json.message.includes('Invalid transition');
  judge(
    'B7',
    b7.status === 409 && b7MsgOk,
    `POST reactivate(ACTIVE 资产, ops_officer@) → ${b7.status} ${JSON.stringify(b7.json)}（期望 409 + 'Invalid transition'）`,
  );
```

- [ ] **Step 12: 客户端唯一的 `/assets/<uuid>` 消费方跟改**

`client-web/src/pages/TransactionHistory.tsx` 第 73–85 行 `fetchAssetInfo`：`/assets/${assetId}` 换成列表查找：

```ts
  const fetchAssetInfo = useCallback(async () => {
    if (!assetId) return;
    try {
      const response = await customerFetch(`${import.meta.env.VITE_API_URL}/assets?take=200`);
      if (response.ok) {
        const data = await response.json();
        const found = (data.items || []).find((a: { id: string }) => a.id === assetId) ?? null;
        setAssetInfo(found);
      }
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      console.error('Failed to fetch asset info', err);
    }
  }, [assetId]);
```

- [ ] **Step 13: 闸门**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/asset-treasury/assets src/modules/audit-logging/constants --no-coverage
cd client-web && npx tsc -b --noEmit && cd ..
bash scripts/stack.sh down self && bash scripts/stack.sh reset self && bash scripts/stack.sh up self
sqlite3 "$(source scripts/db-env.sh && read_database_url "$PWD" self | sed 's#^file:##')" "select assetNo, code, network, contractAddress, standard, status from assets;"
```
Expected: tsc ① 零错误（`admin-web` 的 tsc ② 此时会因 `AssetCreate.tsx` 仍引用被删端点的 DTO 类型？——不会，前端不 import 后端类型；②③ 都应绿）；jest 全绿；sqlite 两行：`AED | AED_ZAND | (null) | (null) | ACTIVE`、`USDT-TRON | TRON | TR7N… | TRC-20 | ACTIVE`。

- [ ] **Step 14: Commit**

```bash
git add prisma src/modules/asset-treasury/assets src/modules/identity/access-control/rbac.catalog.ts src/modules/governance/approvals/constants/approval.constants.ts src/modules/audit-logging/constants/audit-actions.constant.ts scripts/verify-act1.ts client-web/src/pages/TransactionHistory.tsx
git commit -m "feat(v3): 资产表终态 + 两边状态机 + 退役上架/激活/编辑整条路，暂停恢复提单人改运营（波一 T2）"
```

**本任务过哪几条**：改 schema / seed → 重铺闸（已跑 `reset self`）；改 RBAC / 策略 → `db:base:sync` + 重启（`reset self` 已含 base seed，起栈即新后端）；改审计码 → 四属性合同 + 封册 spec 绿 + 退役闸；改路由 → catalog 行同步（S7）；判据改写（B7）；不动钱、不改页面（Task 3 截图）。

---

### Task 3: 资产管理台页面——列表无新建、详情补身份字段、动作只剩暂停 / 恢复 + 待批徽章

**本任务做**：`AssetList` / `AssetDetail` 按 spec §3「页面」改；删 `AssetCreate` / `AssetEdit` 两页与两棵路由树里的对应路由；删前端 `ASSETS_CREATE` 权限码；真机截图。**不做**：后端（Task 2 已完）；客户端资产相关页（不受影响）。

**Files:**
- Modify: `admin-web/src/pages/AssetList.tsx`（第 143–149 行「New Asset」按钮、第 183 行 PROVISIONING 选项）
- Modify: `admin-web/src/pages/AssetDetail.tsx`（第 11–27 行类型、第 88–96 / 122–142 行激活态与 handler、第 255–300 行 Hero 与 Details、第 309–347 行动作区、第 370–415 行 Activate 弹窗）
- Modify: `admin-web/src/App.tsx`（第 372、376、469、470 行四条路由 + import）
- Modify: `admin-web/src/rbac/permissions.ts`（第 98–104 行 `ASSETS_CREATE` 及注释）
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx`（`ASSET_ACTIVATION` 映射行）
- Delete: `admin-web/src/pages/AssetCreate.tsx`、`admin-web/src/pages/AssetEdit.tsx`

**Interfaces:**
- Consumes: `GET /assets/:assetNo` 返回的 `Asset`（含 `contractAddress / isNative / standard / minConfirmations / custodianAssetKey / approvalCaseNo / suspendedAt / suspendReason`）；`POST /admin/assets/:assetNo/suspend`、`/reactivate`。

- [ ] **Step 1: 逐键 grep**

```bash
git grep -n "AssetCreate\|AssetEdit\|ASSETS_CREATE\|assets/create\|/edit\b\|depositEnabled\|withdrawalEnabled\|PROVISIONING" -- admin-web/src
```
Expected: 命中只在本任务 Files 列表里。

- [ ] **Step 2: 删两页 + 路由 + 权限码**

```bash
git rm admin-web/src/pages/AssetCreate.tsx admin-web/src/pages/AssetEdit.tsx
```
`App.tsx`：删 `import AssetCreate` / `import AssetEdit` 两行；删 `path="system/assets/create"`、`path="system/assets/:assetNo/edit"` 两个 `<Route>`（第 372–379 行）与 `assets/create`、`assets/:assetNo/edit` 两个 `<Route>`（第 469–470 行）。
`permissions.ts`：删第 98–104 行（`ASSETS_CREATE` 及其上方整段注释）。
`pages/ApprovalDetailPage.tsx`：删 `ASSET_ACTIVATION: (r) => `/admin/assets/${r}`,` 一行（`ASSET_SUSPENSION` / `ASSET_REACTIVATION` 两行保留）。

- [ ] **Step 3: 列表页**

`AssetList.tsx`：删第 143–149 行的「New Asset」按钮整块；`Plus` 图标 import 若无其它引用一并删；第 183 行 `<option value="PROVISIONING">PROVISIONING</option>` 删。

- [ ] **Step 4: 详情页**

`AssetDetail.tsx`：
1. 类型 `AssetDetailData` 改为：

```ts
interface AssetDetailData {
  id: string;
  assetNo: string;
  type: 'FIAT' | 'CRYPTO';
  currency: string;
  code: string;
  network: string;
  decimals: number;
  description: string | null;
  contractAddress: string | null;
  isNative: boolean;
  standard: string | null;
  minConfirmations: number;
  custodianAssetKey: string | null;
  status: string;
  approvalCaseNo: string | null;
  suspendedAt?: string | null;
  suspendReason?: string | null;
  createdAt: string;
  updatedAt: string;
}
```
2. 删 `showActivateModal` / `submittingActivate` 两个 state、`handleSubmitActivate`、Activate 弹窗整块（第 370–415 行）、动作区里 `asset.status === 'PROVISIONING' && (...)` 分支（Edit Asset + Activate Asset 两个按钮）。
3. Hero 段（第 262–270 行）：`{asset.network && <InfoField label="Network" value={asset.network} />}` 改为无条件 `<InfoField label="Network" value={asset.network} />`；状态徽章旁加待批徽章：

```tsx
              {asset.approvalCaseNo && (
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Pending Approval</div>
                  <button
                    onClick={() => navigate(`/admin/governance/approvals/${asset.approvalCaseNo}`)}
                    className="mt-1 font-mono text-[11px] text-adm-amber hover:underline"
                  >
                    {asset.approvalCaseNo}
                  </button>
                </div>
              )}
```
4. 「② Details」段（第 273–283 行）改为：

```tsx
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Code" value={asset.code} mono />
              <InfoField label="Currency" value={asset.currency} mono />
              <InfoField label="Type" value={asset.type} />
              <InfoField label="Network" value={asset.network} mono />
              <InfoField label="Contract Address" value={asset.isNative ? 'Native' : asset.contractAddress || '—'} mono copyable={!asset.isNative} />
              <InfoField label="Token Standard" value={asset.standard || '—'} />
              <InfoField label="Confirmations" value={String(asset.minConfirmations)} mono />
              <InfoField label="Custodian Asset Key" value={asset.custodianAssetKey || '—'} mono />
              <InfoField label="Decimals" value={String(asset.decimals)} mono />
              <InfoField label="Description" value={asset.description || '—'} />
            </div>
```
（`InfoField` 若尚无 `copyable` 属性，查同目录 `CustodianWalletDetail.tsx` 的 `InfoField` 定义——它有 `copyable` / `copied` / `onCopy`；本页的 `InfoField` 按同款补 `copyable` 即可，或去掉 `copyable` 只展示。）
5. 删「③ Deposit & Withdrawal」整段（第 285–291 行）。
6. 动作区：`Suspend Asset` 只在 `asset.status === 'ACTIVE' && !asset.approvalCaseNo` 显示；`Reactivate Asset` 只在 `asset.status === 'SUSPENDED' && !asset.approvalCaseNo`；有待批单时动作区显示一行 `<p className="font-mono text-[10px] text-adm-t3">Waiting for CISO decision on {asset.approvalCaseNo}</p>`。两个弹窗里的说明文案改为 `Submitted by Operations, decided by CISO (12h)`。

- [ ] **Step 5: tsc ②**

Run: `cd admin-web && npx tsc -b --noEmit && cd ..`
Expected: 零错误。

- [ ] **Step 6: 真机截图（preview）**

1. 后端与前端已由 `stack.sh up self` 起着；用 preview 打开 `http://localhost:<P+1>`，`ops_officer@fiatx.com` / `123456` 登录。
2. Assets 列表：确认没有「New Asset」按钮、状态筛选只有 ACTIVE / SUSPENDED → 截图 ①。
3. 打开 USDT-TRON 详情：Hero 有 Network；Details 有 Contract Address `TR7N…` / TRC-20 / 19 / `tron_USDT` → 截图 ②。
4. 点 Suspend Asset，填理由提交 → 详情出现待批徽章（审批单号可点）、Suspend 按钮消失 → 截图 ③。
5. 换 `ciso@` 登录审批中心批准 → 回 ops 视角刷新：状态 SUSPENDED、徽章消失、只剩 Reactivate → 截图 ④。
6. 点 Reactivate → ciso 批准 → 状态 ACTIVE（演示台账复位）。
7. `tech_admin@` 登录打开同一详情：没有 Suspend / Reactivate 按钮（`ASSET_CONFIG_WRITE` 已不在技术官手里；按钮若仍用 `hasAnyPermission` 门控则自然消失，若没有门控——加 `hasAnyPermission([PERMISSIONS.ASSET_SUSPEND])`，并在 `permissions.ts` 加 `ASSET_SUSPEND: 'api.post.admin_assets_assetno_suspend'`、`ASSET_REACTIVATE: 'api.post.admin_assets_assetno_reactivate'`）→ 截图 ⑤。

- [ ] **Step 7: Commit**

```bash
git add admin-web/src
git commit -m "feat(admin): 资产页去新建/编辑/激活，详情补网络·合约·标准·确认数·托管键 + 待批徽章（波一 T3）"
```

**本任务过哪几条**：改前端 → 必截图（5 张）；tsc ②；权限码 S6（`ASSETS_CREATE` 删掉后前端引用集合 ⊆ 后端目录）；页面改了 → `demo/script.md` 站 4 措辞在 Task 15 统一改。

---

### Task 4: 钱包表终态（地址行）+ 内核 + 客户充值地址唯一写路径 + 退役托管钱包创建

**本任务做**：`Wallet` 表按 spec §4 改成「一个地址一行」+ 迁移；`WalletsService` 迁移表只剩 `CREATING → ACTIVE | FAILED`；查询服务去余额、挂网络信息；`SystemWalletResolver` 暂不动（Task 6）；客户充值地址路径改签名 `createOrReturn(customerId, network)` + `POST /client/deposit-wallets { network }` + mock 托管方给 TRON 形态地址 / AE IBAN + 审计 `CUSTOMER_DEPOSIT_ADDRESS_CREATED`；平台 7 行从种子来；退役托管钱包创建整条路（workflow / approval / controller / DTO / 策略 / 路由 / `WALLET_WRITE` 组桶绑定 / 审计码）、`PATCH status` / `GET balance` / `WalletBalanceService` / 角色策略表 / VIBAN 常量；种子、`demo-lib`、`demo-fixtures`、`verify-act1` B6、19 处 e2e 建钱包夹具全部换钥匙。**不做**：充值 / 提现 / 兑换运行时路径（Task 5 / 6）；前端（Task 7）。

> ⚠️ 本任务结束时 tsc ①②③ 与 jest 必须绿，但 `demo:all` 会红（三域按资产找钱包的 `as any` 查询在 Task 6 才换）——这是设计内的中间态，报告里写明，不要在本任务里顺手去改 withdraw / deposit 工作流。

**Files:**
- Modify: `prisma/schema.prisma`（`model Wallet` 第 705–734 行；`model Asset` 删 `wallets Wallet[]`）
- Create: `prisma/migrations/<ts>_v3w1_wallet_address_rows/migration.sql`
- Modify: `prisma/seed.business.ts`（第 20–24 行 import、第 75–103 行两个地址 / IBAN 生成函数、第 163–235 行系统钱包段 → 新函数 `seedPlatformWallets`）
- Modify: `src/modules/asset-treasury/wallets/dto/wallet.dto.ts`、`dto/create-deposit-wallet.dto.ts`
- Modify: `src/modules/asset-treasury/wallets/system-wallet.util.ts`（+spec 重写）
- Modify: `src/modules/asset-treasury/wallets/wallets.service.ts`（整文件重写 +spec 重写）
- Modify: `src/modules/asset-treasury/wallets/wallets.controller.ts`（+spec）
- Modify: `src/modules/asset-treasury/wallets/wallet-query.service.ts`（+spec）
- Modify: `src/modules/asset-treasury/wallets/custodian-adapter.interface.ts`、`mock-custodian.adapter.ts`
- Modify: `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts`（整文件重写 +spec）、`customer-deposit-wallet.controller.ts`
- Modify: `src/modules/asset-treasury/wallets/wallets.module.ts`
- Delete: `custodian-wallet-create-workflow.service.ts`、`custodian-wallet-create-approval.service.ts`、`custodian-wallet-create.controller.ts`、`dto/create-custodian-wallet.dto.ts`、`wallet-balance.service.ts`、`wallet-balance.service.spec.ts`、`wallet-role-policies.constant.ts`、`wallet-role-policies.constant.spec.ts`、`customer-viban-bank.constant.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（第 42 行联合类型、第 369–376 行路由、第 699–710 行桶、第 955 行绑定）
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（删 `CUSTODIAN_WALLET_CREATE`）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `scripts/demo-lib.ts`（第 84–89、331–350、441–443、641–643、1108 行）、`scripts/demo-fixtures.ts`（第 163 行）、`scripts/verify-act1.ts`（第 239–241 行 B6 夹具）、`scripts/verify-audit.ts`（退役码名单）
- Modify: `test/*.e2e-spec.ts` 19 处建钱包夹具（清单见 Step 9）

**Interfaces:**
- Consumes: Task 1 的 `assertNetwork` / `NETWORKS` / `VAULTS` / `isVaultCode` / `platformWalletSlots` / `fakeTronAddress`。
- Produces: `WalletsService.createWalletRecord(input: CreateWalletRecordInput, tx?)`、`transitionStatus(walletNo, from, to, extra?, tx?)`、`findByWalletNo(walletNo, tx?)`、`findCustomerWalletByDestination(network, { address? | iban? }, tx?)`；`WALLET_STATUS_TRANSITIONS`；`WalletQueryService.findAll / findOne / hasReceivingAccount(customerId, network)`，返回行带 `networkInfo: { kind, custodian, bankName, accountName, explorerUrl }`；`CustomerDepositWalletService.createOrReturn(customerId, network)`；`CustodianAdapter.createAddress({ vaultCode, network, ownerNo }) → { custodianRef, address?, iban? }`；`system-wallet.util.ts` 的 `PLATFORM_WALLET_ROLES / CUSTOMER_DEPOSIT_ROLES / isPlatformWalletRole / customerRoleForNetworkKind`；`GET /wallets` 查询参数 `ownerType / ownerNo / vaultCode / walletRole / network / status / walletNo / q`；`POST /client/deposit-wallets { network }`；审计码 `CUSTOMER_DEPOSIT_ADDRESS_CREATED`。

- [ ] **Step 1: 退役前逐键 grep（记录到任务报告）**

```bash
for k in CustodianWalletCreateWorkflowService CustodianWalletCreateApprovalService CustodianWalletCreateController CreateCustodianWalletDto CUSTODIAN_WALLET_CREATE WALLET_WRITE WalletBalanceService mockBalance wallet-role-policies getWalletRolePolicy CUSTOMER_VIBAN_BANK_NAME CUSTOMER_VIBAN_ACCOUNT_NAME classifyWalletSurface WalletSurfaceCategory CUSTOMER_POOL_ROLES PLATFORM_POOL_ROLES isProtectedSystemWalletRole CRYPTO_SYSTEM_WALLET_ROLES FIAT_SYSTEM_WALLET_ROLES C_MAIN C_OUT C_CMA FROZEN DISABLED PENDING_APPROVAL WALLET_STATUS_UPDATED DEPOSIT_WALLET_CREATED vaultId "type: 'FIAT_BANK'" "type: 'CRYPTO_ADDRESS'" hasReceivingAccount; do echo "== $k"; git grep -n "$k" -- src prisma scripts test | grep -v "\.md:"; done
```
Expected: `FROZEN` / `DISABLED` / `PENDING_APPROVAL` 会大量命中交易域（订单状态）——只处理 wallets 目录、`wallet.dto.ts`、种子、脚本、夹具里**钱包**语境的命中；其余键的命中都应落在本任务 Files 列表或 Task 5–7 的文件里。

- [ ] **Step 2: 写失败的单测**

`src/modules/asset-treasury/wallets/wallets.service.spec.ts` 整文件替换：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { WalletsService, WALLET_STATUS_TRANSITIONS } from './wallets.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

const prismaMock = {
  wallet: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
};

describe('WalletsService（波一 · 地址行）', () => {
  let service: WalletsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = module.get(WalletsService);
  });

  describe('迁移表', () => {
    it('只有 CREATING → ACTIVE | FAILED 两条边，ACTIVE / FAILED 是终态', () => {
      expect(WALLET_STATUS_TRANSITIONS).toEqual({ CREATING: ['ACTIVE', 'FAILED'], ACTIVE: [], FAILED: [] });
    });
    it('transitionStatus 拒绝 ACTIVE → FAILED（409 Invalid / Illegal transition）', async () => {
      await expect(service.transitionStatus('WA1', 'ACTIVE', 'FAILED')).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.wallet.update).not.toHaveBeenCalled();
    });
    it('transitionStatus 的 from 绑定 DB 读值：行是 ACTIVE 却声称 CREATING → 409', async () => {
      prismaMock.wallet.findFirst.mockResolvedValue({ id: 'w1', walletNo: 'WA1', status: 'ACTIVE' });
      await expect(service.transitionStatus('WA1', 'CREATING', 'ACTIVE')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('createWalletRecord', () => {
    const base = { ownerType: 'CUSTOMER' as const, ownerId: 'c1', ownerNo: 'CU001', vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_DEP', network: 'TRON', status: 'CREATING' as const };

    it('拒绝未注册网络', async () => {
      await expect(service.createWalletRecord({ ...base, network: 'FIAT' })).rejects.toBeInstanceOf(BadRequestException);
    });
    it('拒绝 vault 在该网络没有槽位（F_SET × TRON）', async () => {
      await expect(service.createWalletRecord({ ...base, ownerType: 'PLATFORM', ownerNo: 'PLATFORM', vaultCode: 'F_SET', walletRole: 'F_SET' })).rejects.toThrow(/no address slot/);
    });
    it('拒绝 vault 归属类型与 ownerType 不符（客户开 F_OPS）', async () => {
      await expect(service.createWalletRecord({ ...base, vaultCode: 'F_OPS', walletRole: 'F_OPS' })).rejects.toThrow(/PLATFORM-owned/);
    });
    it('合法输入：写入 WA 开头的 walletNo，平台行 ownerId 置 null', async () => {
      prismaMock.wallet.create.mockImplementation(async ({ data }: any) => data);
      const row: any = await service.createWalletRecord({ ...base, ownerType: 'PLATFORM', ownerId: 'should-be-dropped', ownerNo: 'PLATFORM', vaultCode: 'F_OPS', walletRole: 'F_OPS', status: 'ACTIVE' });
      expect(row.walletNo).toMatch(/^WA\d{12}$/);
      expect(row.ownerId).toBeNull();
      expect(row.network).toBe('TRON');
    });
  });

  describe('findCustomerWalletByDestination', () => {
    it('链上按 (network, address) 找，法币按 (network, iban) 找，只认 CLIENT_DEPOSIT', async () => {
      prismaMock.wallet.findFirst.mockResolvedValue(null);
      await service.findCustomerWalletByDestination('TRON', { address: 'Tabc' });
      expect(prismaMock.wallet.findFirst).toHaveBeenLastCalledWith({ where: { network: 'TRON', ownerType: 'CUSTOMER', vaultCode: 'CLIENT_DEPOSIT', address: 'Tabc' } });
      await service.findCustomerWalletByDestination('AED_ZAND', { iban: 'AE07086' });
      expect(prismaMock.wallet.findFirst).toHaveBeenLastCalledWith({ where: { network: 'AED_ZAND', ownerType: 'CUSTOMER', vaultCode: 'CLIENT_DEPOSIT', iban: 'AE07086' } });
    });
  });
});
```

`system-wallet.util.spec.ts` 整文件替换：

```ts
import { PLATFORM_WALLET_ROLES, CUSTOMER_DEPOSIT_ROLES, isPlatformWalletRole, customerRoleForNetworkKind } from './system-wallet.util';

describe('system-wallet.util（波一）', () => {
  it('平台角色 = 四个 vault 码；客户收款角色 = C_DEP / C_VIBAN', () => {
    expect([...PLATFORM_WALLET_ROLES].sort()).toEqual(['F_FEE', 'F_LIQ', 'F_OPS', 'F_SET']);
    expect([...CUSTOMER_DEPOSIT_ROLES].sort()).toEqual(['C_DEP', 'C_VIBAN']);
  });
  it('C_MAIN / C_OUT / C_CMA 不再是任何角色', () => {
    for (const r of ['C_MAIN', 'C_OUT', 'C_CMA']) {
      expect(isPlatformWalletRole(r)).toBe(false);
      expect(CUSTOMER_DEPOSIT_ROLES.has(r)).toBe(false);
    }
  });
  it('客户收款角色由网络种类决定：CHAIN → C_DEP，BANK_RAIL → C_VIBAN', () => {
    expect(customerRoleForNetworkKind('CHAIN')).toBe('C_DEP');
    expect(customerRoleForNetworkKind('BANK_RAIL')).toBe('C_VIBAN');
  });
});
```

`customer-deposit-wallet.service.spec.ts`：三条既有用例把 `createOrReturn(customerId, assetId)` 的第二参改为 `'TRON'`，prisma mock 去掉 `asset.findUnique`，`wallet.findFirst` 的 `where` 断言改为 `{ ownerType: 'CUSTOMER', ownerId, vaultCode: 'CLIENT_DEPOSIT', network: 'TRON', status: 'ACTIVE' }`；custodian mock 的方法名改 `createAddress` 返回 `{ custodianRef: 'mock-hextrust-1', address: 'T…' }`；新增一条：`createOrReturn(customerId, 'FIAT')` → `BadRequestException`（未注册网络）。用例名对应改成"按网络"措辞。

`wallet-query.service.spec.ts`：删 `C_CMA derived balance` 与 `findBalance()` 两个 describe；`findAll` / `findOne` 里 "mockBalance as balance" 断言改为断言 `networkInfo`：

```ts
    it('每行挂 networkInfo（来自注册表）：TRON → HEXTRUST 无收款行；AED_ZAND → ZAND 带收款行', async () => {
      prismaMock.wallet.findMany.mockResolvedValue([
        { id: 'w1', ownerType: 'PLATFORM', ownerNo: 'PLATFORM', network: 'TRON' },
        { id: 'w2', ownerType: 'PLATFORM', ownerNo: 'PLATFORM', network: 'AED_ZAND' },
      ]);
      prismaMock.wallet.count.mockResolvedValue(2);
      const { items } = await service.findAll({});
      expect(items[0].networkInfo).toEqual({ kind: 'CHAIN', custodian: 'HEXTRUST', bankName: null, accountName: null, explorerUrl: 'https://tronscan.org/#/transaction/' });
      expect(items[1].networkInfo.bankName).toBe('Zand Bank PJSC');
      expect(items[0]).not.toHaveProperty('balance');
    });
```
`hasReceivingAccount` 两条用例第二参改为 `'TRON'`，`where` 断言改为 `{ ownerType: 'CUSTOMER', ownerId: 'c1', vaultCode: 'CLIENT_DEPOSIT', network: 'TRON', status: 'ACTIVE' }`。

`wallets.controller.spec.ts`：删 `should reject CUSTOMER changing wallet status` 用例；其余用例里 `assetId` 查询参数改 `network`。

Run: `npx jest src/modules/asset-treasury/wallets --no-coverage`
Expected: FAIL（导出不存在 / 签名不符）。

- [ ] **Step 3: schema 终态 + 迁移**

`prisma/schema.prisma` 的 `model Wallet` 整段替换：

```prisma
model Wallet {
  id           String   @id @default(uuid())
  walletNo     String   @unique
  ownerType    String                       // PLATFORM | CUSTOMER
  ownerId      String?                      // 内部外键（客户 UUID）；平台行 null（计划裁定 1）
  ownerNo      String                       // 客户号；平台行 'PLATFORM'
  vaultCode    String                       // F_OPS | F_SET | F_FEE | F_LIQ | CLIENT_DEPOSIT（vaults.manifest）
  walletRole   String                       // 平台行 = vaultCode；客户行 C_DEP（链上）/ C_VIBAN（法币通道）
  network      String                       // networks.manifest 的 code
  address      String?                      // CHAIN 网络的地址
  iban         String?                      // BANK_RAIL 网络的虚拟账号
  custodianRef String?                      // 托管方返回的钱包 id（原 vaultId）
  status       String   @default("ACTIVE")  // CREATING | ACTIVE | FAILED
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  depositTransactions     DepositTransaction[]
  depositTransactionsFrom DepositTransaction[]   @relation("DepositFromWallet")
  fundsOrdersFrom         FundsOrder[]           @relation("FundsOrderFromWallet")
  fundsOrdersTo           FundsOrder[]           @relation("FundsOrderToWallet")
  inboundTransferSignals  InboundTransferSignal[]

  @@unique([vaultCode, network, ownerNo])
  @@index([ownerType, ownerId])
  @@index([network, address])
  @@index([network, iban])
  @@map("wallets")
}
```
`model Asset` 删 `wallets Wallet[]` 一行。

```bash
export DATABASE_URL="$(source scripts/db-env.sh && read_database_url "$PWD" self)"
npx prisma migrate dev --create-only --name v3w1_wallet_address_rows && npx prisma generate
```
Expected: 表重建 SQL；新表无 `assetId / type / mockBalance / bankName / accountName / vaultId`，含 `vaultCode / network / custodianRef` 与三个索引 + 唯一键 `wallets_vaultCode_network_ownerNo_key`。

- [ ] **Step 4: DTO、角色工具、迁移表与服务**

`dto/wallet.dto.ts` 整文件：

```ts
export enum OwnerType {
  PLATFORM = 'PLATFORM',
  CUSTOMER = 'CUSTOMER',
  LIQUIDITY_PROVIDER = 'LIQUIDITY_PROVIDER',
}

/** 平台侧角色 = vault 码本身；客户侧按网络种类：链上 C_DEP / 法币通道 C_VIBAN。
 *  C_MAIN / C_OUT / C_CMA 已随 V7 池子退役，波一把枚举一起拔掉。 */
export enum WalletRole {
  C_DEP = 'C_DEP',
  C_VIBAN = 'C_VIBAN',
  F_LIQ = 'F_LIQ',
  F_OPS = 'F_OPS',
  F_SET = 'F_SET',
  F_FEE = 'F_FEE',
}

/** 只有开地址那一小段生命周期；ACTIVE / FAILED 都是终态（迁移表见 wallets.service.ts） */
export enum WalletStatus {
  CREATING = 'CREATING',
  ACTIVE = 'ACTIVE',
  FAILED = 'FAILED',
}
```

`dto/create-deposit-wallet.dto.ts`：

```ts
import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NETWORK_CODES } from '../../../../config/manifests/networks.manifest';

export class CreateDepositWalletDto {
  @ApiProperty({ description: 'Network code to open a deposit address on', enum: NETWORK_CODES })
  @IsString()
  @IsIn(NETWORK_CODES)
  network!: string;
}
```

`system-wallet.util.ts` 整文件：

```ts
import { WalletRole } from './dto/wallet.dto';
import type { NetworkKind } from '../../../config/manifests/networks.manifest';

/** 平台侧钱包角色 = vault 码本身（F_*）；四个 vault 在 vaults.manifest.ts 定义 */
export const PLATFORM_WALLET_ROLES: ReadonlySet<string> = new Set([
  WalletRole.F_OPS, WalletRole.F_SET, WalletRole.F_FEE, WalletRole.F_LIQ,
]);

/** 客户收款账户角色（CLIENT_DEPOSIT vault 下的行） */
export const CUSTOMER_DEPOSIT_ROLES: ReadonlySet<string> = new Set([
  WalletRole.C_DEP, WalletRole.C_VIBAN,
]);

export function isPlatformWalletRole(role: string): boolean {
  return PLATFORM_WALLET_ROLES.has(role);
}

/** 客户充值地址的角色由网络种类决定：链上 C_DEP，银行通道 C_VIBAN */
export function customerRoleForNetworkKind(kind: NetworkKind): WalletRole {
  return kind === 'CHAIN' ? WalletRole.C_DEP : WalletRole.C_VIBAN;
}
```

`wallets.service.ts` 整文件：

```ts
import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { assertNetwork } from '../../../config/manifests/networks.manifest';
import { VAULTS, isVaultCode } from '../../../config/manifests/vaults.manifest';

/** 钱包行状态迁移表（法二）。只有"开地址"那一小段生命周期；ACTIVE / FAILED 都是终态。
 *  DISABLED / FROZEN 已退役——客户侧停入金靠 V2 限制账（"限制是人的属性"），平台侧从不停（spec §4）。 */
export const WALLET_STATUS_TRANSITIONS: Record<string, string[]> = {
  CREATING: ['ACTIVE', 'FAILED'],
  ACTIVE: [],
  FAILED: [],
};

export interface CreateWalletRecordInput {
  ownerType: 'PLATFORM' | 'CUSTOMER';
  ownerId?: string | null;
  ownerNo: string;
  vaultCode: string;
  walletRole: string;
  network: string;
  status: 'CREATING' | 'ACTIVE';
  address?: string | null;
  iban?: string | null;
  custodianRef?: string | null;
}

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── L1 Pure Domain Methods ────────────────────────────────────────────

  async createWalletRecord(dto: CreateWalletRecordInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const network = assertNetwork(dto.network);
    if (!isVaultCode(dto.vaultCode)) {
      throw new BadRequestException(`Unknown vault: ${dto.vaultCode}`);
    }
    const vault = VAULTS[dto.vaultCode];
    if (!vault.networks.includes(network.code)) {
      throw new BadRequestException(`Vault ${vault.code} has no address slot on network ${network.code}`);
    }
    if (vault.ownerType !== dto.ownerType) {
      throw new BadRequestException(`Vault ${vault.code} is ${vault.ownerType}-owned, got ownerType ${dto.ownerType}`);
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const walletNo = generateReferenceNo('WA');
      try {
        return await db.wallet.create({
          data: {
            walletNo,
            ownerType: dto.ownerType,
            ownerId: dto.ownerType === 'PLATFORM' ? null : (dto.ownerId ?? null),
            ownerNo: dto.ownerNo,
            vaultCode: dto.vaultCode,
            walletRole: dto.walletRole,
            network: network.code,
            status: dto.status,
            address: dto.address ?? null,
            iban: dto.iban ?? null,
            custodianRef: dto.custodianRef ?? null,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          if (attempt === 2) throw new ConflictException('Failed to generate unique walletNo after 3 attempts');
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException('Failed to generate unique walletNo after 3 attempts');
  }

  async transitionStatus(walletNo: string, from: string, to: string, extra?: Record<string, any>, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const allowed = WALLET_STATUS_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new ConflictException(`Invalid transition: wallet in ${from} cannot go to ${to}`);
    }
    const wallet = await db.wallet.findFirst({ where: { walletNo } });
    if (!wallet) throw new NotFoundException(`Wallet ${walletNo} not found`);
    if (wallet.status !== from) {
      throw new ConflictException(`Wallet ${walletNo} is ${wallet.status}, expected ${from}`);
    }
    return db.wallet.update({ where: { id: wallet.id }, data: { status: to, ...(extra ?? {}) } });
  }

  async findByWalletNo(walletNo: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.wallet.findFirst({ where: { walletNo } });
  }

  /** 入金信号按（网络, 地址 | IBAN）找客户的收款行（Task 5 消费方） */
  async findCustomerWalletByDestination(
    network: string,
    destination: { address?: string | null; iban?: string | null },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const key = destination.address ? { address: destination.address } : { iban: destination.iban ?? '' };
    return db.wallet.findFirst({ where: { network, ownerType: 'CUSTOMER', vaultCode: 'CLIENT_DEPOSIT', ...key } });
  }
}
```

- [ ] **Step 5: 查询服务与控制器**

`wallet-query.service.ts` 整文件：

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { NETWORKS, isNetworkCode } from '../../../config/manifests/networks.manifest';

@Injectable()
export class WalletQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll({ skip, take, where, orderBy }: any) {
    const [items, total] = await Promise.all([
      this.prisma.wallet.findMany({ skip, take, where, orderBy }),
      this.prisma.wallet.count({ where }),
    ]);
    const enriched = await this.attachOwnerInfo(items);
    return { items: enriched.map((w) => this.attachNetworkInfo(w)), total };
  }

  async findOne(id: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id } });
    if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: `Wallet ${id} not found` });
    const [enriched] = await this.attachOwnerInfo([wallet]);
    return this.attachNetworkInfo(enriched);
  }

  /** R4：客户在该网络上有没有 ACTIVE 的收款行（CLIENT_DEPOSIT vault） */
  async hasReceivingAccount(customerId: string, network: string): Promise<boolean> {
    const n = await this.prisma.wallet.count({
      where: { ownerType: 'CUSTOMER', ownerId: customerId, vaultCode: 'CLIENT_DEPOSIT', network, status: 'ACTIVE' },
    });
    return n > 0;
  }

  /** 余额不在钱包表上（唯一真相在账本）；这里只挂网络注册表里的展示信息 */
  private attachNetworkInfo(w: any) {
    const net = isNetworkCode(w.network) ? NETWORKS[w.network] : null;
    return {
      ...w,
      networkInfo: net
        ? { kind: net.kind, custodian: net.custodian, bankName: net.bankName, accountName: net.accountName, explorerUrl: net.explorerUrl }
        : null,
    };
  }

  // attachOwnerInfo：原样保留（第 75–114 行）
}
```
（`attachOwnerInfo` 方法体从现文件第 75–114 行原样搬过来。）

`hasReceivingAccount` 的调用方：

```bash
git grep -n "hasReceivingAccount" -- src
```
每处把传 `assetId` 改为先取资产再传 `asset.network`（例如 `const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { network: true } }); … hasReceivingAccount(customerId, asset.network)`）。

`wallets.controller.ts`：删 `Patch` / `Body` / `UpdateWalletStatusDto` / `WalletType` import 与 `ensureAdmin`、`changeStatus`、`findBalance` 三个成员；`findAll` 的查询参数与 where 改为：

```ts
  @Get()
  @ApiOperation({ summary: 'List wallet address rows (vault × network × owner)' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'ownerType', required: false, enum: OwnerType })
  @ApiQuery({ name: 'ownerNo', required: false, type: String })
  @ApiQuery({ name: 'vaultCode', required: false, type: String })
  @ApiQuery({ name: 'walletRole', required: false, enum: WalletRole })
  @ApiQuery({ name: 'network', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: WalletStatus })
  @ApiQuery({ name: 'walletNo', required: false, type: String })
  findAll(
    @Request() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('ownerType') ownerType?: string,
    @Query('ownerNo') ownerNo?: string,
    @Query('vaultCode') vaultCode?: string,
    @Query('walletRole') walletRole?: string,
    @Query('network') network?: string,
    @Query('status') status?: string,
    @Query('walletNo') walletNo?: string,
    @Query('q') q?: string,
  ) {
    this.ensureSupportedToken(req);
    const where: Prisma.WalletWhereInput = {};
    if (req.user.type === 'CUSTOMER') {
      if (ownerType && ownerType !== OwnerType.CUSTOMER) throw new ForbiddenException('Customer can only query CUSTOMER wallets');
      where.ownerType = OwnerType.CUSTOMER;
      where.ownerId = req.user.userId;
    } else {
      if (ownerType) where.ownerType = ownerType;
      if (ownerNo?.trim()) where.ownerNo = { contains: ownerNo.trim() };
    }
    if (vaultCode) where.vaultCode = vaultCode;
    if (walletRole) where.walletRole = walletRole;
    if (network) where.network = network;
    if (status) where.status = status;
    if (walletNo?.trim()) where.walletNo = { contains: walletNo.trim() };
    const qt = q?.trim();
    if (qt) where.OR = [{ walletNo: { contains: qt } }, { iban: { contains: qt } }, { address: { contains: qt } }];
    return this.queryService.findAll({ skip: skip ? Number(skip) : 0, take: take ? Number(take) : 20, where, orderBy: [{ vaultCode: 'asc' }, { network: 'asc' }, { createdAt: 'desc' }] });
  }
```
`findOne(':walletNo')` 原样保留（客户只能看自己）。

- [ ] **Step 6: 托管方适配器与客户充值地址路径**

`custodian-adapter.interface.ts`：

```ts
export const CUSTODIAN_ADAPTER = Symbol('CUSTODIAN_ADAPTER');

/** 一个 vault 在一条网络上开一个地址（HexTrust 语义）；银行通道给虚拟账号 */
export interface CreateAddressParams {
  vaultCode: string;
  network: string;
  ownerNo: string;
}

export interface CreateAddressResult {
  custodianRef: string;
  address?: string;
  iban?: string;
}

export interface CustodianAdapter {
  createAddress(params: CreateAddressParams): Promise<CreateAddressResult>;
}
```

`mock-custodian.adapter.ts`：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { CustodianAdapter, CreateAddressParams, CreateAddressResult } from './custodian-adapter.interface';
import { assertNetwork } from '../../../config/manifests/networks.manifest';
import { fakeTronAddress } from '../../../common/utils/tron-address.util';

@Injectable()
export class MockCustodianAdapter implements CustodianAdapter {
  private readonly logger = new Logger(MockCustodianAdapter.name);

  async createAddress(params: CreateAddressParams): Promise<CreateAddressResult> {
    const network = assertNetwork(params.network);
    const custodianRef = `mock-${network.custodian.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const seed = `${params.vaultCode}|${params.network}|${params.ownerNo}|${custodianRef}`;
    if (network.kind === 'CHAIN') {
      const address = fakeTronAddress(seed);
      this.logger.log(`[MOCK] ${network.custodian} address on ${network.code}: ${address}`);
      return { custodianRef, address };
    }
    const digits = createHash('sha256').update(seed).digest('hex').replace(/\D/g, '').padEnd(16, '0').slice(0, 16);
    const iban = `AE07086${digits}`;
    this.logger.log(`[MOCK] ${network.custodian} virtual IBAN on ${network.code}: ${iban}`);
    return { custodianRef, iban };
  }
}
```

`customer-deposit-wallet.service.ts` 整文件：

```ts
import { Injectable, Inject, Logger, BadGatewayException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { CUSTODIAN_ADAPTER, CustodianAdapter } from './custodian-adapter.interface';
import { WalletStatus } from './dto/wallet.dto';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import { customerRoleForNetworkKind } from './system-wallet.util';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import { assertNetwork } from '../../../config/manifests/networks.manifest';

/** 钱包表唯一保留的写路径（spec §4）：客户在某条网络上要一个收款地址。
 *  同网络第二次直接复用——一个客户在一条网络上只有一个地址（HexTrust：一 vault 一链一地址）。 */
@Injectable()
export class CustomerDepositWalletService {
  private readonly logger = new Logger(CustomerDepositWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly walletsService: WalletsService,
    private readonly queryService: WalletQueryService,
    @Inject(CUSTODIAN_ADAPTER) private readonly custodianAdapter: CustodianAdapter,
    private readonly customerAccess: CustomerAccessService,
  ) {}

  async createOrReturn(customerId: string, networkCode: string) {
    const network = assertNetwork(networkCode);

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { id: true, customerNo: true, lifecycle: true },
    });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    if (customer.lifecycle !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'CUSTOMER_NOT_ACTIVE', message: 'Customer is not active' });
    }

    const walletRole = customerRoleForNetworkKind(network.kind);
    const whereExisting = {
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      vaultCode: 'CLIENT_DEPOSIT',
      network: network.code,
      status: WalletStatus.ACTIVE,
    };

    // 只在"要开新地址"时过交易就绪门；已有地址的取回路径不过门（否则停用提现地址会把客户锁在自己的地址外）
    const existingActive = await this.prisma.wallet.findFirst({ where: whereExisting });
    if (!existingActive) {
      await this.customerAccess.assertTradingReady(customerId);
    }

    const txResult = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.wallet.findFirst({ where: whereExisting });
      if (existing) return { kind: 'existing' as const, wallet: existing };
      const wallet = await this.walletsService.createWalletRecord(
        {
          ownerType: 'CUSTOMER',
          ownerId: customerId,
          ownerNo: customer.customerNo,
          vaultCode: 'CLIENT_DEPOSIT',
          walletRole,
          network: network.code,
          status: 'CREATING',
        },
        tx,
      );
      return { kind: 'created' as const, wallet };
    });

    if (txResult.kind === 'existing') return this.queryService.findOne(txResult.wallet.id);

    const wallet = txResult.wallet;
    const traceId = randomUUID();
    const actor = {
      actorType: 'CUSTOMER' as const,
      actorNo: customer.customerNo,
      actorDisplayName: customer.customerNo,
      actorRolesAtTime: ['CUSTOMER'],
    };

    try {
      const result = await this.custodianAdapter.createAddress({
        vaultCode: 'CLIENT_DEPOSIT',
        network: network.code,
        ownerNo: customer.customerNo,
      });
      await this.walletsService.transitionStatus(wallet.walletNo, 'CREATING', 'ACTIVE', {
        custodianRef: result.custodianRef,
        address: result.address ?? null,
        iban: result.iban ?? null,
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_DEPOSIT_ADDRESS_CREATED,
          actionDomain: 'DEPOSIT',
          primarySubjectType: AuditEntityTypes.WALLET,
          primarySubjectNo: wallet.walletNo,
          ownerCustomerNo: customer.customerNo,
          subjects: [
            { subjectType: AuditEntityTypes.WALLET, subjectNo: wallet.walletNo, subjectRole: 'PRIMARY' as any },
            { subjectType: 'CUSTOMER', subjectNo: customer.customerNo, subjectRole: 'OWNER' as any },
          ],
          requestId: `CUSTOMER_DEPOSIT_ADDRESS_CREATED_${wallet.walletNo}`,
          traceId,
          outcome: AuditOutcome.SUCCESS,
          afterData: { walletNo: wallet.walletNo, network: network.code, walletRole, address: result.address ?? null, iban: result.iban ?? null, custodianRef: result.custodianRef },
          sourcePlatform: 'CLIENT_API',
        },
        actor,
      );

      this.logger.log(`Deposit address ${wallet.walletNo} opened for ${customer.customerNo} on ${network.code}`);
      return this.queryService.findOne(wallet.id);
    } catch (err: any) {
      await this.walletsService.transitionStatus(wallet.walletNo, 'CREATING', 'FAILED');
      // 双结局：失败不单独起名——同码 outcome=FAILED + reasonCode
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_DEPOSIT_ADDRESS_CREATED,
          actionDomain: 'DEPOSIT',
          primarySubjectType: AuditEntityTypes.WALLET,
          primarySubjectNo: wallet.walletNo,
          ownerCustomerNo: customer.customerNo,
          subjects: [
            { subjectType: AuditEntityTypes.WALLET, subjectNo: wallet.walletNo, subjectRole: 'PRIMARY' as any },
            { subjectType: 'CUSTOMER', subjectNo: customer.customerNo, subjectRole: 'OWNER' as any },
          ],
          requestId: `CUSTOMER_DEPOSIT_ADDRESS_CREATED_${wallet.walletNo}`,
          traceId,
          outcome: AuditOutcome.FAILED,
          reasonCode: 'PROVISION_ERROR',
          reason: err?.message ?? 'custodian error',
          metadata: { network: network.code, walletRole },
          sourcePlatform: 'CLIENT_API',
        },
        actor,
      );
      this.logger.error(`Deposit address creation failed for ${customer.customerNo} on ${network.code}: ${err?.message}`);
      throw new BadGatewayException({ code: 'CUSTODIAN_CREATE_FAILED', message: 'Failed to create deposit address' });
    }
  }
}
```
（`recordByActor` 的 actor 类型若不接受 `'CUSTOMER'`，查 `AuditActorContext` 定义——`actorType` 是字符串联合的话加上；波二"客户动作 actor 改 CUSTOMER"就是靠这条路，本任务先让这一处成立。）

`customer-deposit-wallet.controller.ts`：`return this.service.createOrReturn(req.user.userId, dto.network);`

`wallets.module.ts`：controllers `[WalletsController, CustomerDepositWalletController]`；providers `[WalletsService, WalletQueryService, CustomerDepositWalletService, { provide: CUSTODIAN_ADAPTER, useClass: MockCustodianAdapter }]`；exports `[WalletsService, WalletQueryService]`；imports 删 `GovernanceModule`（只有审批发射器用它）。

- [ ] **Step 7: 删文件**

```bash
cd src/modules/asset-treasury/wallets && git rm custodian-wallet-create-workflow.service.ts custodian-wallet-create-approval.service.ts custodian-wallet-create.controller.ts dto/create-custodian-wallet.dto.ts wallet-balance.service.ts wallet-balance.service.spec.ts wallet-role-policies.constant.ts wallet-role-policies.constant.spec.ts customer-viban-bank.constant.ts && cd -
```

- [ ] **Step 8: 种子 7 行 + 演示造数换钥匙**

`prisma/seed.business.ts`：
- import 段：删 `CRYPTO_SYSTEM_WALLET_ROLES / FIAT_SYSTEM_WALLET_ROLES`、`WalletRole` 两个 import；加 `import { platformWalletSlots } from '../src/config/manifests/vaults.manifest';`、`import { NETWORKS } from '../src/config/manifests/networks.manifest';`、`import { fakeTronAddress } from '../src/common/utils/tron-address.util';`。
- 删 `buildSystemWalletAddress`（第 75–93 行）；`buildSystemPoolIban` 签名改 `(vaultCode: string, currency: string)`，体内引用同步。
- `seedAssets` 里第 163–235 行系统钱包段整段删掉；`seedBusiness` 在 `await seedAssets(prisma);` 之后加 `await seedPlatformWallets(prisma);`；新函数：

```ts
// ─────────────────────────────────────────────────────────────
// ①b Platform wallet rows — 4 vault × network slots (7 rows), keyed by network not asset
// ─────────────────────────────────────────────────────────────
async function seedPlatformWallets(prisma: PrismaClient): Promise<void> {
  for (const slot of platformWalletSlots()) {
    const net = NETWORKS[slot.network];
    const walletNo = buildDeterministicNo('WA', slot.vaultCode, slot.network);
    const isChain = net.kind === 'CHAIN';
    const data = {
      ownerType: 'PLATFORM',
      ownerId: null,
      ownerNo: 'PLATFORM',
      vaultCode: slot.vaultCode,
      walletRole: slot.vaultCode,
      network: slot.network,
      address: isChain ? fakeTronAddress(`PLATFORM|${slot.vaultCode}|${slot.network}`) : null,
      iban: isChain ? null : buildSystemPoolIban(slot.vaultCode, 'AED'),
      custodianRef: `${net.custodian.toLowerCase()}-vault-${slot.vaultCode.toLowerCase()}`,
      status: 'ACTIVE',
    };
    await prisma.wallet.upsert({ where: { walletNo }, update: data, create: { walletNo, ...data } });
  }
  console.log('Seeded 7 platform wallet address rows (vault × network).');
}
```

`scripts/demo-lib.ts`：
- 第 84–89 行：删 VIBAN 常量 import/re-export，改 `import { NETWORKS } from '../src/config/manifests/networks.manifest';` 与 `import { fakeTronAddress } from '../src/common/utils/tron-address.util';`。
- 第 331–350 行两个 upsert 改为：

```ts
    // C_DEP（TRON 收款地址）
    const depNo = buildDeterministicNo('WA', SIM, 'C_DEP', c.customerNo);
    await ctx.prisma.wallet.upsert({
      where: { walletNo: depNo }, update: {},
      create: {
        walletNo: depNo, ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_DEP', network: 'TRON',
        address: fakeTronAddress(depNo), custodianRef: `hextrust-demo-${c.customerNo}`, status: 'ACTIVE',
      },
    });

    // C_VIBAN（AED_ZAND 虚拟账号）
    const vibanNo = buildDeterministicNo('WA', SIM, 'C_VIBAN', c.customerNo);
    const vibanIban = `AE07086${createHash('sha256').update(vibanNo).digest('hex').replace(/\D/g, '').padEnd(16, '0').slice(0, 16)}`;
    await ctx.prisma.wallet.upsert({
      where: { walletNo: vibanNo }, update: {},
      create: {
        walletNo: vibanNo, ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND',
        iban: vibanIban, custodianRef: `zand-demo-${c.customerNo}`, status: 'ACTIVE',
      },
    });
```
- 第 441–443、641–643、1108 行的 `findFirst` 把 `assetId: ctx.aed.id` 改 `network: 'AED_ZAND'`，`assetId: ctx.usdt.id` 改 `network: 'TRON'`。
- `scripts/demo-fixtures.ts` 第 163 行同法（`assetId: asset.id` → `network: asset.network`）。
- `git grep -n "CUSTOMER_VIBAN_" -- scripts src` 剩余引用改读 `NETWORKS.AED_ZAND.bankName / .accountName`。

- [ ] **Step 9: 19 处 e2e 建钱包夹具 + verify-act1 B6 换钥匙**

统一形状——客户行：

```ts
    const fiatWallet = await prisma.wallet.create({
      data: {
        walletNo: `WA-E2E-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customer.customerNo,
        vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND',
        iban: `AE07086${Date.now().toString().padStart(16, '0').slice(-16)}`, status: 'ACTIVE',
      },
    });
```
（链上行：`walletRole: 'C_DEP', network: 'TRON', address: fakeTronAddress(\`e2e|${customerId}|${Date.now()}\`)`，`import { fakeTronAddress } from '../src/common/utils/tron-address.util'`。）

公司行（recon 三份夹具的 `createFirmWallet`）：唯一键 `(vaultCode, network, ownerNo)` 不允许第二条 `PLATFORM` 行，改用独立归属号并保留 `ownerType: 'PLATFORM'`（对账引擎 R2 只看 ownerType）：

```ts
  async function createFirmWallet(opts: { vaultCode: string; network: string }): Promise<{ id: string }> {
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return (prisma as any).wallet.create({
      data: {
        walletNo: `WA-E2E-ADJ-FIRM-${tag}`,
        ownerType: 'PLATFORM', ownerId: null, ownerNo: `PLATFORM-E2E-${tag}`,
        vaultCode: opts.vaultCode, walletRole: opts.vaultCode, network: opts.network,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
  }
```
逐文件改（行号为改前）：`test/deposit-money-arcs.e2e-spec.ts:128`、`deposit-sumsub-verdicts.e2e-spec.ts:222,230`、`kyt-verdict-landing.e2e-spec.ts:64`、`audit-discipline.e2e-spec.ts:253`、`sanction-subject-split.e2e-spec.ts:156`、`sla.e2e-spec.ts:165`、`material-requests.e2e-spec.ts:125`、`customer-restrictions.e2e-spec.ts:139`、`withdraw-money-arcs.e2e-spec.ts:204-215（ensureCustomerWallet：参数 `{ walletRole; network; iban?; address? }`，findFirst 按 `network` 找）`、`swap-money-arc.e2e-spec.ts:192-200`、`withdraw-sumsub-scenarios.e2e-spec.ts:244-252`、`swap-sumsub-scenarios.e2e-spec.ts:244-252`、`recon-aging-write-off.e2e-spec.ts:153,170`、`recon-reattribution.e2e-spec.ts:179,194`、`recon-adjustment-money-arcs.e2e-spec.ts:198,215`。调用方把 `assetId: usdt.id, type: 'CRYPTO_ADDRESS'` 一类实参改成 `network: 'TRON'`；`assetId: aedAssetId, type: 'FIAT_BANK'` 改成 `network: 'AED_ZAND'`。

`scripts/verify-act1.ts` 第 239–241 行：

```ts
  const walletFxB6 = await prisma.wallet.create({
    data: {
      walletNo: `WA-ACT1-B6-${su4}`, ownerType: 'PLATFORM', ownerId: null, ownerNo: `PLATFORM-ACT1-B6-${su4}`,
      vaultCode: 'F_OPS', walletRole: 'F_OPS', network: 'AED_ZAND', status: 'ACTIVE',
    },
  });
```
（`asset0` 若再无引用一并删。）

- [ ] **Step 10: 策略、审计码、RBAC**

`approval.constants.ts`：删 `ApprovalActionTypes.CUSTODIAN_WALLET_CREATE`、其策略段（第 228–233 行）、白名单项。`AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE` 与 `AuditActions.CUSTODIAN_WALLET_CREATE` 按 grep 结果处理（零引用即删；平面键删不掉就留在退役闸）。

`audit-actions.constant.ts`：
- `AuditActions` 平面表：`DEPOSIT_WALLET_CREATED` 行改为 `CUSTOMER_DEPOSIT_ADDRESS_CREATED: 'CUSTOMER_DEPOSIT_ADDRESS_CREATED',`（`DEPOSIT_WALLET_CREATE_FAILED` 行删）。
- `V4_DEPOSIT_AUDIT_ACTIONS`：`DEPOSIT_WALLET_CREATED` 行替换为

```ts
  // 客户在某网络上开收款地址（波一：钱包表唯一写路径；actor=客户）。单步动作、无旅程可继承 → NONE；
  // 失败并入双结局（outcome=FAILED + reasonCode=PROVISION_ERROR）。
  CUSTOMER_DEPOSIT_ADDRESS_CREATED: { domain: 'DEPOSIT', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
```
- `V1_AUDIT_ACTIONS`：删 `WALLET_STATUS_UPDATED` 与 `CUSTODIAN_WALLET_CREATE_REQUESTED / CUSTODIAN_WALLET_CREATED / CUSTODIAN_WALLET_CREATE_FAILED / CUSTODIAN_WALLET_CREATE_CANCELLED` 五行（连同上方大段注释）。
- `DEPRECATED_AUDIT_ACTIONS` 末尾追加：

```ts
  // 2026-09-04 波一（V3 治愈）：托管钱包创建整条路 + 钱包状态开关退役（平台钱包只从种子来、管理台只读）；
  // 客户充值地址供给改名 CUSTOMER_DEPOSIT_ADDRESS_CREATED（actor=客户），旧名登退役闸
  'CUSTODIAN_WALLET_CREATE_REQUESTED', 'CUSTODIAN_WALLET_CREATED', 'CUSTODIAN_WALLET_CREATE_FAILED', 'CUSTODIAN_WALLET_CREATE_CANCELLED',
  'WALLET_STATUS_UPDATED', 'DEPOSIT_WALLET_CREATED',
```

`scripts/verify-audit.ts` 不变量③名单追加 Task 2 与本任务退役的码：`'ASSET_CREATED_AND_PROVISIONED', 'ASSET_CREATION_FAILED', 'ASSET_PROVISIONING_UPDATED', 'ASSET_ACTIVATION_REQUESTED', 'ASSET_ACTIVATED', 'ASSET_ACTIVATION_FAILED', 'CUSTODIAN_WALLET_CREATE_REQUESTED', 'CUSTODIAN_WALLET_CREATED', 'CUSTODIAN_WALLET_CREATE_FAILED', 'CUSTODIAN_WALLET_CREATE_CANCELLED', 'WALLET_STATUS_UPDATED', 'DEPOSIT_WALLET_CREATED'`。

`rbac.catalog.ts`：
- 第 42 行 `| 'WALLET_WRITE'` 删。
- 第 371–376 行：删 `GET /wallets/:walletNo/balance`、`PATCH /wallets/:walletNo/status`、两条 `/admin/custodian-wallets*`；`GET /wallets` 描述改 `'List wallet address rows (vault × network)'`。
- 桶：`treasury.view_wallets` 描述改 `'Browse wallet address rows (vault × network) and detail; balances live in the ledger'`；删 `treasury.manage_wallets` 整个对象。
- `TREASURY_OFFICER` 绑定：`'WALLET_READ', 'WALLET_WRITE',` → `'WALLET_READ',`；其注释首句改为"提现地址的写权限全仓仅此一处；钱包地址行只从种子来，管理台只读"。

- [ ] **Step 11: 闸门**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/asset-treasury/wallets src/modules/audit-logging/constants --no-coverage
bash scripts/stack.sh down self && bash scripts/stack.sh reset self && bash scripts/stack.sh up self
sqlite3 "$(source scripts/db-env.sh && read_database_url "$PWD" self | sed 's#^file:##')" "select vaultCode, network, ownerNo, substr(coalesce(address, iban),1,12) from wallets order by vaultCode, network;"
```
Expected: tsc ① 零错误；jest 全绿；sqlite 恰 7 行：`F_FEE/AED_ZAND`、`F_FEE/TRON`、`F_LIQ/AED_ZAND`、`F_LIQ/TRON`、`F_OPS/AED_ZAND`、`F_OPS/TRON`、`F_SET/AED_ZAND`，TRON 行地址以 `T` 开头。**不要**在这里跑 `demo:all`（Task 6 才绿）。

- [ ] **Step 12: Commit**

```bash
git add prisma src/modules/asset-treasury/wallets src/modules/identity/access-control/rbac.catalog.ts src/modules/governance/approvals/constants/approval.constants.ts src/modules/audit-logging/constants/audit-actions.constant.ts scripts test
git commit -m "feat(v3): 钱包表改地址行（vault×网络×归属人）+ 客户充值地址按网络开 + 退役托管钱包创建/状态开关/余额（波一 T4）"
```

**本任务过哪几条**：改 schema / seed → 重铺闸；改 RBAC / 策略 → sync + 重启（reset 已含）；改审计码 → 四属性 + 封册 + 退役闸 + `verify:audit` 名单；新端点无（DTO 改形）；**动钱路径本任务刻意未收口**——阶段闸在 Task 6（`verify:coa`）；无前端。

---

### Task 5: 入金信号改钥匙——按（网络, 地址 | IBAN）找钱包、按（网络, 合约）找资产，合约对不上拒收留痕

**本任务做**：`POST /deposit-transactions/my/inbound-signals` 与 `/scan` 的 DTO 去 `walletId`，改 `network + toAddress | iban + contractAddress + …`；服务端解析出钱包行与资产再走今天的 `detected()`；合约对不上任何资产 → `DEPOSIT_SIGNAL_REJECTED`（DENIED + `UNKNOWN_ASSET`）并 400；`detected()` 不再读 `wallet.asset`；客户端 ⚡ 面板改传参；新单测。**不做**：提现 / 兑换（Task 6）；`demo-lib` 的 `createRosterDeposit`（它直接调 `detected({ assetId, toWalletId })`，钥匙没变）。

**Files:**
- Modify: `src/modules/trading/deposit-transactions/dto/inbound-transfer-signal.dto.ts`
- Modify: `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts`（`findAllForCustomer` 第 69–112 行、`createForCustomer` 第 114–247 行、`scanForCustomer` 第 249–256 行、`getCustomerDepositWalletOrThrow` / `getChannelTypeFromWallet` 第 550–576 行、`include` 里的 `wallet.type`）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（`detected()` 第 1101–1113 行）
- Create: `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（新码）
- Modify: `client-web/src/pages/Deposit.tsx`（第 24–36 行 `WalletItem`、第 107 行 payload 类型、第 370–412 行 payload 构造与 scan、第 449 行调用处）

**Interfaces:**
- Consumes: Task 4 的 `WalletsService.findCustomerWalletByDestination`（本服务经 `prisma` 直查同样条件亦可——为不引入模块依赖，本任务直查 `prisma.wallet`）、`assertNetwork`。
- Produces: `CreateInboundTransferSignalDto { network; toAddress?; iban?; contractAddress?; amount; txHash?; fromAddress?; referenceNo?; fromIban?; simulationRiskLevel?; simulationRiskReason?; counterpartyIsVasp? }`；`ScanInboundTransferSignalsDto { network; toAddress?; iban?; mode? }`；`InboundTransferSignalQueryDto { network?; status?; skip?; take? }`；审计码 `DEPOSIT_SIGNAL_REJECTED`。

- [ ] **Step 1: 写失败的单测**

`inbound-transfer-signals.service.spec.ts`：

```ts
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

describe('InboundTransferSignalsService · 按网络与合约找钥匙（波一）', () => {
  const prisma: any = {
    customerMain: { findUnique: jest.fn() },
    wallet: { findFirst: jest.fn() },
    asset: { findFirst: jest.fn() },
    inboundTransferSignal: { findUnique: jest.fn(), create: jest.fn() },
  };
  const audit = { recordSystem: jest.fn(), recordByActor: jest.fn() };
  const access = { assertTradingEligibility: jest.fn() };
  let service: InboundTransferSignalsService;

  const wallet = { id: 'w1', walletNo: 'WA1', ownerType: 'CUSTOMER', ownerId: 'c1', vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_DEP', network: 'TRON', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', status: 'ACTIVE' };
  const usdt = { id: 'a-usdt', code: 'USDT-TRON', type: 'CRYPTO', network: 'TRON', contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        InboundTransferSignalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: DepositTransactionsService, useValue: {} },
        { provide: FundsOrderService, useValue: {} },
        { provide: CustomerAccessService, useValue: access },
        { provide: AuditLogsService, useValue: audit },
      ],
    }).compile();
    service = mod.get(InboundTransferSignalsService);
    prisma.customerMain.findUnique.mockResolvedValue({ id: 'c1', customerNo: 'CU001' });
  });

  it('合约对不上任何资产：拒收 400 + DEPOSIT_SIGNAL_REJECTED（DENIED / UNKNOWN_ASSET），不落信号行', async () => {
    prisma.wallet.findFirst.mockResolvedValue(wallet);
    prisma.asset.findFirst.mockResolvedValue(null);
    await expect(service.createForCustomer('c1', {
      network: 'TRON', toAddress: wallet.address, contractAddress: 'TScamScamScamScamScamScamScamScamXX',
      amount: '100', txHash: 'ab'.repeat(32), fromAddress: 'TSender', counterpartyIsVasp: false,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.recordSystem).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DEPOSIT_SIGNAL_REJECTED', actionDomain: 'DEPOSIT', outcome: 'DENIED', reasonCode: 'UNKNOWN_ASSET', ownerCustomerNo: 'CU001',
    }));
    expect(prisma.inboundTransferSignal.create).not.toHaveBeenCalled();
  });

  it('地址不是本客户在该网络上的收款行：404', async () => {
    prisma.wallet.findFirst.mockResolvedValue(null);
    await expect(service.createForCustomer('c1', { network: 'TRON', toAddress: 'Tnobody', amount: '1', txHash: 'x', fromAddress: 'y', counterpartyIsVasp: false } as any))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('钥匙对上：信号行落 walletId / assetId（服务端解析，DTO 不再携带）', async () => {
    prisma.wallet.findFirst.mockResolvedValue(wallet);
    prisma.asset.findFirst.mockResolvedValue(usdt);
    prisma.inboundTransferSignal.findUnique.mockResolvedValue(null);
    prisma.inboundTransferSignal.create.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 's1' });
    await service.createForCustomer('c1', {
      network: 'TRON', toAddress: wallet.address, contractAddress: usdt.contractAddress,
      amount: '100', txHash: 'ab'.repeat(32), fromAddress: 'TSender', counterpartyIsVasp: false,
    } as any);
    expect(prisma.inboundTransferSignal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ walletId: 'w1', assetId: 'a-usdt', channelType: 'CRYPTO' }),
    }));
  });

  it('未注册网络：400', async () => {
    await expect(service.createForCustomer('c1', { network: 'FIAT', iban: 'AE1', amount: '1' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
```
（`createForCustomer` 里 `assertTradingEligibility` 与 `recordSignalAudit` 的依赖已 mock；若 `recordSignalAudit` 走 `recordSystem`，第三条用例的 `audit.recordSystem` 会被调用两次——不影响断言。）

Run: `npx jest src/modules/trading/deposit-transactions/inbound-transfer-signals --no-coverage`
Expected: FAIL。

- [ ] **Step 2: DTO**

`dto/inbound-transfer-signal.dto.ts`：`InboundTransferSignalQueryDto.walletId` 改为

```ts
  @IsOptional()
  @IsString()
  network?: string;
```
`CreateInboundTransferSignalDto` 的 `walletId` 字段换成：

```ts
  /** 入金落在哪条网络的哪个地址——钥匙是（网络, 地址 | IBAN），不再是内部 walletId */
  @IsString()
  network!: string;

  @IsOptional()
  @IsString()
  toAddress?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  /** 代币合约地址；原生币 / 法币留空。对不上任何资产的信号拒收留痕——合约地址防诈骗落在这里 */
  @IsOptional()
  @IsString()
  contractAddress?: string;
```
`ScanInboundTransferSignalsDto`：

```ts
export class ScanInboundTransferSignalsDto {
  @IsString()
  network!: string;

  @IsOptional()
  @IsString()
  toAddress?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsEnum(InboundTransferScanMode)
  mode?: InboundTransferScanMode;
}
```
删 `IsUUID` import（若无其它用处）。

- [ ] **Step 3: 服务解析层**

`inbound-transfer-signals.service.ts`：
- import 加 `import { assertNetwork } from '../../../config/manifests/networks.manifest';`、`import { randomUUID } from 'node:crypto';`（已有）、`import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';`；删 `WalletRole` import。
- `findAllForCustomer`：`if (query.walletId) where.walletId = query.walletId;` 改 `if (query.network) where.wallet = { network: query.network };`；两处 `include.wallet.select` 里 `type: true` 改 `network: true, vaultCode: true`（共四处 include：第 96–105、166–175、221–230 行，及 `resolveExistingDeposit` 无 include）。
- `createForCustomer` 开头改为：

```ts
    await this.customerAccess.assertTradingEligibility(customerId, 'DEPOSIT');
    const customer = await (this.prisma as any).customerMain.findUnique({ where: { id: customerId } });
    const { wallet, network } = await this.resolveDepositWalletOrThrow(customerId, dto);
    const asset = await this.resolveAssetOrReject(customer, network, dto);
    const channelType = network.kind === 'CHAIN' ? InboundTransferChannelType.CRYPTO : InboundTransferChannelType.FIAT;
```
  下文 `const isCrypto = String(wallet.asset?.type).toUpperCase() === 'CRYPTO';` 改 `const isCrypto = asset.type === 'CRYPTO';`；`buildDedupeKey({ …, walletId: wallet.id, assetId: asset.id, … })`；`create` 的 `data` 里 `assetId: wallet.assetId` 改 `assetId: asset.id`。
- `scanForCustomer`：`const wallet = await this.getCustomerDepositWalletOrThrow(customerId, dto.walletId);` 改 `const { wallet } = await this.resolveDepositWalletOrThrow(customerId, dto);`；`findMany` 的 `walletId: dto.walletId` 改 `walletId: wallet.id`。
- 删 `getCustomerDepositWalletOrThrow` 与 `getChannelTypeFromWallet`，加：

```ts
  /** 钥匙①：（网络, 地址 | IBAN）→ 本客户在该网络上的收款行 */
  private async resolveDepositWalletOrThrow(
    customerId: string,
    dto: { network: string; toAddress?: string; iban?: string },
  ) {
    const network = assertNetwork(dto.network);
    const destination = network.kind === 'CHAIN' ? dto.toAddress : dto.iban;
    if (!destination) {
      throw new BadRequestException(
        network.kind === 'CHAIN' ? 'toAddress is required for chain deposits' : 'iban is required for bank-rail deposits',
      );
    }
    const wallet = await (this.prisma as any).wallet.findFirst({
      where: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        vaultCode: 'CLIENT_DEPOSIT',
        network: network.code,
        ...(network.kind === 'CHAIN' ? { address: destination } : { iban: destination }),
      },
    });
    if (!wallet) {
      throw new NotFoundException({ code: 'DEPOSIT_WALLET_NOT_FOUND', message: `No deposit address on ${network.code} matches ${destination}` });
    }
    if (wallet.status !== 'ACTIVE') throw new BadRequestException('Deposit wallet must be ACTIVE');
    return { wallet, network };
  }

  /** 钥匙②：（网络, 合约地址）→ 资产；对不上就是诈骗币 / 未上架币，拒收并留痕 */
  private async resolveAssetOrReject(
    customer: { customerNo: string } | null,
    network: { code: string },
    dto: { contractAddress?: string; toAddress?: string; iban?: string; txHash?: string; referenceNo?: string; amount: string },
  ) {
    const contractAddress = dto.contractAddress?.trim() || null;
    const asset = await (this.prisma as any).asset.findFirst({ where: { network: network.code, contractAddress } });
    if (asset) return asset;
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_SIGNAL_REJECTED,
      actionDomain: 'DEPOSIT',
      primarySubjectType: AuditEntityTypes.INBOUND_TRANSFER_SIGNAL,
      ownerCustomerNo: customer?.customerNo,
      outcome: AuditOutcome.DENIED,
      reasonCode: 'UNKNOWN_ASSET',
      reason: `No asset on ${network.code} with contract ${contractAddress ?? '(native)'}`,
      metadata: { network: network.code, contractAddress, toAddress: dto.toAddress ?? null, iban: dto.iban ?? null, txHash: dto.txHash ?? null, referenceNo: dto.referenceNo ?? null, amount: dto.amount },
      requestId: `DEPOSIT_SIGNAL_REJECTED_${randomUUID()}`,
      sourcePlatform: 'CUSTOMER_API',
    } as any);
    throw new BadRequestException({ code: 'UNKNOWN_ASSET', message: `No asset on ${network.code} with contract ${contractAddress ?? '(native)'}` });
  }
```

`audit-actions.constant.ts`：`AuditActions` 平面表加 `DEPOSIT_SIGNAL_REJECTED: 'DEPOSIT_SIGNAL_REJECTED',`；`V4_DEPOSIT_AUDIT_ACTIONS` 在 `INBOUND_SIGNAL_FAILED` 后加：

```ts
  // 合约对不上任何资产的入金信号：建单之前被拦、没有旅程 → NONE；outcome=DENIED + reasonCode=UNKNOWN_ASSET
  DEPOSIT_SIGNAL_REJECTED:        { domain: 'DEPOSIT', correlationMode: N, requiredFields: [], requiresCausation: false },
```

- [ ] **Step 4: `detected()` 不再读 `wallet.asset`**

`deposit-transactions.service.ts` 第 1101–1113 行改为：

```ts
    const wallet = await (this.prisma as any).wallet.findUnique({ where: { id: input.toWalletId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    const asset = await (this.prisma as any).asset.findUnique({ where: { id: input.assetId }, select: { id: true, type: true, network: true } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.network !== wallet.network) {
      throw new BadRequestException(`Wallet is on ${wallet.network} but asset is on ${asset.network}`);
    }

    const isCrypto = String(asset.type || '').toUpperCase() === 'CRYPTO';
```

- [ ] **Step 5: 客户端 ⚡ 面板改传参**

`client-web/src/pages/Deposit.tsx`：
- `Asset` 接口加 `contractAddress: string | null; minConfirmations?: number;`；`WalletItem` 接口改为 `{ id; walletNo; walletRole?; network; status; address?; iban?; custodianRef?; networkInfo?: { kind; custodian; bankName: string | null; accountName: string | null; explorerUrl: string | null } }`（`assetId / type / asset / bankName / accountName` 删）。
- `CreateInboundTransferSignalPayload`（第 107 行附近）改为 `{ network: string; toAddress?: string; iban?: string; contractAddress?: string; amount: string; txHash?; fromAddress?; referenceNo?; fromIban?; counterpartyIsVasp? }`。
- `buildMockInboundSignalPayload(wallet, asset, amount, counterpartyIsVasp)`（多传当前选中的 `asset`）：

```ts
    if (wallet.networkInfo?.kind === 'CHAIN') {
      const txSeed = buildHexMockValue(rawSeed, 64);
      return {
        network: wallet.network,
        toAddress: wallet.address,
        contractAddress: asset.contractAddress ?? undefined,
        amount,
        txHash: txSeed,
        fromAddress: `T${compactSeed.padEnd(33, 'x').slice(0, 33)}`,
        counterpartyIsVasp: counterpartyIsVasp ?? undefined,
      };
    }
    return {
      network: wallet.network,
      iban: wallet.iban,
      amount,
      referenceNo: `REF-${asset.code}-${referenceSuffix}`,
      fromIban: `AE07MOCK${ibanSeed}`,
    };
```
- `scanInboundSignals(wallet)`：body `{ network: wallet.network, toAddress: wallet.address ?? undefined, iban: wallet.iban ?? undefined, mode: 'INTERACTIVE' }`；调用处 `scanInboundSignals(depositWallet)`。
- `isCryptoDeposit = depositWallet.networkInfo?.kind === 'CHAIN'`。
- 其余 `wallet.asset.*` 引用改为读当前选中 `asset`（`assets.find(a => a.id === selectedAssetId)`）。取钱包的 fetch（第 217–243 行）在 Task 7 改；本任务只保证 tsc ③ 绿。

- [ ] **Step 6: 闸门**

```bash
npx jest src/modules/trading/deposit-transactions src/modules/audit-logging/constants --no-coverage
npx tsc --noEmit -p tsconfig.json && cd client-web && npx tsc -b --noEmit && cd ..
```
Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add src/modules/trading/deposit-transactions src/modules/audit-logging/constants/audit-actions.constant.ts client-web/src/pages/Deposit.tsx
git commit -m "feat(v4-touch): 入金信号按（网络,地址|IBAN）找钱包、按（网络,合约）找资产；合约对不上拒收留痕 DEPOSIT_SIGNAL_REJECTED（波一 T5）"
```

**本任务过哪几条**：改审计码 → 四属性 + 封册；DTO 改形（无新端点）；改前端（只改 payload，截图归 Task 7 一并）；动钱路径阶段闸在 Task 6。

---

### Task 6: 付款腿 / 兑换腿 / 费腿按（资产的网络, vault）解析 + 对账证据与造数跟改 + 阶段闸

**本任务做**：`SystemWalletResolver` 与 `withdraw-transactions.service.findCustomerWallet` / `withdraw-workflow` 的源钱包查询从"按资产找 F_* / C_*"改为"按资产的 network 找地址行"；`tb-evidence.service` 与 `recon-demo.ts` 不再经 `wallet.asset` 取币种；跑通 `reset self → demo:all → verify:coa → 三域 e2e`。**不做**：对账引擎（不动，它认账本科目与币种）；前端。

**Files:**
- Modify: `src/modules/funds-layer/domain/system-wallet-resolver.service.ts`（+spec）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（第 479–490 行 `findCustomerWallet`）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（第 1430–1445 行源钱包查询）
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`（第 529–532、618、709–712 行）
- Modify: `scripts/recon-demo.ts`（第 411–432 行）
- Modify: `scripts/demo-lib.ts`（第 1106 行链上提现地址派生 → `fakeTronAddress`，与 Task 8 的地址簿种子保持同一派生）

**Interfaces:**
- Produces: `SystemWalletResolver.resolve(assetId, vaultCode)`（按资产网络找 `PLATFORM` 行）、`resolveCustomer(assetId, walletRole, ownerId)`（按资产网络找 `CLIENT_DEPOSIT` 行）——签名不变，调用方（`swap-leg-accounting.ts:142/145`、`deposit-workflow.service.ts:1491`、`withdraw-workflow.service.ts:219/971`）零改动。

- [ ] **Step 1: 写失败的单测**

`system-wallet-resolver.service.spec.ts` 里加两条（既有用例按下面的新 where 断言改）：

```ts
  it('resolve：先取资产的 network，再按 (vaultCode, network, PLATFORM) 找 ACTIVE 行', async () => {
    prisma.asset.findUnique.mockResolvedValue({ network: 'TRON', code: 'USDT-TRON' });
    prisma.wallet.findFirst.mockResolvedValue({ id: 'w-fee' });
    const w = await resolver.resolve('a-usdt', 'F_FEE');
    expect(w.id).toBe('w-fee');
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
      where: { vaultCode: 'F_FEE', network: 'TRON', ownerType: 'PLATFORM', ownerNo: 'PLATFORM', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  });
  it('resolveCustomer：按 (CLIENT_DEPOSIT, role, network, ownerId) 找', async () => {
    prisma.asset.findUnique.mockResolvedValue({ network: 'AED_ZAND', code: 'AED' });
    prisma.wallet.findFirst.mockResolvedValue({ id: 'w-viban' });
    await resolver.resolveCustomer('a-aed', 'C_VIBAN', 'c1');
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
      where: { vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND', ownerType: 'CUSTOMER', ownerId: 'c1', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  });
```
Run: `npx jest src/modules/funds-layer --no-coverage` → FAIL。

- [ ] **Step 2: 解析器**

`system-wallet-resolver.service.ts` 整文件：

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

/** 钱包行按网络而非资产挂——同一条链上的所有币共用一个地址（HexTrust：一 vault 一链一地址）。
 *  调用方仍传 assetId（资金单上记的是资产），这里先取资产的 network 再找行。 */
@Injectable()
export class SystemWalletResolver {
  constructor(private readonly prisma: PrismaService) {}

  private async networkOf(assetId: string): Promise<{ network: string; code: string }> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { network: true, code: true } });
    if (!asset) throw new BadRequestException({ code: 'ASSET_NOT_FOUND', message: `Asset ${assetId} not found` });
    return asset;
  }

  /** ACTIVE platform 地址行（F_OPS / F_SET / F_FEE / F_LIQ）for the asset's network */
  async resolve(assetId: string, vaultCode: string) {
    const asset = await this.networkOf(assetId);
    const wallet = await (this.prisma as any).wallet.findFirst({
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
  async resolveCustomer(assetId: string, walletRole: string, ownerId: string) {
    const asset = await this.networkOf(assetId);
    const wallet = await (this.prisma as any).wallet.findFirst({
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

- [ ] **Step 3: 提现两处源钱包查询**

`withdraw-transactions.service.ts` 第 479–490 行：

```ts
  async findCustomerWallet(
    ownerId: string,
    assetId: string,
    walletRole: 'C_DEP' | 'C_VIBAN',
  ): Promise<{ id: string; address: string | null; iban: string | null } | null> {
    const asset = await (this.prisma as any).asset.findUnique({ where: { id: assetId }, select: { network: true } });
    if (!asset) return null;
    return (this.prisma as any).wallet.findFirst({
      where: { vaultCode: 'CLIENT_DEPOSIT', walletRole, ownerType: 'CUSTOMER', ownerId, network: asset.network, status: 'ACTIVE' },
      select: { id: true, address: true, iban: true },
    });
  }
```

`withdraw-workflow.service.ts` 第 1434–1442 行：`where` 改为 `{ vaultCode: 'CLIENT_DEPOSIT', walletRole, network: w.asset.network, ownerType: 'CUSTOMER', ownerId: w.ownerId, status: 'ACTIVE' }`（`w.asset` 在此函数上方已断言非空）；报错文案里 `for asset ${w.assetId} (${w.asset.currency})` 改 `on network ${w.asset.network} (${w.asset.currency})`。第 101–102 / 1408–1409 行注释同步措辞。

- [ ] **Step 4: 账本证据与对账造数不再经 `wallet.asset`**

`tb-evidence.service.ts`：
- 第 529–532 行 `findUnique` 删 `include: { asset: true }`。
- 第 618 行 `let assetCode: string | null = wallet?.asset?.currency ?? null;` 改 `let assetCode: string | null = flows[0]?.assetCode ?? null;`（`flows` 是同函数第 536 行查出的 AccountFlow 行，它们本就带 `assetCode`；若下方已有从 flows 归并 assetCode 的逻辑，以那份为准、保证初值不再读 `wallet.asset`）。
- 第 709–712 行 `findMany` 删 `include: { asset: true }`（其后只用 `walletById` 取 owner，第 3 步已按 flows 归并币种）。

`scripts/recon-demo.ts` 第 411–432 行：

```ts
  const assetRows = (await (prisma as any).asset.findMany({ select: { code: true, currency: true, network: true } })) as Array<{ code: string; currency: string; network: string }>;
  const assetsByNetwork = new Map<string, Array<{ code: string; currency: string }>>();
  for (const a of assetRows) {
    const list = assetsByNetwork.get(a.network) ?? [];
    list.push({ code: a.code, currency: a.currency });
    assetsByNetwork.set(a.network, list);
  }
  const allActiveWallets = (await (prisma as any).wallet.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, walletRole: true, ownerType: true, ownerNo: true, network: true },
  })) as Array<{ id: string; walletRole: string; ownerType: string; ownerNo: string | null; network: string }>;

  const plans: WalletPlan[] = [];
  for (const w of allActiveWallets) {
    // 一条网络上的每个资产各计划一行（今天每网络恰一个资产，将来上第二个 TRC-20 币这里自动多一行）
    for (const a of assetsByNetwork.get(w.network) ?? []) {
      const currency = a.code;
      const isFirm = w.ownerType !== 'CUSTOMER';
```
（原循环体里用 `currency` / `isFirm` 的部分原样接在里面，末尾多一层 `}` 收内层 for。第 651–658 行只 select `walletNo/ownerNo/walletRole`，不动。）

`scripts/demo-lib.ts` 第 1106 行：`toAddress = fakeTronAddress(\`${SIM}wd${idx}\`);`（第 385 行地址簿种子在 Task 8 用同一表达式）。

- [ ] **Step 5: 阶段闸——重铺、全量造数、对账、三域 e2e**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/funds-layer src/modules/trading/withdraw-transactions src/modules/accounting --no-coverage
bash scripts/stack.sh down self && bash scripts/stack.sh reset self && bash scripts/stack.sh up self
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'deposit-money-arcs|withdraw-money-arcs|swap-money-arc'
```
Expected: `demo:all` 花名册 29/29 ✓ + COA 四恒等式；`verify:coa` `ALL … PASS`；三份 e2e 全绿。任一红 → 先看是不是 Task 4 漏改的 `assetId` 钱包查询（`git grep -n "assetId" -- src/modules/asset-treasury/wallets scripts/demo-lib.ts | grep -i wallet`），不许改脚本迁就。

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer src/modules/trading/withdraw-transactions src/modules/accounting/tigerbeetle/tb-evidence.service.ts scripts/recon-demo.ts scripts/demo-lib.ts
git commit -m "feat(v5/v6-touch): 付款腿/费腿/兑换腿按（资产网络, vault）解析地址行；证据与对账造数不再经 wallet.asset（波一 T6）"
```

**本任务过哪几条**：**动钱 → `verify:coa`**（已跑）；改 seed / schema 连带 → `reset self` + `demo:all`（已跑）；三域 e2e；无前端、无审计码变化。

---

### Task 7: 钱包前端——客户端按网络取地址、管理台托管钱包页只读（按 vault 分组）

**本任务做**：客户端 `Deposit` / `WalletManagement` 按资产的 `network` 取 / 开收款地址，收款行信息从 `networkInfo` 读；管理台钱包列表按 vault 分组、列换成 钱包号 / 网络 / 地址或 IBAN / 归属人 / 状态、去 Create；详情去 mock 余额 / Deposit Collection / Disable / Retry，加网络与托管方引用、余额引导去账本页；删 `CustodianWalletCreateModal`；权限码与审批回链清理；截图。**不做**：后端；提现地址簿页（Task 9）。

**Files:**
- Modify: `client-web/src/pages/Deposit.tsx`（第 208–243 行取钱包、第 296–320 行开地址、展示银行名 / 户名处）
- Modify: `client-web/src/pages/WalletManagement.tsx`（第 12–36 行类型、第 48–110 行）
- Modify: `admin-web/src/pages/CustodianWalletList.tsx`、`CustodianWalletDetail.tsx`、`utils/walletRole.util.tsx`、`rbac/permissions.ts`（第 105–106 行）、`pages/ApprovalDetailPage.tsx`（`CUSTODIAN_WALLET_CREATE` 映射行）
- Delete: `admin-web/src/pages/CustodianWalletCreateModal.tsx`

**Interfaces:**
- Consumes: `GET /wallets?ownerType=CUSTOMER&network=<code>&vaultCode=CLIENT_DEPOSIT&status=ACTIVE`（客户 token 自动限定本人）；`POST /client/deposit-wallets { network }`；`GET /wallets/:walletNo`；行字段 `walletNo / vaultCode / walletRole / network / address / iban / custodianRef / status / ownerNo / ownerName / networkInfo`。

- [ ] **Step 1: 客户端 Deposit 页**

`Deposit.tsx` 第 214–221 行 `params` 改为：

```ts
        const asset = assets.find((a) => a.id === selectedAssetId);
        if (!asset) { setDepositWallet(null); return; }
        const params = new URLSearchParams({
          ownerType: 'CUSTOMER',
          vaultCode: 'CLIENT_DEPOSIT',
          network: asset.network,
          status: 'ACTIVE',
        });
```
第 229–233 行 `items.find(...)` 改为 `items.find((w) => w.network === asset.network) || null`。第 307 行 body 改 `JSON.stringify({ network: assets.find((a) => a.id === selectedAssetId)?.network })`。展示处：`depositWallet.bankName` → `depositWallet.networkInfo?.bankName`，`depositWallet.accountName` → `depositWallet.networkInfo?.accountName`；链上地址卡片下加一行 `Network: {depositWallet.network} · Contract: {asset.contractAddress ?? 'Native'}`；第 650 行文案改 `Requires <strong>{asset.minConfirmations ?? 0} network confirmations</strong>. Automatic processing after confirmation.`。

- [ ] **Step 2: 客户端 WalletManagement 页**

`WalletManagement.tsx`：`DepositWallet` 类型改为 Task 5 的 `WalletItem` 同款（`network / address / iban / networkInfo`，删 `assetId / asset / type / bankName / accountName`）；`fetchWallets` 的 params 加 `vaultCode: 'CLIENT_DEPOSIT'`；`handleCreateWallet(network: string)` body `{ network }`；卡片按 `assets` 渲染，每张卡用 `wallets.find((w) => w.network === asset.network)` 取行，没有则显示 `Open address on {asset.network}` 按钮 → `handleCreateWallet(asset.network)`；`creating` 状态键改为 network。

- [ ] **Step 3: 管理台列表页（按 vault 分组、只读）**

`CustodianWalletList.tsx`：
- 删 `CustodianWalletCreateModal` import、`canCreate` / `showCreateModal` 两处 state、第 163–170 行 Create 按钮、第 402–408 行弹窗渲染；删 `PERMISSIONS.CUSTODIAN_WALLET_CREATE` 引用。
- `WalletItem` 改为 `{ id; walletNo; vaultCode; walletRole; ownerType; ownerNo; ownerName?; network; address: string | null; iban: string | null; custodianRef: string | null; status; updatedAt; networkInfo: { kind; custodian; bankName; accountName; explorerUrl } | null }`。
- 筛选：`walletRole` 下拉换成 `vaultCode` 下拉（选项 `F_OPS / F_SET / F_FEE / F_LIQ / CLIENT_DEPOSIT`）；`type` 下拉换成 `network` 下拉（`TRON / AED_ZAND`）；状态选项 `CREATING / ACTIVE / FAILED`；query 参数名同步（`params.set('vaultCode', …)` / `params.set('network', …)`）。
- 表头改 `['Wallet No', 'Role', 'Network', 'Address / IBAN', 'Owner No', 'Owner Name', 'Custodian', 'Status', 'Updated']`（`colSpan` 改 9）；`Address / IBAN` 列显示 `w.address ?? w.iban ?? '—'`（等宽字体、`title` 全文）；Custodian 列 `w.networkInfo?.custodian`。
- 分组：渲染前 `const groups = Array.from(items.reduce((m, w) => (m.get(w.vaultCode) ?? m.set(w.vaultCode, []).get(w.vaultCode)!).push(w) && m, new Map<string, WalletItem[]>()))`（或等价的 for 循环），按 vault 顺序 `['F_OPS','F_SET','F_FEE','F_LIQ','CLIENT_DEPOSIT']` 输出：每组先一行 `<tr><td colSpan={9} className="bg-adm-panel px-4 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3">{VAULT_LABELS[vault]} · {vault}</td></tr>`，再该组的行。`VAULT_LABELS` 定义在 `walletRole.util.tsx`（见 Step 5）。

- [ ] **Step 4: 管理台详情页（只读容器）**

`CustodianWalletDetail.tsx`：
- 类型改同上；删 `handleStatusChange` / `handleRetryCreation` / `canRetry` / `canToggleStatus` / `isFailed` / `showActions` 与右栏 Actions 整块；删「③ Balance (mock)」与「⑤ Deposit Collection」两段；删 `regulatoryGateSummary`、`assetId`、`balance`、`vaultId`、`bankName` / `accountName` 字段引用。
- 「② Identity」段字段：Owner No / Owner Name / `Vault`（`wallet.vaultCode`）/ `Network`（`wallet.network`）/ `Custodian`（`wallet.networkInfo?.custodian`）/ `Custodian Ref`（`wallet.custodianRef`, mono）。
- 「④ Address / Bank」段：CHAIN → Address（copyable）+（有 explorerUrl 时）`Explorer` 链接 `${explorerUrl}`；BANK_RAIL → Bank Name（`networkInfo.bankName`）/ Account Holder（`networkInfo.accountName`）/ IBAN。
- 新增「③ Balance」段只放一句与一个链接：`Balances are not kept on wallet rows — the ledger is the single source of truth.` + 按钮 `Open ledger accounts` → 导航到账本科目页路由（`grep -n "tb/accounts\|ledger" admin-web/src/App.tsx` 取真实路径）并带 `?ownerNo=${wallet.ownerNo}`（该页若不读参数就只跳转）。
- 右栏 Quick Reference：Wallet No / Status / Vault / Role / Network / Owner No / Owner Name。

- [ ] **Step 5: 角色工具、权限码、审批回链、删弹窗**

`walletRole.util.tsx`：`WALLET_ROLE_LABEL` 只留 `C_DEP: 'Client Deposit', C_VIBAN: 'Client vIBAN', F_LIQ: 'Company Liquidity', F_OPS: 'Company Operations', F_SET: 'Company Settlement', F_FEE: 'Company Fees'`，`ROLE_CLS` 同步（F_SET / F_FEE 用绿色系）；新增导出 `export const VAULT_LABELS: Record<string, string> = { F_OPS: 'Company Operations', F_SET: 'Company Settlement', F_FEE: 'Company Fees', F_LIQ: 'Company Liquidity', CLIENT_DEPOSIT: 'Client Deposit Pool' };`。
`permissions.ts`：删 `CUSTODIAN_WALLET_CREATE` / `CUSTODIAN_WALLET_RETRY` 两行。
`ApprovalDetailPage.tsx`：删 `// 托管钱包（entityRef = walletNo）` 注释与 `CUSTODIAN_WALLET_CREATE` 映射行。
```bash
git rm admin-web/src/pages/CustodianWalletCreateModal.tsx
git grep -n "CustodianWalletCreateModal\|CUSTODIAN_WALLET_CREATE\|CUSTODIAN_WALLET_RETRY\|mockBalance\|Balance (mock)\|Deposit Collection\|C_CMA\|C_MAIN\|C_OUT" -- admin-web/src client-web/src
```
Expected: 零命中。

- [ ] **Step 6: tsc ②③ + 截图**

```bash
cd admin-web && npx tsc -b --noEmit && cd .. && cd client-web && npx tsc -b --noEmit && cd ..
```
截图（栈已起）：
1. 客户端 `demo_alice@example.com` / `123456` → Deposit → 选 USDT-TRON：地址以 `T` 开头、Network TRON、Contract `TR7N…`、确认数 19 → 截图 ①；切 AED：显示 IBAN + Zand Bank PJSC / FiatX Ltd → 截图 ②。
2. 客户端 Wallet 页（`/wallet` 或侧栏对应入口）：两张卡各显示网络与地址 → 截图 ③。
3. 管理台 `treasury@` → Custody → Custodian Wallets：分组表头 `Company Operations · F_OPS` 等五组、无 Create 按钮、有 CLIENT_DEPOSIT 组 → 截图 ④；打开一条 `F_FEE / TRON` 详情：无余额数字、有 Custodian Ref 与 Explorer 链接、右栏无 Disable → 截图 ⑤。
4. ⚡ 走查：客户端 Deposit 选 USDT → 模拟一笔入金（面板走 Task 5 的新 payload）→ 充值列表出现单据 → 截图 ⑥（证明信号钥匙改完后端到端仍通）。

- [ ] **Step 7: Commit**

```bash
git add admin-web/src client-web/src
git commit -m "feat(ui): 客户端按网络取/开收款地址；管理台托管钱包页只读按 vault 分组，去余额/停用/创建（波一 T7）"
```

**本任务过哪几条**：改前端 → 截图 6 张；tsc ②③；S6 前端权限码差集（删了两码）；页面改了 → `demo/data.md`「资产与钱包」段与 `script.md` 站 5 ③ 在 Task 15 改。

---

### Task 8: 提现地址簿后端——按网络归属、五条边迁移表、改标签 / 恢复两个新动作

**本任务做**：`WithdrawalAddress` 删 `assetId`、唯一键改 `(customerId, network, address)` + 迁移；新建迁移表常量，服务里五处直写全经它（非法跃迁 409）；登记选网络（只认 CHAIN）、银行账户固定挂 `AED_ZAND`；新增 `PATCH /client/withdrawal-addresses/:addressNo`（只收 `label` / `beneficiaryName`）与 `POST /admin/withdrawal-addresses/:addressNo/unsuspend`；两枚新审计码入合同；`address-validator.util` 退役（校验走注册表）；提现建单的地址校验改按网络；`demo-lib` 与 4 处 e2e 地址夹具换钥匙；单测。**不做**：页面（Task 9）；被守卫拦下留痕 / 客户动作 actor=CUSTOMER（波二）。

**Files:**
- Modify: `prisma/schema.prisma`（`model WithdrawalAddress` 第 736–781 行；`model Asset` 删 `withdrawalAddresses`）
- Create: `prisma/migrations/<ts>_v3w1_withdrawal_address_by_network/migration.sql`
- Create: `src/modules/asset-treasury/withdrawal-addresses/constants/withdrawal-address-transitions.constant.ts`（+spec）
- Create: `dto/update-withdrawal-address.dto.ts`、`dto/unsuspend-withdrawal-address.dto.ts`
- Modify: `dto/create-withdrawal-address.dto.ts`、`dto/create-bank-account.dto.ts`、`dto/list-withdrawal-address-query.dto.ts`
- Modify: `withdrawal-address.service.ts`（整文件重写 +spec）、`withdrawal-address-workflow.service.ts`（+spec）、`withdrawal-address.controller.ts`、`withdrawal-address-admin.controller.ts`
- Delete: `address-validator.util.ts`、`address-validator.util.spec.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（建单时"目标地址须在册"的查询——`git grep -n "withdrawalAddress" -- src/modules/trading` 定位）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（第 466–478 行）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `scripts/demo-lib.ts`（第 352–395 行）、`test/withdraw-money-arcs.e2e-spec.ts:222-235`、`test/swap-money-arc.e2e-spec.ts:210-225`、`test/withdraw-sumsub-scenarios.e2e-spec.ts:262-277`、`test/swap-sumsub-scenarios.e2e-spec.ts:262-277`

**Interfaces:**
- Consumes: Task 1 的 `assertNetwork / validateAddressForNetwork / NETWORKS / NETWORK_CODES`、`fakeTronAddress`。
- Produces: `WithdrawalAddressAction { ACTIVATE, CANCEL, SUSPEND, UNSUSPEND, DEACTIVATE }`、`assertWithdrawalAddressTransition(from, action): string`；`WithdrawalAddressService.create(data)`（`network` 取代 `assetId`）、`createBankAccount(data)`、`activate / cancel / suspend / unsuspend / skipCooling / deactivate / updateDetails(addressNo, customerId, patch)`、`listByCustomer(customerId, { network?, status?, addressType?, take?, skip? })`、`listAll({ customerId?, customerNo?, network?, status?, addressType?, q?, take?, skip? })`、`findExpiredPendingForCustomer(customerId, network?)`；`BANK_RAIL_NETWORK`（= `'AED_ZAND'`）；workflow 新增 `updateAddress(addressNo, customerId, customerNo, patch)`、`unsuspendAddress(addressNo, actor, reason)`；审计码 `WITHDRAWAL_ADDRESS_UPDATED`、`WITHDRAWAL_ADDRESS_UNSUSPENDED`；路由 `PATCH /client/withdrawal-addresses/:addressNo`、`POST /admin/withdrawal-addresses/:addressNo/unsuspend`。

- [ ] **Step 1: 逐键 grep**

```bash
for k in validateCryptoAddress NETWORK_ALIASES lazyActivateForCustomer customerId_assetId_address "network: 'FIAT'" ASSET_NOT_CRYPTO ASSET_NOT_FIAT MAX_ADDRESSES_PER_ASSET; do echo "== $k"; git grep -n "$k" -- src prisma scripts test admin-web/src client-web/src | grep -v "\.md:"; done
git grep -n "withdrawalAddress" -- src/modules/trading
```
Expected: 命中都在本任务 Files 里；最后一条给出提现建单校验地址的位置（改法见 Step 7）。

- [ ] **Step 2: 写失败的单测**

`constants/withdrawal-address-transitions.constant.spec.ts`：

```ts
import { assertWithdrawalAddressTransition, WithdrawalAddressAction, WITHDRAWAL_ADDRESS_TRANSITIONS } from './withdrawal-address-transitions.constant';

describe('提现地址状态迁移表（法二，spec §5）', () => {
  it('五条边', () => {
    expect(assertWithdrawalAddressTransition('PENDING_ACTIVATION', WithdrawalAddressAction.ACTIVATE)).toBe('ACTIVE');
    expect(assertWithdrawalAddressTransition('PENDING_ACTIVATION', WithdrawalAddressAction.CANCEL)).toBe('CANCELLED');
    expect(assertWithdrawalAddressTransition('ACTIVE', WithdrawalAddressAction.SUSPEND)).toBe('SUSPENDED');
    expect(assertWithdrawalAddressTransition('SUSPENDED', WithdrawalAddressAction.UNSUSPEND)).toBe('ACTIVE');
    expect(assertWithdrawalAddressTransition('ACTIVE', WithdrawalAddressAction.DEACTIVATE)).toBe('DEACTIVATED');
  });
  it('终态无出边；非法跃迁抛 409 Invalid transition', () => {
    expect(WITHDRAWAL_ADDRESS_TRANSITIONS.CANCELLED).toEqual({});
    expect(WITHDRAWAL_ADDRESS_TRANSITIONS.DEACTIVATED).toEqual({});
    expect(() => assertWithdrawalAddressTransition('ACTIVE', WithdrawalAddressAction.ACTIVATE)).toThrow(/Invalid transition/);
    expect(() => assertWithdrawalAddressTransition('SUSPENDED', WithdrawalAddressAction.DEACTIVATE)).toThrow(/Invalid transition/);
    expect(() => assertWithdrawalAddressTransition('PENDING_ACTIVATION', WithdrawalAddressAction.SUSPEND)).toThrow(/Invalid transition/);
  });
});
```

`withdrawal-address.service.spec.ts`：`mockAsset` 删；`create` 的入参把 `assetId: 'asset-1', network: 'ETH', address: '0x…'` 改为 `network: 'TRON', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'`；"rejects invalid address format" 用 `'0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18'`；"rejects when address limit reached" 的 count 断言 `where` 改 `{ customerId: 'cust-1', network: 'TRON', status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] } }`；新增：

```ts
    it('rejects a bank-rail network for on-chain registration (NETWORK_NOT_CHAIN)', async () => {
      await expect(service.create({ customerId: 'cust-1', customerNo: 'CUS001', network: 'AED_ZAND', address: 'AE070860000000000000001', addressType: 'SELF_CUSTODY', traceId: 't', ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION' }))
        .rejects.toMatchObject({ response: { code: 'NETWORK_NOT_CHAIN' } });
    });
```
`createBankAccount` 用例入参删 `assetId`，断言 create 的 `data.network === 'AED_ZAND'`。`activate` 的 "returns existing ACTIVE address idempotently" 改为 "rejects activating an ACTIVE address (409 Invalid transition)"（`rejects.toBeInstanceOf(ConflictException)`）。`cancel` / `suspend` 的 "non-PENDING / non-ACTIVE" 用例断言改 `ConflictException` + `/Invalid transition/`。`deactivate` 的 "non-ACTIVE" 同改。新增两个 describe：

```ts
  describe('unsuspend', () => {
    it('SUSPENDED → ACTIVE，清空三个 suspend 字段', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', status: 'SUSPENDED' });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ addressNo: 'WAD1', status: 'ACTIVE' });
      const r = await service.unsuspend('WAD1');
      expect(r.status).toBe('ACTIVE');
      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'ACTIVE', suspendedAt: null, suspendedBy: null, suspendReason: null },
      }));
    });
    it('ACTIVE 不能 unsuspend → 409', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', status: 'ACTIVE' });
      await expect(service.unsuspend('WAD1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateDetails', () => {
    it('只改 label / beneficiaryName，地址本身不动', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-1', status: 'ACTIVE', label: 'old', beneficiaryName: null });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ addressNo: 'WAD1', label: 'Ledger' });
      await service.updateDetails('WAD1', 'cust-1', { label: 'Ledger' });
      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith({ where: { addressNo: 'WAD1' }, data: { label: 'Ledger' } });
    });
    it('终态（DEACTIVATED）不可改 → 409；别人的地址 → 403', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-1', status: 'DEACTIVATED' });
      await expect(service.updateDetails('WAD1', 'cust-1', { label: 'x' })).rejects.toBeInstanceOf(ConflictException);
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-2', status: 'ACTIVE' });
      await expect(service.updateDetails('WAD1', 'cust-1', { label: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
```

`withdrawal-address-workflow.service.spec.ts`：`registerAddress` 两条用例的 dto `assetId` 改 `network: 'TRON'`，prisma mock 删 `asset.findUnique`；新增一条 `registerAddress` 传 `network: 'AED_ZAND'` → `rejects.toMatchObject({ response: { code: 'NETWORK_NOT_CHAIN' } })`；新增 `unsuspendAddress` 写 `WITHDRAWAL_ADDRESS_UNSUSPENDED`（`recordByActor` 被调、`reason` 透传）与 `updateAddress` 写 `WITHDRAWAL_ADDRESS_UPDATED`（`beforeData` / `afterData` 都在）两条。

Run: `npx jest src/modules/asset-treasury/withdrawal-addresses --no-coverage` → FAIL。

- [ ] **Step 3: schema 终态 + 迁移**

`model WithdrawalAddress`：删 `assetId String` 与 `asset Asset @relation(...)` 两行；`@@unique([customerId, assetId, address])` → `@@unique([customerId, network, address])`；`@@index([customerId, assetId, status])` → `@@index([customerId, network, status])`。`model Asset` 删 `withdrawalAddresses WithdrawalAddress[]`。

```bash
export DATABASE_URL="$(source scripts/db-env.sh && read_database_url "$PWD" self)"
npx prisma migrate dev --create-only --name v3w1_withdrawal_address_by_network && npx prisma generate
```

- [ ] **Step 4: 迁移表常量 + DTO**

`constants/withdrawal-address-transitions.constant.ts`：

```ts
import { ConflictException } from '@nestjs/common';

export enum WithdrawalAddressAction {
  ACTIVATE = 'ACTIVATE',     // 冷却到期扫描 / 查询前懒激活 / 管理员跳过冷却（⚡）
  CANCEL = 'CANCEL',         // 客户在冷却期内取消
  SUSPEND = 'SUSPEND',       // 管理员强制暂停
  UNSUSPEND = 'UNSUSPEND',   // 管理员恢复（D5 补的出边）
  DEACTIVATE = 'DEACTIVATE', // 客户自助停用
}

/** 提现地址状态迁移表（法二，spec §5）。CANCELLED / DEACTIVATED 是终态。 */
export const WITHDRAWAL_ADDRESS_TRANSITIONS: Record<string, Partial<Record<WithdrawalAddressAction, string>>> = {
  PENDING_ACTIVATION: { [WithdrawalAddressAction.ACTIVATE]: 'ACTIVE', [WithdrawalAddressAction.CANCEL]: 'CANCELLED' },
  ACTIVE:             { [WithdrawalAddressAction.SUSPEND]: 'SUSPENDED', [WithdrawalAddressAction.DEACTIVATE]: 'DEACTIVATED' },
  SUSPENDED:          { [WithdrawalAddressAction.UNSUSPEND]: 'ACTIVE' },
  CANCELLED:          {},
  DEACTIVATED:        {},
};

export function assertWithdrawalAddressTransition(from: string, action: WithdrawalAddressAction): string {
  const to = WITHDRAWAL_ADDRESS_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: withdrawal address in ${from} cannot ${action}`);
  return to;
}
```

`dto/create-withdrawal-address.dto.ts`：`assetId` 字段换成

```ts
  @ApiProperty({ description: 'Network the address lives on (chain networks only)', enum: NETWORK_CODES })
  @IsString()
  @IsIn(NETWORK_CODES)
  network!: string;
```
（import `IsIn`、`NETWORK_CODES from '../../../../config/manifests/networks.manifest'`；删 `IsUUID`。）
`dto/create-bank-account.dto.ts`：删 `assetId` 字段与 `IsUUID`。
`dto/list-withdrawal-address-query.dto.ts`：`assetId?` → `@IsString() @IsOptional() network?: string;`。
新建 `dto/update-withdrawal-address.dto.ts`：

```ts
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 只能改标签与收款人；地址 / IBAN 不可改——改地址 = 新登记，冷却闸才有意义（spec §5） */
export class UpdateWithdrawalAddressDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  beneficiaryName?: string;
}
```
新建 `dto/unsuspend-withdrawal-address.dto.ts`：

```ts
import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UnsuspendWithdrawalAddressDto {
  @ApiProperty({ description: 'Reason for lifting the suspension' })
  @IsString()
  @MinLength(1)
  reason!: string;
}
```

- [ ] **Step 5: 服务重写（五处直写全经迁移表）**

`withdrawal-address.service.ts` 整文件（`listAll` 与 `flattenCustomerName` 保持原样，只删 `include.asset`）：

```ts
import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { assertNetwork, validateAddressForNetwork, NETWORKS, NETWORK_CODES } from '../../../config/manifests/networks.manifest';
import { validateIban, validateSwiftBic } from './bank-validator.util';
import { assertWithdrawalAddressTransition, WithdrawalAddressAction } from './constants/withdrawal-address-transitions.constant';

const MAX_ADDRESSES_PER_NETWORK = 3;
const COOLING_PERIOD_HOURS = 24;
/** 唯一的银行通道网络：银行账户类地址都挂它（今天 = AED_ZAND） */
export const BANK_RAIL_NETWORK: string = NETWORK_CODES.map((c) => NETWORKS[c]).find((n) => n.kind === 'BANK_RAIL')!.code;

interface CreateAddressData {
  customerId: string;
  customerNo: string;
  network: string;
  address: string;
  addressType: string;
  label?: string;
  beneficiaryName?: string;
  memo?: string;
  counterpartyVaspName?: string;
  counterpartyVaspDid?: string;
  ownershipDeclaredAt: Date;
  ownershipProofType: string;
  traceId: string;
}

interface CreateBankAccountData {
  customerId: string;
  customerNo: string;
  iban: string;
  swiftBic: string;
  bankName: string;
  beneficiaryName: string;
  label?: string;
  ownershipDeclaredAt: Date;
  ownershipProofType: string;
  traceId: string;
}

@Injectable()
export class WithdrawalAddressService {
  private readonly logger = new Logger(WithdrawalAddressService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateAddressData, tx?: any) {
    const db = tx ?? this.prisma;
    const network = assertNetwork(data.network);
    if (network.kind !== 'CHAIN') {
      throw new BadRequestException({ code: 'NETWORK_NOT_CHAIN', message: `Only chain networks accept on-chain addresses (got ${network.code})` });
    }
    const validation = validateAddressForNetwork(network.code, data.address);
    if (!validation.valid) {
      throw new BadRequestException({ code: 'INVALID_ADDRESS_FORMAT', message: validation.reason });
    }

    const activeCount = await db.withdrawalAddress.count({
      where: { customerId: data.customerId, network: network.code, status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] } },
    });
    if (activeCount >= MAX_ADDRESSES_PER_NETWORK) {
      throw new BadRequestException({ code: 'ADDRESS_LIMIT_REACHED', message: `Maximum ${MAX_ADDRESSES_PER_NETWORK} addresses per network` });
    }

    const addressNo = generateReferenceNo('WAD');
    const activatesAt = new Date(Date.now() + COOLING_PERIOD_HOURS * 60 * 60 * 1000);
    try {
      return await db.withdrawalAddress.create({
        data: {
          addressNo,
          customerId: data.customerId,
          customerNo: data.customerNo,
          network: network.code,
          address: data.address,
          addressType: data.addressType,
          label: data.label,
          beneficiaryName: data.beneficiaryName,
          memo: data.memo,
          counterpartyVaspName: data.counterpartyVaspName,
          counterpartyVaspDid: data.counterpartyVaspDid,
          ownershipDeclaredAt: data.ownershipDeclaredAt,
          ownershipProofType: data.ownershipProofType,
          activatesAt,
          traceId: data.traceId,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException({ code: 'ADDRESS_ALREADY_REGISTERED', message: 'This address is already registered on this network' });
      }
      throw error;
    }
  }

  async createBankAccount(data: CreateBankAccountData, tx?: any) {
    const ibanResult = validateIban(data.iban);
    if (!ibanResult.valid) throw new BadRequestException({ code: 'INVALID_IBAN', message: ibanResult.reason });
    const swiftResult = validateSwiftBic(data.swiftBic);
    if (!swiftResult.valid) throw new BadRequestException({ code: 'INVALID_SWIFT_BIC', message: swiftResult.reason });

    const cleanIban = data.iban.replace(/\s/g, '').toUpperCase();
    const cleanSwift = data.swiftBic.replace(/\s/g, '').toUpperCase();
    const addressNo = generateReferenceNo('WAD');

    const run = async (db: any) => {
      const activeCount = await db.withdrawalAddress.count({
        where: { customerId: data.customerId, network: BANK_RAIL_NETWORK, status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] } },
      });
      if (activeCount >= MAX_ADDRESSES_PER_NETWORK) {
        throw new BadRequestException({ code: 'ADDRESS_LIMIT_REACHED', message: `Maximum ${MAX_ADDRESSES_PER_NETWORK} bank accounts per network` });
      }

      // 首个法币账户即时生效（登记时余额为零，无盗提风险）——交易起始前置门的起点
      const isFirst = (await db.withdrawalAddress.count({
        where: { customerId: data.customerId, addressType: 'BANK', status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] } },
      })) === 0;

      const now = new Date();
      const status = isFirst ? 'ACTIVE' : 'PENDING_ACTIVATION';
      const activatesAt = isFirst ? now : new Date(now.getTime() + COOLING_PERIOD_HOURS * 60 * 60 * 1000);
      const activatedAt = isFirst ? now : null;

      try {
        return await db.withdrawalAddress.create({
          data: {
            addressNo,
            customerId: data.customerId,
            customerNo: data.customerNo,
            network: BANK_RAIL_NETWORK,
            address: cleanIban,
            addressType: 'BANK',
            label: data.label,
            beneficiaryName: data.beneficiaryName,
            iban: cleanIban,
            swiftBic: cleanSwift,
            bankName: data.bankName,
            ownershipDeclaredAt: data.ownershipDeclaredAt,
            ownershipProofType: data.ownershipProofType,
            status,
            activatesAt,
            activatedAt,
            traceId: data.traceId,
          },
        });
      } catch (error: any) {
        if (error?.code === 'P2002') {
          throw new ConflictException({ code: 'BANK_ACCOUNT_ALREADY_REGISTERED', message: 'This IBAN is already registered' });
        }
        throw error;
      }
    };

    if (tx) return run(tx);
    return this.prisma.$transaction((txClient: any) => run(txClient));
  }

  /** 冷却到期激活（扫描 / 懒激活）。时间未到 400；状态不对 409（迁移表） */
  async activate(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.ACTIVATE);
    if (addr.activatesAt > new Date()) {
      throw new BadRequestException({ code: 'COOLING_PERIOD_NOT_EXPIRED', message: 'Cooling period has not expired yet' });
    }
    return db.withdrawalAddress.update({ where: { addressNo }, data: { status: to, activatedAt: new Date() } });
  }

  async cancel(addressNo: string, customerId: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    if (addr.customerId !== customerId) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'You can only cancel your own addresses' });
    }
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.CANCEL);
    return db.withdrawalAddress.update({ where: { addressNo }, data: { status: to, cancelledAt: new Date() } });
  }

  async suspend(addressNo: string, adminNo: string, reason: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.SUSPEND);
    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: to, suspendedAt: new Date(), suspendedBy: adminNo, suspendReason: reason },
    });
  }

  async unsuspend(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.UNSUSPEND);
    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: to, suspendedAt: null, suspendedBy: null, suspendReason: null },
    });
  }

  /** ⚡ 后门：同一条 ACTIVATE 边，只是不看时间 */
  async skipCooling(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.ACTIVATE);
    return db.withdrawalAddress.update({ where: { addressNo }, data: { status: to, activatedAt: new Date() } });
  }

  async deactivate(addressNo: string, customerId: string) {
    const addr = await this.prisma.withdrawalAddress.findUnique({ where: { addressNo } });
    if (!addr || addr.customerId !== customerId) {
      throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Withdrawal address ${addressNo} not found` });
    }
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.DEACTIVATE);
    if (addr.addressType === 'BANK' && (await this.countActiveFiatAddresses(customerId)) <= 1) {
      throw new BadRequestException({ code: 'LAST_ACTIVE_FIAT_ADDRESS', message: '这是最后一个可用法币提现地址，请先新增并激活一个再停用' });
    }
    // 在途守卫：WithdrawTransaction 与地址簿无外键，只能按付款腿镜像的 toIban / toAddress 串匹配
    const inflight = await this.prisma.fundsOrder.count({
      where: {
        withdrawTransaction: { ownerType: 'CUSTOMER', ownerId: customerId },
        status: { notIn: ['CLEARED', 'FAILED', 'TIMEOUT'] },
        OR: [
          ...(addr.iban ? [{ toIban: addr.iban }] : []),
          ...(addr.address ? [{ toAddress: addr.address }] : []),
        ],
      },
    });
    if (inflight > 0) {
      throw new BadRequestException({ code: 'ADDRESS_HAS_INFLIGHT_WITHDRAWAL', message: 'This address has an in-flight withdrawal and cannot be deactivated' });
    }
    return this.prisma.withdrawalAddress.update({
      where: { id: addr.id },
      data: { status: to, deactivatedAt: new Date(), deactivatedBy: 'CUSTOMER' },
    });
  }

  /** 改：只收标签与收款人；终态不可改 */
  async updateDetails(addressNo: string, customerId: string, patch: { label?: string; beneficiaryName?: string }) {
    const addr = await this.prisma.withdrawalAddress.findUnique({ where: { addressNo } });
    if (!addr) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Withdrawal address ${addressNo} not found` });
    if (addr.customerId !== customerId) throw new ForbiddenException({ code: 'NOT_OWNER', message: 'You can only edit your own addresses' });
    if (addr.status === 'CANCELLED' || addr.status === 'DEACTIVATED') {
      throw new ConflictException({ code: 'ADDRESS_TERMINAL', message: `Cannot edit an address in ${addr.status} status` });
    }
    const data: { label?: string; beneficiaryName?: string } = {};
    if (patch.label !== undefined) data.label = patch.label;
    if (patch.beneficiaryName !== undefined) data.beneficiaryName = patch.beneficiaryName;
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update: provide label and/or beneficiaryName');
    return this.prisma.withdrawalAddress.update({ where: { addressNo }, data });
  }

  async findByNo(addressNo: string) {
    const raw = await this.prisma.withdrawalAddress.findUnique({
      where: { addressNo },
      include: { customer: { select: { firstName: true, lastName: true } } },
    });
    if (!raw) return null;
    return this.flattenCustomerName(raw);
  }

  async listByCustomer(customerId: string, filters: { network?: string; status?: string; addressType?: string; take?: number; skip?: number }) {
    const where: any = { customerId };
    if (filters.network) where.network = filters.network;
    if (filters.status) where.status = filters.status;
    if (filters.addressType) where.addressType = filters.addressType;
    const [items, total] = await Promise.all([
      this.prisma.withdrawalAddress.findMany({ where, take: filters.take ?? 50, skip: filters.skip ?? 0, orderBy: [{ network: 'asc' }, { createdAt: 'desc' }] }),
      this.prisma.withdrawalAddress.count({ where }),
    ]);
    return { items, total };
  }

  async listAll(filters: { customerId?: string; customerNo?: string; network?: string; status?: string; addressType?: string; q?: string; take?: number; skip?: number }) {
    // 与现文件第 308–335 行相同，只把 filters.assetId → filters.network（where.network），include 删 asset
  }

  async hasActiveFiatWithdrawalAddress(customerId: string): Promise<boolean> { /* 原样 */ }
  async countActiveFiatAddresses(customerId: string): Promise<number> { /* 原样 */ }
  async findPendingExpired() { /* 原样 */ }

  async findExpiredPendingForCustomer(customerId: string, network?: string) {
    const where: any = { customerId, status: 'PENDING_ACTIVATION', activatesAt: { lte: new Date() } };
    if (network) where.network = network;
    return this.prisma.withdrawalAddress.findMany({ where });
  }

  private flattenCustomerName(r: any) { /* 原样 */ }
  private async findByNoOrThrow(addressNo: string, db: any) { /* 原样 */ }
}
```
（标注"原样"的方法从现文件照抄；`lazyActivateForCustomer` 删除。）

- [ ] **Step 6: 工作流与控制器**

`withdrawal-address-workflow.service.ts`：
- import 加 `assertNetwork`、`BANK_RAIL_NETWORK`（自 `./withdrawal-address.service`）。
- `registerAddress`：删第 37–44 行资产四判；加 `const network = assertNetwork(dto.network); if (network.kind !== 'CHAIN') throw new BadRequestException({ code: 'NETWORK_NOT_CHAIN', message: 'Only chain networks accept on-chain addresses' });`；`trAdapter.attributeAddress(dto.address, network.code)`；`create({ …, network: network.code, … })`（删 `assetId`）；审计 `afterData: { addressType, address: dto.address, network: network.code, counterpartyVaspName: attribution.vaspName, label: dto.label }`。
- `registerBankAccount`：删第 101–108 行资产判；`createBankAccount` 入参删 `assetId`；审计 `afterData: { addressType: 'BANK', iban: maskedIban, bankName: dto.bankName, network: BANK_RAIL_NETWORK, skipCooling: address.status === 'ACTIVE' }`。
- `batchActivateExpired(customerId: string, network?: string)`。
- 新增两方法：

```ts
  async updateAddress(addressNo: string, customerId: string, customerNo: string, patch: { label?: string; beneficiaryName?: string }) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });
    const result = await this.addressService.updateDetails(addressNo, customerId, patch);
    await this.auditLogsService.recordSystem({
      action: 'WITHDRAWAL_ADDRESS_UPDATED',
      actionDomain: 'CONFIG',
      primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      primarySubjectNo: addressNo,
      correlationId: existing.traceId,
      outcome: AuditOutcome.SUCCESS,
      beforeData: { label: existing.label, beneficiaryName: existing.beneficiaryName },
      afterData: { label: result.label, beneficiaryName: result.beneficiaryName },
      metadata: { updatedByCustomerNo: customerNo },
      sourcePlatform: 'CLIENT_API',
      ownerCustomerNo: customerNo,
    });
    return result;
  }

  async unsuspendAddress(addressNo: string, actor: { userId: string; userNo: string; role: string }, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });
    const result = await this.addressService.unsuspend(addressNo);
    await this.auditLogsService.recordByActor(
      {
        action: 'WITHDRAWAL_ADDRESS_UNSUSPENDED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        primarySubjectNo: addressNo,
        correlationId: existing.traceId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        metadata: { unsuspendedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        ownerCustomerNo: existing.customerNo,
      },
      { actorType: 'ADMIN', actorNo: actor.userNo || 'UNKNOWN', actorDisplayName: actor.userNo || 'UNKNOWN', actorRolesAtTime: [actor.role || 'UNKNOWN'] },
    );
    return result;
  }
```

`withdrawal-address.controller.ts`：`list` 里 `batchActivateExpired(customerId, query.network)`；加：

```ts
  @Patch(':addressNo')
  @ApiOperation({ summary: 'Edit label / beneficiary name of my withdrawal address' })
  async update(@Request() req: any, @Param('addressNo') addressNo: string, @Body() dto: UpdateWithdrawalAddressDto) {
    const { customerId, customerNo } = this.extractCustomer(req);
    return this.workflowService.updateAddress(addressNo, customerId, customerNo, dto);
  }
```
（import `Patch`、`UpdateWithdrawalAddressDto`。）

`withdrawal-address-admin.controller.ts` 加：

```ts
  @Post(':addressNo/unsuspend')
  @ApiOperation({ summary: 'Lift a suspension' })
  async unsuspend(@Request() req: any, @Param('addressNo') addressNo: string, @Body() dto: UnsuspendWithdrawalAddressDto) {
    const actor = this.extractAdmin(req);
    return this.workflowService.unsuspendAddress(addressNo, actor, dto.reason);
  }
```

```bash
git rm src/modules/asset-treasury/withdrawal-addresses/address-validator.util.ts src/modules/asset-treasury/withdrawal-addresses/address-validator.util.spec.ts
```

- [ ] **Step 7: 提现建单"目标地址须在册"改按网络**

Step 1 最后一条 grep 给出的位置（`withdraw-transactions.service.ts` 建单校验）：查询条件里的 `assetId: <asset.id>` 改为 `network: <asset>.network`（`asset` 是建单时已取到的资产行），其余（`customerId` / `address` 或 `iban` / `status: 'ACTIVE'`）不变；报错文案里"for this asset"改"on this network"。

- [ ] **Step 8: RBAC + 审计合同**

`rbac.catalog.ts` 第 472–477 行之后加：

```ts
  route('POST', '/admin/withdrawal-addresses/:addressNo/unsuspend', 'Lift withdrawal address suspension', [
    'WITHDRAWAL_ADDRESS_WRITE',
  ]),
```
桶 `treasury.manage_addresses` 描述改 `'Suspend / unsuspend withdrawal addresses, skip cooling period (simulation)'`。

`audit-actions.constant.ts` 的 `V1_AUDIT_ACTIONS` 在 `WITHDRAWAL_ADDRESS_COOLING_SKIPPED` 后加：

```ts
  // 波一新增：改标签 / 收款人（客户单步，INHERIT 地址自己的 traceId）；管理员恢复（补 D5 出边）
  WITHDRAWAL_ADDRESS_UPDATED:         { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_UNSUSPENDED:     { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
```

- [ ] **Step 9: 造数与 e2e 夹具换钥匙**

`scripts/demo-lib.ts` 第 352–395 行：法币地址 upsert 的 `where` 改 `{ customerId_network_address: { customerId: c.id, network: 'AED_ZAND', address: vibanIban } }`，`create` 删 `assetId`、`network: 'AED_ZAND'`；链上地址：`const cryptoWdAddr = fakeTronAddress(\`${SIM}wd${idx}\`);`，`where` 改 `{ customerId_network_address: { customerId: c.id, network: 'TRON', address: cryptoWdAddr } }`，`create` 删 `assetId`、`network: 'TRON'`。

四份 e2e 的 `ensureWithdrawalAddress`（形状统一）：

```ts
  async function ensureWithdrawalAddress(opts: { addressType: string; network: string; address: string; iban?: string }): Promise<void> {
    const existing = await (prisma as any).withdrawalAddress.findFirst({
      where: { customerId, network: opts.network, address: opts.address, status: 'ACTIVE' },
    });
    if (existing) return;
    await (prisma as any).withdrawalAddress.create({
      data: {
        addressNo: `WAD-E2E-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId, customerNo, network: opts.network,
        address: opts.address, addressType: opts.addressType, iban: opts.iban ?? null,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'E2E_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: `e2e-address-${opts.addressType}`,
      },
    });
  }
```
调用方：`assetId: aedAssetId, network: 'FIAT'` → `network: 'AED_ZAND'`；`assetId: usdt.id, network: 'TRON'` → `network: 'TRON'`，链上 `address` 用 `fakeTronAddress(...)`。

- [ ] **Step 10: 闸门**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/asset-treasury/withdrawal-addresses src/modules/audit-logging/constants --no-coverage
bash scripts/stack.sh down self && bash scripts/stack.sh reset self && bash scripts/stack.sh up self
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'withdraw-money-arcs|withdraw-sumsub-scenarios'
```
Expected: 全绿（`demo:setup` 建出 8 条 ACTIVE 地址：6 银行 + alice / bob 各 1 条 TRON）。

- [ ] **Step 11: Commit**

```bash
git add prisma src/modules/asset-treasury/withdrawal-addresses src/modules/trading/withdraw-transactions src/modules/identity/access-control/rbac.catalog.ts src/modules/audit-logging/constants/audit-actions.constant.ts scripts/demo-lib.ts test
git commit -m "feat(v3): 提现地址簿按网络归属 + 五条边迁移表 + 改标签/恢复两动作（波一 T8）"
```

**本任务过哪几条**：改 schema / seed → 重铺 + `demo:all`；新端点 → catalog（管理端）+ 四属性审计码；状态机 → 迁移表 + 非法跃迁 409 单测；`demo:withdraw` 走通；无前端（Task 9）。

---

### Task 9: 提现地址簿前端——客户端选网络 / 分组 / 取消 / 改标签，管理台 DEACTIVATED 筛选 / Unsuspend / ⚡ 区

**本任务做**：客户端 `WithdrawalAddresses` 登记表单选网络、卡片按网络分组、待激活卡片 "Cancel registration"、详情 "Edit" 改标签与收款人；`Withdraw` 地址下拉按资产的网络取 ACTIVE 地址并去掉 BTC/ETH 硬编码文案；管理台列表网络筛选 + `DEACTIVATED` 选项，详情 `Unsuspend` 按钮 + `Skip Cooling` 挪进「Manual Simulation ⚡」区；侧栏入口权限改 `WITHDRAWAL_ADDRESSES_READ`（D6）；截图。**不做**：后端。

**Files:**
- Modify: `client-web/src/pages/WithdrawalAddresses.tsx`（第 30–55 行类型、第 169–190 行资产加载、第 231–249 行登记 body、第 311–321 行银行 body、第 520–560 / 615–650 行卡片、第 690–708 行表单 Asset 选项、第 835–848 行待激活块、第 920–945 行 footer）
- Modify: `client-web/src/pages/Withdraw.tsx`（第 196–205 行取地址、第 911–915 行文案）
- Modify: `admin-web/src/pages/WithdrawalAddressList.tsx`（第 36–43、104–115、218–239、354 行）、`WithdrawalAddressDetail.tsx`（第 38、323、420–445 行）
- Modify: `admin-web/src/rbac/permissions.ts`、`admin-web/src/components/DashboardLayout.tsx`（第 236–240 行）

- [ ] **Step 1: 客户端地址簿页**

`WithdrawalAddresses.tsx`：
- 类型：`WithdrawalAddress` 删 `asset`，保留 `network / label / beneficiaryName`；`Asset` 类型加 `network: string; type: string`。
- 网络选项从资产派生（客户端不引后端注册表）：

```ts
  const chainNetworks = useMemo(() => {
    const byNetwork = new Map<string, string[]>();
    for (const a of assets) {
      if (a.type !== 'CRYPTO') continue;
      byNetwork.set(a.network, [...(byNetwork.get(a.network) ?? []), a.code]);
    }
    return Array.from(byNetwork, ([network, codes]) => ({ network, label: `${network} (${codes.join(', ')})` }));
  }, [assets]);
```
  `formAssetId` state 改名 `formNetwork`（默认 `chainNetworks[0]?.network ?? ''`）；表单第 690–708 行 `Asset` 选择改为 `Network` 选择（options = `chainNetworks`）；登记 body：`{ network: formNetwork, address, ownershipDeclaration: true, label, beneficiaryName, memo }`；校验提示 `Please select a network`。银行表单删资产选择与 `assetId` 字段（body 只剩 `beneficiaryName / bankName / iban / swiftBic / label / ownershipDeclaration`）。
- 卡片分组：链上列表按 `addr.network` 分组渲染（组标题 `TRON`），银行列表标题 `AED_ZAND · Bank accounts`；卡片副标题 `addr.asset.code` 改 `addr.network`。
- 待激活卡片（第 551 行附近 `addr.status === 'PENDING_ACTIVATION' && (...)`）加按钮 `Cancel registration` → `handleCancel(addr)`：

```ts
  const handleCancel = async (addr: WithdrawalAddress) => {
    const reason = window.prompt('Why are you cancelling this registration?');
    if (!reason?.trim()) return;
    const res = await customerFetch(`${API}/client/withdrawal-addresses/${addr.addressNo}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    if (!res.ok) { alert(await getCustomerApiErrorMessage(res, 'Failed to cancel registration')); return; }
    await fetchAddresses();
  };
```
- 详情弹窗加 `Edit` 区：两个输入框（Label / Beneficiary name，预填现值）+ `Save` → `PATCH /client/withdrawal-addresses/:addressNo` body `{ label, beneficiaryName }` → 成功后 `fetchAddresses()` 并刷新 `detailAddr`；终态（CANCELLED / DEACTIVATED）不显示 Edit 区。

- [ ] **Step 2: 客户端提现页**

`Withdraw.tsx` 第 196–205 行：`params` 改 `{ network: assets.find((a) => a.id === selectedAssetId)?.network ?? '', status: 'ACTIVE' }`（`network` 为空时直接 `setAddresses([])` 返回）。第 911–915 行「Minimum Withdrawal」段文案改：`Per-withdrawal minimum and maximum follow the platform limits for this asset (see the quote before you confirm). Fees are deducted from the amount.`。

- [ ] **Step 3: 管理台列表与详情**

`WithdrawalAddressList.tsx`：类型删 `asset`；`FilterState.assetId` → `network`；删第 104–115 行资产选项加载；第 218–227 行资产下拉改网络下拉（`TRON / AED_ZAND` 两项）；params 改 `network`；状态下拉加 `<option value="DEACTIVATED">DEACTIVATED</option>`；第 354 行 Asset 列改 Network 列（`item.network`，原 Network 列删，表头同步）。
`WithdrawalAddressDetail.tsx`：类型删 `asset`；第 323 行 `Asset` 字段删（保留 Network）；右栏 Actions 改为两组：

```tsx
              <div className="mt-2.5 flex flex-col gap-2">
                {isActive && (
                  <button onClick={() => setShowSuspendModal(true)} disabled={actionLoading} className={adminButtonClass('workflowNegative')}>
                    Force Suspend
                  </button>
                )}
                {data.status === 'SUSPENDED' && canWrite && (
                  <button onClick={() => setShowUnsuspendModal(true)} disabled={actionLoading} className={adminButtonClass('workflowPrimary')}>
                    Unsuspend
                  </button>
                )}
              </div>
            </div>
          )}
          {isPending && canWrite && (
            <div className="border-b border-adm-border py-4">
              <Cap>Manual Simulation ⚡</Cap>
              <p className="mt-1 font-mono text-[10px] text-adm-t3">Demo backdoor — bypasses the 24h cooling period. Reason is audited.</p>
              <button onClick={() => setShowSkipCoolingModal(true)} disabled={actionLoading} className={`${adminButtonClass('workflowPrimary')} mt-2`}>
                ⚡ Skip Cooling Period
              </button>
            </div>
          )}
```
  `canWrite = hasAnyPermission([PERMISSIONS.WITHDRAWAL_ADDRESS_SUSPEND])`；Unsuspend 弹窗照 Suspend 弹窗复制（理由必填）→ `POST /admin/withdrawal-addresses/${addressNo}/unsuspend`。
`permissions.ts` 在 `WITHDRAWAL_ADDRESS_SKIP_COOLING` 后加 `WITHDRAWAL_ADDRESS_UNSUSPEND: 'api.post.admin_withdrawal_addresses_addressno_unsuspend',`。
`DashboardLayout.tsx` 第 239 行 `requiredPermissions: [PERMISSIONS.BASE_ACCESS]` → `[PERMISSIONS.WITHDRAWAL_ADDRESSES_READ]`。

- [ ] **Step 4: tsc ②③ + 截图**

```bash
cd admin-web && npx tsc -b --noEmit && cd .. && cd client-web && npx tsc -b --noEmit && cd .. && npm run test:client
```
截图：
1. 客户端 alice → Wallet 页 → Add address：Network 下拉 `TRON (USDT-TRON)` → 用 `node -e "console.log(require('./dist/common/utils/tron-address.util.js').fakeTronAddress('demo-register-1'))"`（无 dist 时 `npx ts-node -e "import('./src/common/utils/tron-address.util').then(m=>console.log(m.fakeTronAddress('demo-register-1')))"`）生成一枚合法地址登记 → 卡片进 TRON 组、显示冷却倒计时 → 截图 ①。
2. 该卡片点 `Cancel registration` 填理由 → 卡片变 Cancelled → 截图 ②。
3. 再登记一条 → 详情 Edit 改 Label 为 `My Ledger` → 保存后卡片标题变 → 截图 ③。
4. 管理台 `treasury@` → Withdrawal Addresses：状态筛 DEACTIVATED 可选、Network 列 → 截图 ④；打开步骤 3 那条：⚡ 区 Skip Cooling → ACTIVE → Force Suspend（理由）→ SUSPENDED → Unsuspend（理由）→ ACTIVE → 截图 ⑤（Unsuspend 后）。
5. `mlro@` 登录：侧栏无 Withdrawal Addresses 入口（D6）→ 截图 ⑥。
6. 客户端 Withdraw 页选 USDT：地址下拉只列 TRON 的 ACTIVE 地址；文案无 BTC/ETH → 截图 ⑦。

- [ ] **Step 5: Commit**

```bash
git add admin-web/src client-web/src
git commit -m "feat(ui): 地址簿按网络登记与分组、取消/改标签；管理台 DEACTIVATED 筛选、Unsuspend、Skip Cooling 入 ⚡ 区（波一 T9）"
```

**本任务过哪几条**：改前端 → 截图 7 张 + `test:client`；S6（新增 `WITHDRAWAL_ADDRESS_UNSUSPEND` 码对应 Task 8 的 catalog 行）；剧本站 5 ④ 三拍在 Task 15 落文。

---

### Task 10: 限额只改不建不删——表收正、退役创建流、待批徽章

**本任务做**：`TransactionLimitRule` 删 `status / cap / approvalCaseId` + 迁移；退役创建流（端点 / workflow / approval 发射器 / 策略 / 四审计码 / DTO / `createPending` 等）；变更流用 `approvalCaseNo` 当"变更中"标志（提单挂、裁决清）；引擎与查询去掉 `status` 过滤；种子去 `cap`；页面去 `cap` / 状态列、加待批徽章；S5 表与审批回链删创建项；单测。**不做**：L1 引擎逻辑、充值下限拦截留痕（波二）。

**Files:**
- Modify: `prisma/schema.prisma`（`model TransactionLimitRule` 第 1361–1383 行）
- Create: `prisma/migrations/<ts>_v3w1_transaction_limit_rule_no_lifecycle/migration.sql`
- Modify: `prisma/seed.business.ts`（`seedTransactionLimitRules` 第 442–500 行）
- Modify: `src/modules/asset-treasury/transaction-limits/constants/transaction-limit.constants.ts`、`transaction-limit-rules.service.ts`（+spec）、`transaction-limit-rule-workflow.service.ts`（+spec）、`transaction-limit-rules.controller.ts`、`dto/transaction-limit-rule.dto.ts`、`transaction-limits.module.ts`
- Delete: `transaction-limit-creation-approval.service.ts`
- Modify: `rbac.catalog.ts`（第 461 行路由、桶 `treasury.manage_limits`）、`approval.constants.ts`（`TRANSACTION_LIMIT_CREATION`）、`audit-actions.constant.ts`（四码退役）、`scripts/verify-audit.ts`
- Modify: `admin-web/src/rbac/permissions.ts`（`TRANSACTION_LIMIT_WRITE`）、`pages/TransactionLimitList.tsx`、`pages/TransactionLimitDetail.tsx`、`pages/ApprovalDetailPage.tsx`

**Interfaces:**
- Produces: `TransactionLimitRulesService.findAll(gateType?) / findByNo / getSingleRule / getCumulativeRules / getLargeApprovalThreshold / validateShape / attachApprovalCase(ruleNo, approvalCaseNo) / clearApprovalCase(ruleNo) / applyAmountChange`；`GATE_SHAPES.CUMULATIVE.amountFields === ['defaultLimit']`；`ChangeTransactionLimitRuleDto { minAmount?; maxAmount?; defaultLimit?; threshold?; reason }`。

- [ ] **Step 1: 逐键 grep**

```bash
for k in initiateCreate onCreationDecided CREATION_DECIDED_EVENT TransactionLimitCreationApprovalService CreateTransactionLimitRuleDto createPending deletePending assertUnique TRANSACTION_LIMIT_CREATION "cap:" "\.cap\b" "status: 'ACTIVE'" approvalCaseId; do echo "== $k"; git grep -n "$k" -- src/modules/asset-treasury/transaction-limits prisma/seed.business.ts admin-web/src/pages/TransactionLimit* admin-web/src/rbac scripts/verify-rbac.ts | grep -v "\.md:"; done
```

- [ ] **Step 2: 写失败的单测**

`transaction-limit-rules.service.spec.ts`：删 "rejects an alien amount field (SINGLE with cap set)"、"rejects a CUMULATIVE row with only cap set"、`assertUnique` 两条；`getSingleRule` / `getCumulativeRules` 用例的 `where` 断言去掉 `status: 'ACTIVE'`；新增：

```ts
  it('attachApprovalCase / clearApprovalCase 只动 approvalCaseNo（规则无生命周期）', async () => {
    prisma.transactionLimitRule.update.mockResolvedValue({});
    await service.attachApprovalCase('TLR1', 'APR-1');
    expect(prisma.transactionLimitRule.update).toHaveBeenLastCalledWith({ where: { ruleNo: 'TLR1' }, data: { approvalCaseNo: 'APR-1' } });
    await service.clearApprovalCase('TLR1');
    expect(prisma.transactionLimitRule.update).toHaveBeenLastCalledWith({ where: { ruleNo: 'TLR1' }, data: { approvalCaseNo: null } });
  });
```
`transaction-limit-rule-workflow.service.spec.ts`：删三条创建用例（第 75–131 行）；"initiateChange rejects when a pending change approval already exists" 改为规则行 `approvalCaseNo: 'APR-OPEN'` 时 409（不再查 `approvalsService.list`）；新增 "initiateChange 成功后 attachApprovalCase(ruleNo, approvalNo)" 与 "APPROVED change → applyAmountChange 后 clearApprovalCase"、"DECLINED change → clearApprovalCase + CANCELLED 审计"。

Run: `npx jest src/modules/asset-treasury/transaction-limits --no-coverage` → FAIL。

- [ ] **Step 3: schema + 迁移 + 种子**

`model TransactionLimitRule`：删 `cap`、`status`、`approvalCaseId` 三行；`@@index([gateType, status])` → `@@index([gateType])`；`approvalCaseNo` 注释改 `// 待批变更单号；非空即"变更中"`。

```bash
export DATABASE_URL="$(source scripts/db-env.sh && read_database_url "$PWD" self)"
npx prisma migrate dev --create-only --name v3w1_transaction_limit_rule_no_lifecycle && npx prisma generate
```

`seed.business.ts#seedTransactionLimitRules`：`cum` 数组去掉第五列（`['BASIC', 'WITHDRAWAL', 'DAILY', '50000']` …），解构改 `const [tier, op, period, defaultLimit] of cum`，push 时删 `cap`；下方手工 upsert 的 `data` 对象删 `cap` / `status` 键（`git grep -n "status\|cap" prisma/seed.business.ts` 逐处核）。

- [ ] **Step 4: 常量与服务**

`constants/transaction-limit.constants.ts`：`GATE_SHAPES.CUMULATIVE.amountFields` 改 `['defaultLimit']`；`ALL_AMOUNT_FIELDS` 去 `'cap'`。

`transaction-limit-rules.service.ts`：
- `RuleShapeInput` 删 `cap`；`validateShape` 删与 `cap` 有关的分支和注释（第 42–43 行）。
- 删 `assertUnique`、`createPending`、`activate`、`deletePending`。
- `getSingleRule` / `getCumulativeRules` / `getLargeApprovalThreshold` / `findAll` 的 `where` 删 `status: 'ACTIVE'`。
- `attachApprovalCase(ruleNo: string, approvalCaseNo: string)` → `update({ where: { ruleNo }, data: { approvalCaseNo } })`；新增 `clearApprovalCase(ruleNo)` → `data: { approvalCaseNo: null }`。
- `applyAmountChange` 里若有 `cap` 字段处理一并删。

- [ ] **Step 5: 工作流只剩变更流**

`transaction-limit-rule-workflow.service.ts`：
- 删 `CREATION_DECIDED_EVENT`、`CreateRuleInput`、`ChangeRuleInput.cap`、`generateReferenceNo` import、整段 `// ── 创建流 ──`（`initiateCreate` + `onCreationDecided`，第 86–236 行）。
- `initiateChange`：删 `if (rule.status !== 'ACTIVE') …`；第 246–257 行"早拒"改为 `if (rule.approvalCaseNo) { throw new ConflictException(\`Rule ${ruleNo} already has a pending change approval (${rule.approvalCaseNo}); resolve it before submitting another.\`); }`；`createAndSubmit` 之后加 `await this.rulesService.attachApprovalCase(rule.ruleNo, approvalCase.approvalNo);`。
- `onChangeDecided`：APPROVED 分支 `applyAmountChange` 之后与 `CHANGE_APPLY_FAILED` 两处、以及否决分支的审计之后，都加 `await this.rulesService.clearApprovalCase(rule.ruleNo);`（三处；冲突守卫跳过的那条也清——单子已裁决）。

`transaction-limit-rules.controller.ts`：删 `create` 端点与 `CreateTransactionLimitRuleDto` import。
`dto/transaction-limit-rule.dto.ts`：删 `CreateTransactionLimitRuleDto` 整类与 `ChangeTransactionLimitRuleDto.cap`；`GATE_TYPES / LIMIT_OPERATION_TYPES` import 若因此无引用一并删。
`transaction-limits.module.ts`：删 `TransactionLimitCreationApprovalService` 的 import 与 provider。
```bash
git rm src/modules/asset-treasury/transaction-limits/transaction-limit-creation-approval.service.ts
```

- [ ] **Step 6: 策略、审计、RBAC、前端权限码**

`approval.constants.ts`：删 `TRANSACTION_LIMIT_CREATION` 类型、策略段（第 259–266 行）、白名单项；`AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION` grep 零引用即删。
`audit-actions.constant.ts`：`V1_AUDIT_ACTIONS` 删 `TRANSACTION_LIMIT_CREATION_REQUESTED / _APPLIED / _APPLY_FAILED / _CANCELLED` 四行；`DEPRECATED_AUDIT_ACTIONS` 追加：

```ts
  // 2026-09-04 波一（V3 治愈）：限额只改不建不删——创建流整条退役，四码登退役闸
  'TRANSACTION_LIMIT_CREATION_REQUESTED', 'TRANSACTION_LIMIT_CREATION_APPLIED',
  'TRANSACTION_LIMIT_CREATION_APPLY_FAILED', 'TRANSACTION_LIMIT_CREATION_CANCELLED',
```
`scripts/verify-audit.ts` 不变量③名单追加同四码。
`rbac.catalog.ts`：删 `route('POST', '/admin/transaction-limit-rules', …)` 一行；桶 `treasury.manage_limits` 描述改 `'Submit transaction limit change requests — senior management signs them off'`。
`admin-web/src/rbac/permissions.ts`：`TRANSACTION_LIMIT_WRITE: 'api.post.admin_transaction_limit_rules'` → `'api.post.admin_transaction_limit_rules_ruleno_change'`（S6：旧码在 catalog 里已不存在）。

- [ ] **Step 7: 页面**

`TransactionLimitList.tsx`：类型删 `cap` / `status`；第 255 行状态徽章列删（表头同步）。
`TransactionLimitDetail.tsx`：类型删 `cap` / `status`，`AmountKey` 删 `'cap'`；第 147 行 `/assets/${data.assetId}` 改为拉 `/assets?take=200` 后按 `id` 匹配取 `code`；第 323 行 `<AdminBadge value={rule.status} />` 改为 `rule.approvalCaseNo ? <AdminBadge value="PENDING_APPROVAL" /> : <AdminBadge value="IN_EFFECT" />`，并在其旁加审批单号链接：

```tsx
              {rule.approvalCaseNo && (
                <button
                  onClick={() => navigate(`/admin/governance/approvals/${rule.approvalCaseNo}`)}
                  className="ml-2 font-mono text-[11px] text-adm-amber hover:underline"
                >
                  {rule.approvalCaseNo}
                </button>
              )}
```

第 368 行 `rule.status === 'ACTIVE' && (` → `!rule.approvalCaseNo && (`；有待批时显示 `Waiting for SENIOR_MANAGEMENT_OFFICER decision on {rule.approvalCaseNo}`。
`ApprovalDetailPage.tsx`：删 `TRANSACTION_LIMIT_CREATION` 映射行。

- [ ] **Step 8: 闸门 + 截图**

```bash
npx tsc --noEmit -p tsconfig.json && cd admin-web && npx tsc -b --noEmit && cd ..
npx jest src/modules/asset-treasury/transaction-limits src/modules/audit-logging/constants --no-coverage
bash scripts/stack.sh down self && bash scripts/stack.sh reset self && bash scripts/stack.sh up self
sqlite3 "$(source scripts/db-env.sh && read_database_url "$PWD" self | sed 's#^file:##')" "select count(*) from transaction_limit_rules;"
```
Expected: 全绿；`15`。截图：`ops_officer@` → Transaction Limits → 一条单笔规则 → Change Amounts 提交 → 详情待批徽章 + 单号 → 截图 ①；`sm@` 批准 → 徽章消失、金额变 → 截图 ②。

- [ ] **Step 9: Commit**

```bash
git add prisma src/modules/asset-treasury/transaction-limits src/modules/identity/access-control/rbac.catalog.ts src/modules/governance/approvals/constants/approval.constants.ts src/modules/audit-logging/constants/audit-actions.constant.ts scripts/verify-audit.ts admin-web/src
git commit -m "feat(v3): 限额只改不建不删——表去生命周期，退役创建流，approvalCaseNo 当变更中标志（波一 T10）"
```

**本任务过哪几条**：改 schema / seed → 重铺；改 RBAC / 策略 → sync + 重启（reset 已含）；审计四码退役 + `verify:audit` 名单；改前端 → 截图 2 张 + S6 码值更新；S5 表在 Task 13 统一改。

---

### Task 11: 费率两族后端——状态集迁移表、创建被拒不删行、变更单号与主对象、退役等级动作、VIP 种子

**本任务做**：两族共用一张迁移表常量（等级四边 + 变更单四边）；`enabled` / `failureReason` / `requestNo` 默认值三列收正 + 迁移；创建被拒 → `REJECTED`、取消 / 超时 → `CANCELLED`（不再物理删行）；变更单号走 `generateReferenceNo('SFC' | 'WFC')`，审计主对象一律 `levelCode`、变更单号进子表 `INSTRUMENT`，`EXPIRED` 单独终态，`FAILED` 与 `markRequestExecutionFailed` 退役；新增退役等级动作（端点 / workflow / approval 发射器 / 两条策略 / 六枚审计码 / 最后默认档守卫）；详情接口带 `pendingChangeRequest`；种子加 `VIP-USDT-AED`；单测。**不做**：报价服务与端点（交易域）；页面（Task 12）。

> 两族同构：下面全部以 swap 写出；withdrawal 逐一镜像（`Swap` → `Withdrawal`、`swapFeeLevel` → `withdrawalFeeLevel`、`SFC` → `WFC`、币对 `(fromAssetId, toAssetId)` → 单资产 `assetId`），唯一保留的差异是 `validateTiersJson`（withdrawal 至少一个 feeItem、swap 允许纯点差档），不动。

**Files:**
- Create: `src/modules/trading/shared/fee-level-transitions.constant.ts`（+spec）
- Modify: `prisma/schema.prisma`（四个模型第 1386–1489 行）
- Create: `prisma/migrations/<ts>_v3w1_fee_level_status_set/migration.sql`
- Modify: `prisma/seed.business.ts`（`seedSwapFeeLevels` 第 245–349 行、`seedWithdrawalFeeLevels` 第 351–440 行）
- Modify: `src/modules/trading/swap-fee-level/swap-fee-level.service.ts`（+spec）、`swap-fee-level-creation-workflow.service.ts`、`swap-fee-level-change-workflow.service.ts`、`swap-fee-level.controller.ts`、`swap-fee-level.module.ts`
- Create: `src/modules/trading/swap-fee-level/swap-fee-level-retire-workflow.service.ts`、`swap-fee-level-retire-approval.service.ts`、`dto/retire-swap-fee-level.dto.ts`
- Same for `src/modules/trading/withdrawal-fee-level/*`
- Modify: `approval.constants.ts`（两条策略）、`audit-actions.constant.ts`（六码 + 两个 workflowType）、`rbac.catalog.ts`（两条路由 + 桶描述）

**Interfaces:**
- Produces: `FeeLevelAction { APPROVE, DECLINE, CANCEL, RETIRE }`、`assertFeeLevelTransition(from, action)`；`FeeChangeRequestAction { APPROVE, DECLINE, CANCEL, EXPIRE }`、`assertFeeChangeRequestTransition(from, action)`；`SwapFeeLevelService.activateLevel / declineLevel / cancelLevel / retireLevel / assertNotLastActiveDefault(level) / clearApprovalCase / expireChangeRequest`（删 `deleteRejectedLevel / generateNextRequestNo / markRequestExecutionFailed`）；`findByLevelCode` 返回增 `pendingChangeRequest: { requestNo; approvalCaseNo } | null`；`POST /admin/swap-fee-levels/:levelCode/retire { reason }`（withdrawal 同）；策略 `SWAP_FEE_LEVEL_RETIRE` / `WITHDRAWAL_FEE_LEVEL_RETIRE`；审计码 `SWAP_FEE_LEVEL_RETIRE_REQUESTED / SWAP_FEE_LEVEL_RETIRED / SWAP_FEE_LEVEL_RETIRE_CANCELLED`（withdrawal 同）。

- [ ] **Step 1: 逐键 grep**

```bash
for k in deleteRejectedLevel generateNextRequestNo markRequestExecutionFailed "status: 'FAILED'" failureReason "enabled: true" SFLC- WFLC- findActiveByPair findActiveByAsset; do echo "== $k"; git grep -n "$k" -- src/modules/trading prisma scripts admin-web/src | grep -v "\.md:"; done
```

- [ ] **Step 2: 写失败的单测**

`src/modules/trading/shared/fee-level-transitions.constant.spec.ts`：

```ts
import { assertFeeLevelTransition, FeeLevelAction, assertFeeChangeRequestTransition, FeeChangeRequestAction, FEE_LEVEL_TRANSITIONS } from './fee-level-transitions.constant';

describe('费率等级 / 变更单迁移表（两族共用，spec §7）', () => {
  it('等级四边', () => {
    expect(assertFeeLevelTransition('PENDING_APPROVAL', FeeLevelAction.APPROVE)).toBe('ACTIVE');
    expect(assertFeeLevelTransition('PENDING_APPROVAL', FeeLevelAction.DECLINE)).toBe('REJECTED');
    expect(assertFeeLevelTransition('PENDING_APPROVAL', FeeLevelAction.CANCEL)).toBe('CANCELLED');
    expect(assertFeeLevelTransition('ACTIVE', FeeLevelAction.RETIRE)).toBe('RETIRED');
  });
  it('REJECTED / CANCELLED / RETIRED 终态；FAILED 不是状态', () => {
    expect(FEE_LEVEL_TRANSITIONS.REJECTED).toEqual({});
    expect(FEE_LEVEL_TRANSITIONS.RETIRED).toEqual({});
    expect((FEE_LEVEL_TRANSITIONS as any).FAILED).toBeUndefined();
    expect(() => assertFeeLevelTransition('RETIRED', FeeLevelAction.RETIRE)).toThrow(/Invalid transition/);
    expect(() => assertFeeLevelTransition('PENDING_APPROVAL', FeeLevelAction.RETIRE)).toThrow(/Invalid transition/);
  });
  it('变更单四边，EXPIRED 单独终态', () => {
    expect(assertFeeChangeRequestTransition('PENDING_APPROVAL', FeeChangeRequestAction.APPROVE)).toBe('APPROVED');
    expect(assertFeeChangeRequestTransition('PENDING_APPROVAL', FeeChangeRequestAction.DECLINE)).toBe('REJECTED');
    expect(assertFeeChangeRequestTransition('PENDING_APPROVAL', FeeChangeRequestAction.CANCEL)).toBe('CANCELLED');
    expect(assertFeeChangeRequestTransition('PENDING_APPROVAL', FeeChangeRequestAction.EXPIRE)).toBe('EXPIRED');
    expect(() => assertFeeChangeRequestTransition('APPROVED', FeeChangeRequestAction.CANCEL)).toThrow(/Invalid transition/);
  });
});
```

`swap-fee-level.service.spec.ts` 新增 describe（prisma mock 需补 `swapFeeLevel.findUnique / update / count`、`swapFeeLevelChangeRequest.findFirst / create / update`）：

```ts
  describe('波一 · 状态集与退役', () => {
    it('declineLevel：PENDING_APPROVAL → REJECTED，行不删', async () => {
      prisma.swapFeeLevel.findUnique.mockResolvedValue({ levelCode: 'L1', status: 'PENDING_APPROVAL' });
      await service.declineLevel('L1');
      expect(prisma.swapFeeLevel.update).toHaveBeenCalledWith({ where: { levelCode: 'L1' }, data: { status: 'REJECTED', approvalCaseId: null, approvalCaseNo: null } });
      expect(prisma.swapFeeLevel.delete).not.toHaveBeenCalled();
    });
    it('retireLevel：ACTIVE → RETIRED；PENDING 不能退 → 409', async () => {
      prisma.swapFeeLevel.findUnique.mockResolvedValue({ levelCode: 'L1', status: 'ACTIVE' });
      await service.retireLevel('L1');
      expect(prisma.swapFeeLevel.update).toHaveBeenCalledWith({ where: { levelCode: 'L1' }, data: { status: 'RETIRED', approvalCaseId: null, approvalCaseNo: null } });
      prisma.swapFeeLevel.findUnique.mockResolvedValue({ levelCode: 'L2', status: 'PENDING_APPROVAL' });
      await expect(service.retireLevel('L2')).rejects.toBeInstanceOf(ConflictException);
    });
    it('assertNotLastActiveDefault：该币对最后一个 ACTIVE 默认档不可退', async () => {
      prisma.swapFeeLevel.count.mockResolvedValue(0);
      await expect(service.assertNotLastActiveDefault({ id: 'x', levelCode: 'STD', isDefault: true, fromAssetId: 'a', toAssetId: 'b' } as any))
        .rejects.toMatchObject({ response: { code: 'LAST_ACTIVE_DEFAULT' } });
      expect(prisma.swapFeeLevel.count).toHaveBeenCalledWith({ where: { fromAssetId: 'a', toAssetId: 'b', isDefault: true, status: 'ACTIVE', id: { not: 'x' } } });
    });
    it('变更单号走 SFC 前缀，不再 SFLC-### 顺序号', async () => {
      prisma.swapFeeLevelChangeRequest.findFirst.mockResolvedValue(null);
      prisma.swapFeeLevel.findUnique.mockResolvedValue({ id: 'l1', tiersJson: '{"tiers":[{"id":"T","name":"T","rateMarkupBps":1}]}', configHash: 'h' });
      prisma.swapFeeLevelChangeRequest.create.mockImplementation(async ({ data }: any) => data);
      const r: any = await service.createChangeRequest({ levelId: 'l1', levelCode: 'L1', proposedTiersJson: '{"tiers":[{"id":"T","name":"T","rateMarkupBps":2}]}', changeReason: 'x', requestedByUserId: 'u' });
      expect(r.requestNo).toMatch(/^SFC\d{12}$/);
    });
    it('expireChangeRequest：PENDING_APPROVAL → EXPIRED', async () => {
      prisma.swapFeeLevelChangeRequest.findUnique.mockResolvedValue({ requestNo: 'R1', status: 'PENDING_APPROVAL' });
      await service.expireChangeRequest('R1');
      expect(prisma.swapFeeLevelChangeRequest.update).toHaveBeenCalledWith({ where: { requestNo: 'R1' }, data: { status: 'EXPIRED' } });
    });
  });
```
（withdrawal 同款用例，前缀 `WFC`、守卫按 `assetId`。）

Run: `npx jest src/modules/trading/shared src/modules/trading/swap-fee-level src/modules/trading/withdrawal-fee-level --no-coverage` → FAIL。

- [ ] **Step 3: 迁移表常量**

`src/modules/trading/shared/fee-level-transitions.constant.ts`：

```ts
import { ConflictException } from '@nestjs/common';

export enum FeeLevelAction {
  APPROVE = 'APPROVE',
  DECLINE = 'DECLINE',
  CANCEL = 'CANCEL',   // 审批取消 / 超时都走这条边（CANCELLED）
  RETIRE = 'RETIRE',
}

/** 费率等级状态迁移表（两族共用，spec §7）。创建被拒不再物理删行；"删" = 退役终态。
 *  落地失败是故障路径：只留 *_APPLY_FAILED 审计，行停在 PENDING_APPROVAL，没有 FAILED 状态。 */
export const FEE_LEVEL_TRANSITIONS: Record<string, Partial<Record<FeeLevelAction, string>>> = {
  PENDING_APPROVAL: { [FeeLevelAction.APPROVE]: 'ACTIVE', [FeeLevelAction.DECLINE]: 'REJECTED', [FeeLevelAction.CANCEL]: 'CANCELLED' },
  ACTIVE:           { [FeeLevelAction.RETIRE]: 'RETIRED' },
  REJECTED:         {},
  CANCELLED:        {},
  RETIRED:          {},
};

export function assertFeeLevelTransition(from: string, action: FeeLevelAction): string {
  const to = FEE_LEVEL_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: fee level in ${from} cannot ${action}`);
  return to;
}

export enum FeeChangeRequestAction {
  APPROVE = 'APPROVE',
  DECLINE = 'DECLINE',
  CANCEL = 'CANCEL',
  EXPIRE = 'EXPIRE',
}

/** 变更请求单：四个终态各自分明（EXPIRED 单独一格，第七幕按单号查得到"时间到了没人批"） */
export const FEE_CHANGE_REQUEST_TRANSITIONS: Record<string, Partial<Record<FeeChangeRequestAction, string>>> = {
  PENDING_APPROVAL: {
    [FeeChangeRequestAction.APPROVE]: 'APPROVED',
    [FeeChangeRequestAction.DECLINE]: 'REJECTED',
    [FeeChangeRequestAction.CANCEL]: 'CANCELLED',
    [FeeChangeRequestAction.EXPIRE]: 'EXPIRED',
  },
  APPROVED: {},
  REJECTED: {},
  CANCELLED: {},
  EXPIRED: {},
};

export function assertFeeChangeRequestTransition(from: string, action: FeeChangeRequestAction): string {
  const to = FEE_CHANGE_REQUEST_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: fee level change request in ${from} cannot ${action}`);
  return to;
}
```

- [ ] **Step 4: schema + 迁移 + 种子**

四个模型：`SwapFeeLevel` / `WithdrawalFeeLevel` 删 `enabled Boolean @default(true)`，索引改 `@@index([fromAssetId, toAssetId, status])` / `@@index([assetId, status])`；`SwapFeeLevelChangeRequest` / `WithdrawalFeeLevelChangeRequest` 的 `requestNo String @unique @default("TEMP")` → `requestNo String @unique`，删 `failureReason String?`。

```bash
export DATABASE_URL="$(source scripts/db-env.sh && read_database_url "$PWD" self)"
npx prisma migrate dev --create-only --name v3w1_fee_level_status_set && npx prisma generate
```

`seed.business.ts`：两处 `enabled: true,`（第 311、339、394、429 行——**只删 `upsert.create` 里的列级 `enabled`**；tiers 里每档的 `enabled: true` 是 `SwapTier` 类型的档级字段，保留）。`seedSwapFeeLevels` 的 `pairs` 之后加 VIP 档：在 `for (const pair of pairs)` 循环之后追加：

```ts
  // 受众档：VIP 标签命中，各档比 STD 便宜（站 2：Grace 命中它、Alice 命中默认档）
  const vipTiers = [
    { amountMin: '0',     amountMax: '500',   rateMarkupBps: 60, flatFee: '20' },
    { amountMin: '500',   amountMax: '2000',  rateMarkupBps: 40, flatFee: '12' },
    { amountMin: '2000',  amountMax: '10000', rateMarkupBps: 25, flatFee: '8' },
    { amountMin: '10000', amountMax: null,    rateMarkupBps: 10, flatFee: '5' },
  ].map((t, i) => {
    const tierIdx = String(i + 1).padStart(3, '0');
    return {
      id: `VIP-USDT-AED-TIER-${tierIdx}`,
      name: `VIP Tier ${i + 1} (${t.amountMin}${t.amountMax ? '-' + t.amountMax : '+'})`,
      enabled: true,
      rateMarkupBps: t.rateMarkupBps,
      conditions: { amountMin: t.amountMin, amountMax: t.amountMax },
      feeItems: [{ id: `VIP-USDT-AED-TIER-${tierIdx}-FEE-001`, itemCode: 'SWAP_SERVICE_FEE', calcType: 'FLAT', value: t.flatFee, min: null, max: null, roundingMode: 'ROUND' }],
    };
  });
  const vipTiersJson = JSON.stringify({ tiers: vipTiers });
  await prisma.swapFeeLevel.upsert({
    where: { levelCode: 'VIP-USDT-AED' },
    update: { tiersJson: vipTiersJson, configHash: createHash('sha256').update(vipTiersJson).digest('hex'), status: 'ACTIVE' },
    create: {
      levelCode: 'VIP-USDT-AED',
      name: 'VIP USDT → AED',
      fromAssetId: usdt.id,
      toAssetId: aed.id,
      isDefault: false,
      requiredTagsJson: JSON.stringify(['VIP']),
      tiersJson: vipTiersJson,
      configHash: createHash('sha256').update(vipTiersJson).digest('hex'),
      status: 'ACTIVE',
      createdByUserId: 'SYSTEM',
    },
  });
  console.log('Seeded VIP-USDT-AED audience level.');
```
（`'VIP'` 须是 `customer-tag.constant.ts` 注册的标签码——`git grep -n "'VIP'" src/modules/identity/customer-tags` 核实；不是的话用注册表里的 VIP 码。）

- [ ] **Step 5: 服务（swap；withdrawal 镜像）**

`swap-fee-level.service.ts`：
- import `assertFeeLevelTransition, FeeLevelAction, assertFeeChangeRequestTransition, FeeChangeRequestAction` 自 `'../shared/fee-level-transitions.constant'`；`generateReferenceNo` 自 `'../../../common/utils/no-generator.util'`。
- `findByLevelCode`：include 加 `changeRequests: { where: { status: 'PENDING_APPROVAL' }, take: 1, select: { requestNo: true, approvalCaseNo: true } }`，返回前 `const { changeRequests, ...rest } = level; return { ...rest, pendingChangeRequest: changeRequests[0] ?? null };`。
- `findActiveByPair`：`where: { fromAssetId, toAssetId, status: 'ACTIVE' }`。
- `createLevel`：`data` 删 `enabled`（无此键即可）。
- `activateLevel`：`const to = assertFeeLevelTransition(level.status, FeeLevelAction.APPROVE); await db.swapFeeLevel.update({ where: { levelCode }, data: { status: to, approvalCaseId: null, approvalCaseNo: null } });`
- 删 `deleteRejectedLevel`；加：

```ts
  async declineLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveLevel(levelCode, FeeLevelAction.DECLINE, tx);
  }

  async cancelLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveLevel(levelCode, FeeLevelAction.CANCEL, tx);
  }

  async retireLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveLevel(levelCode, FeeLevelAction.RETIRE, tx);
  }

  private async moveLevel(levelCode: string, action: FeeLevelAction, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const level = await db.swapFeeLevel.findUnique({ where: { levelCode } });
    if (!level) throw new NotFoundException(`Level ${levelCode} not found`);
    const to = assertFeeLevelTransition(level.status, action);
    await db.swapFeeLevel.update({ where: { levelCode }, data: { status: to, approvalCaseId: null, approvalCaseNo: null } });
  }

  async clearApprovalCase(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.swapFeeLevel.update({ where: { levelCode }, data: { approvalCaseId: null, approvalCaseNo: null } });
  }

  /** 退役守卫：该币对最后一个 ACTIVE 默认档不可退——报价会没有兜底档 */
  async assertNotLastActiveDefault(level: { id: string; levelCode: string; isDefault: boolean; fromAssetId: string; toAssetId: string }): Promise<void> {
    if (!level.isDefault) return;
    const others = await this.prisma.swapFeeLevel.count({
      where: { fromAssetId: level.fromAssetId, toAssetId: level.toAssetId, isDefault: true, status: 'ACTIVE', id: { not: level.id } },
    });
    if (others === 0) {
      throw new ConflictException({ code: 'LAST_ACTIVE_DEFAULT', message: `${level.levelCode} is the last active default level for this pair and cannot be retired` });
    }
  }
```
（withdrawal 版本守卫按 `{ assetId: level.assetId, isDefault: true, status: 'ACTIVE', id: { not: level.id } }`。）
- 删 `generateNextRequestNo`；`createChangeRequest` 循环里 `const requestNo = generateReferenceNo('SFC');`（withdrawal：`'WFC'`）。
- `executeChange`：`request.status !== 'PENDING_APPROVAL'` 判断改 `const to = assertFeeChangeRequestTransition(request.status, FeeChangeRequestAction.APPROVE);`，最后 `data: { status: to, executedAt: new Date() }`。
- `rejectChangeRequest` / `cancelChangeRequest` 改走表（`DECLINE` / `CANCEL`）；新增 `expireChangeRequest(requestNo)`（`EXPIRE`）；删 `markRequestExecutionFailed`。

- [ ] **Step 6: 创建与变更工作流（swap；withdrawal 镜像）**

`swap-fee-level-creation-workflow.service.ts#executeCancellation`：`await this.feeLevelService.deleteRejectedLevel(level.levelCode);` 改为

```ts
      if (decision === 'DECLINED') await this.feeLevelService.declineLevel(level.levelCode);
      else await this.feeLevelService.cancelLevel(level.levelCode);
```
日志 `creation cancelled (${decision}), row deleted` → `row marked ${decision === 'DECLINED' ? 'REJECTED' : 'CANCELLED'}`。

`swap-fee-level-change-workflow.service.ts`：
- `requestChange`：`level.status !== 'ACTIVE'` 判断之后加 `if (level.approvalCaseNo) throw new ConflictException(\`Level ${levelCode} has a pending approval (${level.approvalCaseNo})\`);`（退役单待批时不许再提变更）。
- 四处审计（`CHANGE_REQUESTED` / `CHANGE_APPLIED` / 两处 `CHANGE_APPLY_FAILED` / `CHANGE_CANCELLED`）：`primarySubjectNo: request.levelCode`（`requestChange` 里用 `level.levelCode`），并加

```ts
        subjects: [
          { subjectType: AuditEntityTypes.SWAP_FEE_LEVEL, subjectNo: request.levelCode, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: request.requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
        ],
```
  （import `AuditSubjectRole` 自 `'../../audit-logging/dto/audit-log.dto'`；`requestId` 串保持带 `requestNo`，去重钥匙不变。）
- `executeChange`：两处 `markRequestExecutionFailed` 调用删掉（行停在 PENDING_APPROVAL，只留 `*_APPLY_FAILED` 审计）。
- `cancelChange`：

```ts
      if (decision === 'DECLINED') await this.feeLevelService.rejectChangeRequest(request.requestNo);
      else if (decision === 'EXPIRED') await this.feeLevelService.expireChangeRequest(request.requestNo);
      else await this.feeLevelService.cancelChangeRequest(request.requestNo);
```

- [ ] **Step 7: 退役工作流 + 发射器 + DTO + 端点（swap；withdrawal 镜像）**

`dto/retire-swap-fee-level.dto.ts`：

```ts
import { IsNotEmpty, IsString } from 'class-validator';

export class RetireSwapFeeLevelDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
```

`swap-fee-level-retire-approval.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class SwapFeeLevelRetireApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.SWAP_FEE_LEVEL_RETIRE;
  readonly workflowType = AuditBusinessWorkflowTypes.SWAP_FEE_LEVEL_RETIRE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
```

`swap-fee-level-retire-workflow.service.ts`：

```ts
import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { assertFeeLevelTransition, FeeLevelAction } from '../shared/fee-level-transitions.constant';

// 二级"已裁决"事件名由 approval-handler.base.ts 按 workflowType 推导：workflow.<kebab>.decided
const SECONDARY_EVENT = 'workflow.swap-fee-level-retire.decided';

/** "删" = 退役终态（spec §7）：CFO 提、运营批；最后一个 ACTIVE 默认档不可退。 */
@Injectable()
export class SwapFeeLevelRetireWorkflowService {
  private readonly logger = new Logger(SwapFeeLevelRetireWorkflowService.name);

  constructor(
    private readonly feeLevelService: SwapFeeLevelService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',
      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  async requestRetire(levelCode: string, reason: string, actor: ApprovalActorContext) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    const level = await this.feeLevelService.findByLevelCode(levelCode);
    assertFeeLevelTransition(level.status, FeeLevelAction.RETIRE);
    if (level.approvalCaseNo || level.pendingChangeRequest) {
      throw new ConflictException(`Level ${levelCode} already has a pending approval (${level.approvalCaseNo ?? level.pendingChangeRequest?.approvalCaseNo})`);
    }
    await this.feeLevelService.assertNotLastActiveDefault(level);

    // START：本次退役旅程的 correlationId，同一个值写进 ApprovalCase.traceId，下游经 ApprovalDecidedEvent.traceId INHERIT 读回
    const correlationId = randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.SWAP_FEE_LEVEL_RETIRE,
        entityRef: levelCode,
        traceId: correlationId,
        objectSnapshot: { levelCode, name: level.name, isDefault: level.isDefault, fromAssetId: level.fromAssetId, toAssetId: level.toAssetId, reason },
      },
      { reason, traceId: correlationId },
      actor,
    );
    await this.feeLevelService.linkApprovalCase(levelCode, approvalCase.id, approvalCase.approvalNo);

    await this.auditLogsService.recordByActor(
      {
        action: 'SWAP_FEE_LEVEL_RETIRE_REQUESTED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: levelCode,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        beforeData: { status: level.status },
        metadata: { approvalNo: approvalCase.approvalNo },
        requestId: `SWAP_FEE_LEVEL_RETIRE_REQUESTED_${levelCode}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return { levelCode, approvalNo: approvalCase.approvalNo, status: 'PENDING_APPROVAL' };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(event: ApprovalDecidedEvent) {
    if (!event?.entityRef || !event?.approvalId) {
      this.logger.warn('Swap fee level retire decided event missing entityRef/approvalId');
      return;
    }
    if (event.decision === 'APPROVED') await this.executeRetire(event);
    else await this.cancelRetire(event);
  }

  private async executeRetire(event: ApprovalDecidedEvent) {
    const levelCode = event.entityRef;
    try {
      await this.feeLevelService.retireLevel(levelCode);
      await this.auditLogsService.recordSystem({
        action: 'SWAP_FEE_LEVEL_RETIRED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: levelCode,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        approvalNo: event.approvalNo,
        fromStatus: 'ACTIVE',
        toStatus: 'RETIRED',
        metadata: { retiredByUserNo: event.decisionByUserNo },
        requestId: `SWAP_FEE_LEVEL_RETIRED_${levelCode}`,
        sourcePlatform: 'SYSTEM',
      });
      this.logger.log(`Swap fee level ${levelCode} retired`);
    } catch (err: any) {
      // 双结局：失败不单独起名——同码 outcome=FAILED + reasonCode
      await this.auditLogsService.recordSystem({
        action: 'SWAP_FEE_LEVEL_RETIRED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: levelCode,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'EXECUTION_FAILED',
        reason: err?.message ?? 'retire execution failed',
        approvalNo: event.approvalNo,
        requestId: `SWAP_FEE_LEVEL_RETIRED_${levelCode}`,
        sourcePlatform: 'SYSTEM',
      });
      this.logger.error(`Failed to retire swap fee level ${levelCode}: ${err?.message}`);
    }
  }

  private async cancelRetire(event: ApprovalDecidedEvent) {
    const levelCode = event.entityRef;
    try {
      await this.feeLevelService.clearApprovalCase(levelCode);
      await this.auditLogsService.recordSystem({
        action: 'SWAP_FEE_LEVEL_RETIRE_CANCELLED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.SWAP_FEE_LEVEL,
        primarySubjectNo: levelCode,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        reason: event.decisionReason || `Swap fee level retire request ${String(event.decision).toLowerCase()}`,
        metadata: { decision: event.decision, approvalNo: event.approvalNo },
        requestId: `SWAP_FEE_LEVEL_RETIRE_CANCELLED_${levelCode}`,
        sourcePlatform: 'SYSTEM',
      });
    } catch (err: any) {
      this.logger.error(`Failed to cancel retire for ${levelCode}: ${err?.message}`);
    }
  }
}
```

`swap-fee-level.controller.ts` 加：

```ts
  @Post(':levelCode/retire')
  @RequirePermissions(buildPermissionCode('POST', '/admin/swap-fee-levels/:levelCode/retire'))
  async retire(@Param('levelCode') levelCode: string, @Body() dto: RetireSwapFeeLevelDto, @Req() req: any) {
    this.ensureAdmin(req);
    return this.retireWorkflowService.requestRetire(levelCode, dto.reason, this.buildAdminActor(req));
  }
```
（构造器注入 `SwapFeeLevelRetireWorkflowService`；withdrawal 控制器里静态 `quotes` 路由仍须排在 `:levelCode` 之前，把 `retire` 放最后。）
`swap-fee-level.module.ts` providers 加 `SwapFeeLevelRetireApprovalService`、`SwapFeeLevelRetireWorkflowService`。

- [ ] **Step 8: 策略、审计合同、RBAC**

`approval.constants.ts`：`ApprovalActionTypes` 加 `SWAP_FEE_LEVEL_RETIRE: 'SWAP_FEE_LEVEL_RETIRE'`、`WITHDRAWAL_FEE_LEVEL_RETIRE: 'WITHDRAWAL_FEE_LEVEL_RETIRE'`；`DEFAULT_APPROVAL_POLICIES` 加（与创建 / 变更同一对）：

```ts
  [ApprovalActionTypes.SWAP_FEE_LEVEL_RETIRE]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_RETIRE]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
```
`V1_APPROVAL_ACTION_TYPES` 加两项。

`audit-actions.constant.ts`：`AuditBusinessWorkflowTypes` 加 `SWAP_FEE_LEVEL_RETIRE: 'SWAP_FEE_LEVEL_RETIRE'`、`WITHDRAWAL_FEE_LEVEL_RETIRE: 'WITHDRAWAL_FEE_LEVEL_RETIRE'`；`V1_AUDIT_ACTIONS` 在两族 `*_CHANGE_CANCELLED` 后各加：

```ts
  // 波一新增：退役等级（"删" = 终态）。REQUESTED 铸 correlationId（S）；RETIRED / RETIRE_CANCELLED 经审批决定事件 INHERIT + causationId。
  SWAP_FEE_LEVEL_RETIRE_REQUESTED:       { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  SWAP_FEE_LEVEL_RETIRED:                { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  SWAP_FEE_LEVEL_RETIRE_CANCELLED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
```
（withdrawal 三码同型。）

`rbac.catalog.ts`：两族路由块各加

```ts
  route('POST', '/admin/swap-fee-levels/:levelCode/retire', 'Submit swap fee level retirement request', [
    'SWAP_FEE_LEVEL_WRITE',
  ]),
```
（withdrawal 同）；桶 `pricing.manage` 描述改 `'Raise fee level creation, change and retirement requests — operations signs them off'`。

- [ ] **Step 9: 闸门**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/trading/shared src/modules/trading/swap-fee-level src/modules/trading/withdrawal-fee-level src/modules/audit-logging/constants --no-coverage
bash scripts/stack.sh down self && bash scripts/stack.sh reset self && bash scripts/stack.sh up self
sqlite3 "$(source scripts/db-env.sh && read_database_url "$PWD" self | sed 's#^file:##')" "select levelCode, isDefault, requiredTagsJson, status from swap_fee_levels;"
bash scripts/on-stack.sh self demo:all
```
Expected: 全绿；三行 `STD-USDT-AED / STD-AED-USDT / VIP-USDT-AED`（VIP `["VIP"]`, `ACTIVE`）；`demo:all` 花名册全 ✓（Grace 的兑换单现在命中 VIP 档——费用变小是预期，花名册断言的是终态不是金额）。

- [ ] **Step 10: Commit**

```bash
git add prisma src/modules/trading src/modules/identity/access-control/rbac.catalog.ts src/modules/governance/approvals/constants/approval.constants.ts src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(v3): 费率两族状态集迁移表、创建被拒不删行、变更单 SFC/WFC + 主对象 levelCode、退役等级动作、VIP 受众种子（波一 T11）"
```

**本任务过哪几条**：改 schema / seed → 重铺 + `demo:all`；新端点 ×2 → catalog + 策略 + 四属性审计码 ×6 + 封册；状态机 → 迁移表 + 单测；S5 表在 Task 13 加两行；改了报价命中（VIP）→ 站 2 剧本 Task 15。

---

### Task 12: 费率前端——状态筛选五值、受众 / 窗口英文、Retire 按钮、待批徽章（创建 / 变更 / 退役）

**本任务做**：两族列表状态筛选 `PENDING_APPROVAL / ACTIVE / REJECTED / CANCELLED / RETIRED`；详情侧栏 Audience / Valid Window 改英文；Actions 加 `Retire Level`（CFO 可见，理由弹窗）；有待批创建 / 变更 / 退役单时显示待批徽章 + 审批单号；审批回链补两条退役策略；前端权限码加两枚；截图。**不做**：后端。

**Files:**
- Modify: `admin-web/src/pages/SwapFeeLevelList.tsx`（第 92 行）、`WithdrawalFeeLevelList.tsx`（第 78 行）
- Modify: `admin-web/src/pages/SwapFeeLevelDetail.tsx`（第 27–29 行类型、第 247–267 行受众、第 455–475 行动作、第 485–510 行侧栏）、`WithdrawalFeeLevelDetail.tsx`（同位置镜像）
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx`（定价域映射）、`admin-web/src/rbac/permissions.ts`

- [ ] **Step 1: 列表**

两份 List：`const STATUS_OPTIONS = ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'CANCELLED', 'RETIRED'];`

- [ ] **Step 2: 详情（swap；withdrawal 镜像）**

- 类型加 `pendingChangeRequest: { requestNo: string; approvalCaseNo: string | null } | null;`。
- 受众：`'全体客户（everyone）'` → `'Everyone'`；窗口：`` `Valid ${fmt(level.validFrom)} ~ ${fmt(level.validTo)}` `` / `'No expiry'`。
- 待批徽章：`const pendingApprovalNo = level.approvalCaseNo ?? level.pendingChangeRequest?.approvalCaseNo ?? null;` 状态徽章旁（第 337 行附近）加

```tsx
              {pendingApprovalNo && (
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Pending Approval</div>
                  <button onClick={() => navigate(`/admin/governance/approvals/${pendingApprovalNo}`)} className="mt-1 font-mono text-[11px] text-adm-amber hover:underline">
                    {pendingApprovalNo}
                  </button>
                </div>
              )}
```
- Actions（第 460 行）：条件改 `level.status === 'ACTIVE' && !pendingApprovalNo`；在 Edit Tiers 下加

```tsx
                {canRetire && (
                  <button onClick={() => { setRetireReason(''); setShowRetireModal(true); }} className={adminButtonClass('workflowNegative')}>
                    Retire Level
                  </button>
                )}
                <p className="text-center font-mono text-[10px] text-adm-t3">Edit / Retire requires CFO → Ops Officer approval</p>
```
  `canRetire = hasAnyPermission([PERMISSIONS.SWAP_FEE_LEVEL_RETIRE])`；有待批时显示 `Waiting for Ops Officer decision on {pendingApprovalNo}`。
- Retire 弹窗（照 Change 弹窗骨架）：理由 textarea 必填 → `POST /admin/swap-fee-levels/${levelCode}/retire { reason }` → 成功 `setNotice(\`Retirement submitted for approval (${data.approvalNo}).\`)` 并重新拉详情。
- 侧栏 Approval 行改用 `pendingApprovalNo`。

- [ ] **Step 3: 权限码与审批回链**

`permissions.ts` 加 `SWAP_FEE_LEVEL_RETIRE: 'api.post.admin_swap_fee_levels_levelcode_retire'`、`WITHDRAWAL_FEE_LEVEL_RETIRE: 'api.post.admin_withdrawal_fee_levels_levelcode_retire'`。
`ApprovalDetailPage.tsx` 定价域映射加 `SWAP_FEE_LEVEL_RETIRE: (r) => \`/admin/pricing/swap-fee-levels/${r}\``、`WITHDRAWAL_FEE_LEVEL_RETIRE: (r) => \`/admin/pricing/withdrawal-fee-levels/${r}\``。

- [ ] **Step 4: tsc ② + 截图**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```
截图：`cfo@` → Swap Fee Levels → `VIP-USDT-AED` 详情：Audience `VIP`、`No expiry`、Retire 按钮 → 截图 ①；点 Retire 填理由 → 待批徽章 + 单号 → 截图 ②；`ops_officer@` 审批中心批准 → 列表筛 RETIRED 出现 `VIP-USDT-AED` → 截图 ③；`cfo@` 对 `STD-USDT-AED` 点 Retire → 400/409 `LAST_ACTIVE_DEFAULT` 提示 → 截图 ④；再 `cfo@` 在列表用 Create 建一档 `VIP-USDT-AED-2`（requiredTags VIP，与被退役那档同参数）→ ops 批 → 台账复位（站 2 要 Grace 命中 VIP 档）。

- [ ] **Step 5: Commit**

```bash
git add admin-web/src
git commit -m "feat(admin): 费率页状态五值、受众/窗口英文、Retire 动作、创建/变更/退役待批徽章（波一 T12）"
```

**本任务过哪几条**：改前端 → 截图 4 张；S6（两枚新码对应 Task 11 catalog 行）；页面改了 → 站 2 剧本 Task 15。

---

### Task 13: 治理面收口——verify:rbac 探针 / S5 表 / S8 / S9，db:base:sync + 重启，判据顺序跑一遍

**本任务做**：`verify-rbac.ts` 删打退役端点的 4 条探针、加 6 条新探针；`MAKER_GROUP_BY_POLICY` 按 §8 更新并与策略一一对应（S8：表 ∪ 显式豁免表 = 策略全集，两表不相交）；S9：每条策略的裁决人持有其 entityRef 详情页所需读权限（镜像 `ApprovalDetailPage` 回链映射）；`db:base:sync` + 重启后按基线顺序跑 `verify:rbac` → `verify:act1`。**不做**：新的行为判据扩容（波二）。

**Files:**
- Modify: `scripts/verify-rbac.ts`（第 217–231 行 MAKER 表、第 269 行 S5 之后加 S8 / S9、第 547–556 与 583–597 行探针、第 826–828 行 main 调用）

- [ ] **Step 1: 探针表**

删：`'内审 不得 建托管钱包'`（第 547–551 行）、`'金库官 可以 建托管钱包'` / `'运营 不得 建托管钱包'` / `'技术官 不得 建托管钱包'`（第 583–597 行）。
在「钱包地址只在金库」段末尾加：

```ts
  {
    section: '钱包地址只在金库', name: '金库官 可以 恢复提现地址', method: 'POST',
    routePattern: '/admin/withdrawal-addresses/:addressNo/unsuspend', path: `/admin/withdrawal-addresses/${NOPE}/unsuspend`,
    role: 'treasury', expect: 'ALLOW', body: { reason: 'verify:rbac probe' },
  },
  {
    section: '钱包地址只在金库', name: '运营 不得 恢复提现地址', method: 'POST',
    routePattern: '/admin/withdrawal-addresses/:addressNo/unsuspend', path: `/admin/withdrawal-addresses/${NOPE}/unsuspend`,
    role: 'ops_officer', expect: 'DENY', body: { reason: 'verify:rbac probe' },
  },

  // ── 资产暂停 / 恢复只在运营（波一：技术官只剩 IAM）──────────
  {
    section: '资产管控只在运营', name: '运营 可以 提暂停资产', method: 'POST',
    routePattern: '/admin/assets/:assetNo/suspend', path: `/admin/assets/${NOPE}/suspend`,
    role: 'ops_officer', expect: 'ALLOW', body: { reason: 'verify:rbac probe' },
  },
  {
    section: '资产管控只在运营', name: '技术官 不得 提暂停资产', method: 'POST',
    routePattern: '/admin/assets/:assetNo/suspend', path: `/admin/assets/${NOPE}/suspend`,
    role: 'tech_admin', expect: 'DENY', body: { reason: 'verify:rbac probe' },
  },
  {
    section: '资产管控只在运营', name: '金库官 不得 提恢复资产', method: 'POST',
    routePattern: '/admin/assets/:assetNo/reactivate', path: `/admin/assets/${NOPE}/reactivate`,
    role: 'treasury', expect: 'DENY',
  },

  // ── 费率退役只在 CFO ─────────────────────────────────────
  {
    section: '费率只在 CFO', name: '财务 可以 提退役费率等级', method: 'POST',
    routePattern: '/admin/swap-fee-levels/:levelCode/retire', path: `/admin/swap-fee-levels/${NOPE}/retire`,
    role: 'cfo', expect: 'ALLOW', body: { reason: 'verify:rbac probe' },
  },
  {
    section: '费率只在 CFO', name: '运营 不得 提退役费率等级', method: 'POST',
    routePattern: '/admin/withdrawal-fee-levels/:levelCode/retire', path: `/admin/withdrawal-fee-levels/${NOPE}/retire`,
    role: 'ops_officer', expect: 'DENY', body: { reason: 'verify:rbac probe' },
  },
```

- [ ] **Step 2: S5 表与 S8**

`MAKER_GROUP_BY_POLICY` 改为（删 `TRANSACTION_LIMIT_CREATION`，加资产两条、退役两条、以及所有"maker 组唯一确定"的其余策略）：

```ts
  const MAKER_GROUP_BY_POLICY: Record<string, string> = {
    ASSET_SUSPENSION: 'ASSET_CONFIG_WRITE',
    ASSET_REACTIVATION: 'ASSET_CONFIG_WRITE',
    TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_WRITE',
    SWAP_FEE_LEVEL_CREATION: 'SWAP_FEE_LEVEL_WRITE',
    SWAP_FEE_LEVEL_CHANGE: 'SWAP_FEE_LEVEL_WRITE',
    SWAP_FEE_LEVEL_RETIRE: 'SWAP_FEE_LEVEL_WRITE',
    WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_WRITE',
    WITHDRAWAL_FEE_LEVEL_CHANGE: 'WITHDRAWAL_FEE_LEVEL_WRITE',
    WITHDRAWAL_FEE_LEVEL_RETIRE: 'WITHDRAWAL_FEE_LEVEL_WRITE',
    DEPOSIT_CONFISCATION: 'DEPOSIT_CONFISCATE_WRITE',
    DEPOSIT_RETURN: 'DEPOSIT_RETURN_WRITE',
    DEPOSIT_SEIZE: 'DEPOSIT_SEIZE_WRITE',
    DEPOSIT_UNFREEZE: 'DEPOSIT_UNFREEZE_WRITE',
    WITHDRAW_UNFREEZE: 'WITHDRAW_UNFREEZE_WRITE',
    WITHDRAW_SANCTION_REFUND: 'WITHDRAW_REFUND_WRITE',
    RECON_ADJUSTMENT_POST: 'RECON_ADJUSTMENT_WRITE',
    ADMIN_SUSPENSION_APPROVAL: 'IAM_MEMBER_MANAGE',
    ADMIN_REACTIVATION_APPROVAL: 'IAM_MEMBER_MANAGE',
    ADMIN_ROLE_BINDING_CHANGE_APPROVAL: 'IAM_ROLE_ASSIGN',
    ADMIN_PASSWORD_RESET: 'IAM_CREDENTIAL_RESET',
    ADMIN_MFA_RESET: 'IAM_CREDENTIAL_RESET',
    AUDIT_EVIDENCE_EXPORT_APPROVAL: 'AUDIT_EXPORT_CREATE',
    CUSTOMER_RESTRICTION_RELEASE_OPS: 'CUSTOMER_RESTRICTION_RELEASE',
  };

  // 有意不进上表的策略——每条都要写清为什么 S5 的「集合交空」判据不适用；S8 保证策略全集 = 上表 ∪ 本表
  const MAKER_GROUP_EXEMPT: Record<string, string> = {
    WITHDRAW_LARGE_VALUE_APPROVAL: '系统在建单时自动开单，没有提单权限组',
    ADMIN_INVITE_APPROVAL: '提单组 IAM_MEMBER_MANAGE 由 CISO 与技术官双持，裁决人 CISO 刻意在其中——自批由 approvals.service 的 SoD 当场拒（站 0 演示装置）',
    APPROVAL_POLICY_CHANGE: '提单组 GOV_APPROVAL_POLICY_WRITE 由高管与 CISO 双持，裁决人 CISO 刻意在其中——站 3「门自己也要过门」演的就是自批被拒',
    ROLE_DEFINITION_CREATE: '提单组 IAM_ROLE_DEFINE 由 CISO 与技术官双持，裁决人 CISO 在其中（站 1）',
    ROLE_DEFINITION_MODIFY: '同 ROLE_DEFINITION_CREATE',
    CUSTOMER_RESTRICTION_RELEASE_MLRO: '提单组 CUSTOMER_RESTRICTION_RELEASE 由 MLRO 与合规官双持，裁决人 MLRO 在其中（合规官提、MLRO 批；MLRO 自提自批被 SoD 拒）',
  };
```
（跑 S5 若对上表里某条报"既能提又能批"，先核那条策略的裁决人：是站 0 / 1 / 3 剧本里刻意的重叠 → 挪进豁免表并写理由；不是 → 真死锁，回主会话，不许为过闸把它挪走。）

S5 的 `check(...)` 之后加：

```ts
  // ── S8：MAKER 表与策略一一对应 ────────────────────────────────────────
  // 交付清单要求：新增 maker-checker 策略必须往 MAKER_GROUP_BY_POLICY 加一行——此前靠人记，
  // 波一起由本判据守：策略全集 == 表 ∪ 豁免表，且两表不相交、表里没有策略里不存在的键。
  const policyKeys = new Set(Object.keys(DEFAULT_APPROVAL_POLICIES));
  const tableKeys = new Set(Object.keys(MAKER_GROUP_BY_POLICY));
  const exemptKeys = new Set(Object.keys(MAKER_GROUP_EXEMPT));
  const uncovered = [...policyKeys].filter((k) => !tableKeys.has(k) && !exemptKeys.has(k));
  const unknown = [...tableKeys, ...exemptKeys].filter((k) => !policyKeys.has(k));
  const overlap = [...tableKeys].filter((k) => exemptKeys.has(k));
  check(
    'S8 MAKER 表与策略一一对应（策略全集 = 表 ∪ 豁免表，两表不相交）',
    uncovered.length === 0 && unknown.length === 0 && overlap.length === 0,
    uncovered.length === 0 && unknown.length === 0 && overlap.length === 0
      ? `${policyKeys.size} 条策略：${tableKeys.size} 条受 S5 保护 + ${exemptKeys.size} 条显式豁免`
      : `未覆盖 ${uncovered.join(',') || '无'} ｜ 表里有策略里没有 ${unknown.join(',') || '无'} ｜ 两表重叠 ${overlap.join(',') || '无'}`,
  );

  // ── S9：裁决人看得见 entityRef 的详情页 ────────────────────────────────
  // 镜像 admin-web/src/pages/ApprovalDetailPage.tsx 的 ENTITY_ROUTE_BY_ACTION：审批详情页把 entityRef
  // 链到业务详情页，裁决人若没有那页的读权限，点过去就是 403——"能批却看不见批的是什么"。
  const DETAIL_READ_GROUP_BY_POLICY: Record<string, string> = {
    ASSET_SUSPENSION: 'ASSET_CONFIG_READ',
    ASSET_REACTIVATION: 'ASSET_CONFIG_READ',
    TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_READ',
    SWAP_FEE_LEVEL_CREATION: 'SWAP_FEE_LEVEL_READ',
    SWAP_FEE_LEVEL_RETIRE: 'SWAP_FEE_LEVEL_READ',
    WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_READ',
    WITHDRAWAL_FEE_LEVEL_RETIRE: 'WITHDRAWAL_FEE_LEVEL_READ',
    WITHDRAW_LARGE_VALUE_APPROVAL: 'TRADING_WITHDRAW_READ',
    WITHDRAW_UNFREEZE: 'TRADING_WITHDRAW_READ',
    WITHDRAW_SANCTION_REFUND: 'TRADING_WITHDRAW_READ',
    DEPOSIT_CONFISCATION: 'TRADING_DEPOSIT_READ',
    DEPOSIT_RETURN: 'TRADING_DEPOSIT_READ',
    DEPOSIT_SEIZE: 'TRADING_DEPOSIT_READ',
    DEPOSIT_UNFREEZE: 'TRADING_DEPOSIT_READ',
    ADMIN_INVITE_APPROVAL: 'IAM_MEMBER_READ',
    ADMIN_SUSPENSION_APPROVAL: 'IAM_MEMBER_READ',
    ADMIN_REACTIVATION_APPROVAL: 'IAM_MEMBER_READ',
    ADMIN_PASSWORD_RESET: 'IAM_MEMBER_READ',
    ADMIN_MFA_RESET: 'IAM_MEMBER_READ',
    ROLE_DEFINITION_CREATE: 'IAM_ROLE_READ',
    ROLE_DEFINITION_MODIFY: 'IAM_ROLE_READ',
  };
  const blindCheckers: string[] = [];
  for (const [actionType, readGroup] of Object.entries(DETAIL_READ_GROUP_BY_POLICY)) {
    const policy = (DEFAULT_APPROVAL_POLICIES as Record<string, any>)[actionType];
    if (!policy) { blindCheckers.push(`${actionType}（策略不存在）`); continue; }
    for (const st of policy.steps) {
      for (const role of st.roles as string[]) {
        if (role === 'SUPER_ADMIN') continue;
        if (!(RBAC_ROLE_GROUP_BINDINGS[role] as string[] | undefined)?.includes(readGroup)) {
          blindCheckers.push(`${actionType}: 裁决人 ${role} 不持 ${readGroup}`);
        }
      }
    }
  }
  check(
    'S9 裁决人持有 entityRef 详情页读权限（镜像 ApprovalDetailPage 回链映射）',
    blindCheckers.length === 0,
    blindCheckers.length === 0
      ? `${Object.keys(DETAIL_READ_GROUP_BY_POLICY).length} 条带回链的策略，裁决人都看得见要批的对象`
      : blindCheckers.join(' ｜ '),
  );
```
（`ApprovalDetailPage.tsx` 若还映射了本表没列的 actionType——如 `RECON_ADJUSTMENT_POST` 或角色绑定变更——`git grep -n "(r) =>" admin-web/src/pages/ApprovalDetailPage.tsx` 逐条对照补齐，读权限组按该页路由所需的 `PERMISSIONS.*` 反查 `rbac.catalog.ts` 里的组。）

- [ ] **Step 3: 判据顺序跑（会写数据，排在重铺之前）**

```bash
npx tsc --noEmit -p tsconfig.json
bash scripts/stack.sh down self && bash scripts/on-stack.sh self db:base:sync && bash scripts/stack.sh up self
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self verify:act1
```
Expected: `ALL RBAC CHECKS PASS`（S1–S9 + 探针 + V2 + V3）；`verify:act1` B0–B14 全 PASS（B6 / B7 按新钥匙）。任一红：S2b / S7 红 → catalog 漏删或漏加行；S6 红 → 前端权限码抄串；S5 红 → 见 Step 2 括号里的裁决规则。

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-rbac.ts
git commit -m "test(rbac): 探针换退役端点为暂停/恢复/退役费率/恢复地址；S5 表与策略一一对应（S8）+ 裁决人可见性（S9）（波一 T13）"
```

**本任务过哪几条**：改 RBAC / 策略 → `db:base:sync` + 重启（已做）；判据脚本改动 → 自身跑绿；`verify:rbac` / `verify:act1` 排在重铺前（基线约束）。

---

### Task 14: 种子身世——七个 `*_SEEDED` 审计码，装载即留痕

**本任务做**：`prisma/seed-audit.helper.ts` 用 Prisma 直写审计行（种子跑在 Nest 之外，没有 `AuditLogsService`）；`seed.business.ts` 五处装载点各写一行（actorNo `RELEASE`）；`demo-lib.ts` 的演示客户收款地址 / 提现地址写 `*_SEEDED`（actorNo `DEMO_SEED`）；七码四属性入合同；`verify:demo-data` 加一条种子身世判据。**不做**：改 `AuditLogsService`；给 `db:base:sync`（管理员 / 权限字典）写审计——它们不是"配置"。

**Files:**
- Create: `prisma/seed-audit.helper.ts`
- Modify: `prisma/seed.business.ts`（`seedAssets` / `seedPlatformWallets` / `seedTransactionLimitRules` / `seedSwapFeeLevels` / `seedWithdrawalFeeLevels`）
- Modify: `scripts/demo-lib.ts`（`ensureSetup` 里两个钱包 upsert 与两个地址 upsert 之后）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `scripts/verify-demo-data.ts`

**Interfaces:**
- Produces: `writeSeedAudit(prisma, { action, subjectType, subjectNo, afterData, actorNo, ownerCustomerNo? })`；审计码 `ASSET_SEEDED / CUSTODIAN_WALLET_SEEDED / TRANSACTION_LIMIT_SEEDED / SWAP_FEE_LEVEL_SEEDED / WITHDRAWAL_FEE_LEVEL_SEEDED / CUSTOMER_DEPOSIT_ADDRESS_SEEDED / WITHDRAWAL_ADDRESS_SEEDED`（domain CONFIG，START，requiredFields `['afterData']`）。

- [ ] **Step 1: 合同先登记（封册守则：先入册再接写点）**

`audit-actions.constant.ts` 的 `V1_AUDIT_ACTIONS` 末尾（`AUDIT_LOG_QUERIED` 之前）加：

```ts
  // ── 种子身世（波一，spec §8）：配置随版本装载，装载即留痕——第七幕按 USDT 查，第一行是"随版本上架"。
  // 种子跑在 Nest 之外，由 prisma/seed-audit.helper.ts 直写：actorType SYSTEM、actorNo RELEASE（业务种子）/ DEMO_SEED（演示客户造数），
  // metadata { seedVersion, commit }。每条装载都是自己旅程的起点 → START。
  ASSET_SEEDED:                    { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  CUSTODIAN_WALLET_SEEDED:         { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  TRANSACTION_LIMIT_SEEDED:        { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  SWAP_FEE_LEVEL_SEEDED:           { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  WITHDRAWAL_FEE_LEVEL_SEEDED:     { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  CUSTOMER_DEPOSIT_ADDRESS_SEEDED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_SEEDED:       { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
```
Run: `npx jest src/modules/audit-logging/constants --no-coverage` → 四条封册绿。

- [ ] **Step 2: 写种子审计助手**

`prisma/seed-audit.helper.ts`：

```ts
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';

export type SeedActorNo = 'RELEASE' | 'DEMO_SEED';

export interface SeedAuditInput {
  action: string;
  subjectType: string;
  subjectNo: string;
  afterData: Record<string, unknown>;
  actorNo: SeedActorNo;
  ownerCustomerNo?: string | null;
}

let cachedCommit: string | null = null;
function currentCommit(): string {
  if (cachedCommit) return cachedCommit;
  try {
    cachedCommit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    cachedCommit = 'unknown';
  }
  return cachedCommit;
}

/** 种子的留痕：跑在 Nest 之外，照 AuditLogsService 的列约定直写一行（去重钥匙与它同式，重跑种子不会写第二行）。
 *  只给"配置"写：资产 / 平台钱包行 / 限额 / 费率两族 / 演示客户的收款地址与提现地址。 */
export async function writeSeedAudit(prisma: PrismaClient, input: SeedAuditInput) {
  const requestId = `${input.action}_${input.subjectNo}`;
  const idempotencyKey = createHash('sha256')
    .update(['CONFIG', input.action, input.subjectType, input.subjectNo, 'NO_CORRELATION', requestId].join('|'))
    .digest('hex');
  const existing = await prisma.auditLogEvent.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const occurredAt = new Date();
  const correlationId = randomUUID();
  const afterData = JSON.stringify(input.afterData);
  const metadata = JSON.stringify({ seedVersion: process.env.npm_package_version ?? '0.0.0', commit: currentCommit() });
  const retainedUntil = new Date(occurredAt);
  retainedUntil.setFullYear(retainedUntil.getFullYear() + 8);

  return prisma.auditLogEvent.create({
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
      payloadDigest: createHash('sha256').update(afterData).digest('hex'),
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
}
```
（`AuditLogEvent` 若有本文件没列的非空列——以 `prisma/schema.prisma` 第 370–476 行为准补上；`sourcePlatform` 若被 DTO 枚举约束，DB 层是自由串，`'SYSTEM'` 与既有写点一致。）

- [ ] **Step 3: 五处装载点接写点（actorNo RELEASE）**

`seed.business.ts` 顶部 `import { writeSeedAudit } from './seed-audit.helper';`，然后：
- `seedAssets` 的 upsert 之后：

```ts
    await writeSeedAudit(prisma, {
      action: 'ASSET_SEEDED', subjectType: 'ASSET', subjectNo: record.assetNo, actorNo: 'RELEASE',
      afterData: { code: record.code, currency: record.currency, network: record.network, contractAddress: record.contractAddress, standard: record.standard, decimals: record.decimals, status: record.status },
    });
```
- `seedPlatformWallets` 的 upsert 之后（upsert 返回值取名 `row`）：

```ts
    await writeSeedAudit(prisma, {
      action: 'CUSTODIAN_WALLET_SEEDED', subjectType: 'WALLET', subjectNo: row.walletNo, actorNo: 'RELEASE',
      afterData: { vaultCode: row.vaultCode, network: row.network, address: row.address, iban: row.iban, custodianRef: row.custodianRef, status: row.status },
    });
```
- `seedTransactionLimitRules` 每条规则落库之后（手工 upsert 分支里拿到持久化行 `persisted`——已存在则是查回的那行，新建则是 create 的返回）：

```ts
    await writeSeedAudit(prisma, {
      action: 'TRANSACTION_LIMIT_SEEDED', subjectType: 'TRANSACTION_LIMIT_POLICY', subjectNo: persisted.ruleNo, actorNo: 'RELEASE',
      afterData: { gateType: persisted.gateType, operationType: persisted.operationType, assetId: persisted.assetId, tradingTier: persisted.tradingTier, period: persisted.period, minAmount: persisted.minAmount?.toString() ?? null, maxAmount: persisted.maxAmount?.toString() ?? null, defaultLimit: persisted.defaultLimit?.toString() ?? null, threshold: persisted.threshold?.toString() ?? null },
    });
```
- `seedSwapFeeLevels` 三个 upsert（两 STD + VIP）之后各一条：`{ action: 'SWAP_FEE_LEVEL_SEEDED', subjectType: 'SWAP_FEE_LEVEL', subjectNo: levelCode, actorNo: 'RELEASE', afterData: { name, fromAssetId, toAssetId, isDefault, requiredTags, configHash } }`。
- `seedWithdrawalFeeLevels` 每个 upsert 之后：`{ action: 'WITHDRAWAL_FEE_LEVEL_SEEDED', subjectType: 'WITHDRAWAL_FEE_LEVEL', subjectNo: levelCode, actorNo: 'RELEASE', afterData: { name, assetId, isDefault, configHash } }`。

- [ ] **Step 4: 演示造数接写点（actorNo DEMO_SEED）**

`scripts/demo-lib.ts` `ensureSetup`：顶部 `import { writeSeedAudit } from '../prisma/seed-audit.helper';`；C_DEP / C_VIBAN 两个 upsert 之后各：

```ts
    await writeSeedAudit(ctx.prisma, {
      action: 'CUSTOMER_DEPOSIT_ADDRESS_SEEDED', subjectType: 'WALLET', subjectNo: depNo, actorNo: 'DEMO_SEED', ownerCustomerNo: c.customerNo,
      afterData: { network: 'TRON', walletRole: 'C_DEP', address: fakeTronAddress(depNo) },
    });
```
（VIBAN 那条 `subjectNo: vibanNo`，`afterData: { network: 'AED_ZAND', walletRole: 'C_VIBAN', iban: vibanIban }`。）两个地址 upsert 之后各：`{ action: 'WITHDRAWAL_ADDRESS_SEEDED', subjectType: 'WITHDRAWAL_ADDRESS', subjectNo: wdAddrNo | cryptoWdAddrNo, actorNo: 'DEMO_SEED', ownerCustomerNo: c.customerNo, afterData: { network, addressType, address } }`。

- [ ] **Step 5: `verify:demo-data` 加种子身世判据**

`scripts/verify-demo-data.ts` 按文件里 `scanR4` 的同一报告方式（同一个失败计数与 console 格式）加：

```ts
// R5（波一）：配置身世——业务种子的五块配置每条都有 *_SEEDED 审计行（actorNo RELEASE）
async function scanSeedLineage(prisma: PrismaClient): Promise<void> {
  const expected: Record<string, number> = {
    ASSET_SEEDED: 2,
    CUSTODIAN_WALLET_SEEDED: 7,
    TRANSACTION_LIMIT_SEEDED: 15,
    SWAP_FEE_LEVEL_SEEDED: 3,
    WITHDRAWAL_FEE_LEVEL_SEEDED: 2,
  };
  const rows = await prisma.auditLogEvent.groupBy({ by: ['action'], where: { actorNo: 'RELEASE', action: { in: Object.keys(expected) } }, _count: { _all: true } });
  const got = new Map(rows.map((r) => [r.action, r._count._all]));
  const short = Object.entries(expected).filter(([code, n]) => (got.get(code) ?? 0) < n);
  // 与文件既有的报告函数同款：全齐打 ✓，缺的逐码列出
  report('R5 配置身世 *_SEEDED', short.length === 0,
    short.length === 0 ? Object.entries(expected).map(([c, n]) => `${c}=${got.get(c)}`).join(' ') : short.map(([c, n]) => `${c} 期望 ≥${n} 实得 ${got.get(c) ?? 0}`).join(' ｜ '));
}
```
（`report(...)` 换成该文件真实的打勾 / 计数函数名；在 `main` 里 `scanR4` 之后调用。）

- [ ] **Step 6: 闸门**

```bash
npx tsc --noEmit -p tsconfig.json
bash scripts/stack.sh down self && bash scripts/stack.sh reset self && bash scripts/stack.sh up self
sqlite3 "$(source scripts/db-env.sh && read_database_url "$PWD" self | sed 's#^file:##')" "select action, actorNo, count(*) from audit_log_events where action like '%_SEEDED' group by action, actorNo;"
bash scripts/on-stack.sh self demo:setup
sqlite3 "$(source scripts/db-env.sh && read_database_url "$PWD" self | sed 's#^file:##')" "select action, actorNo, count(*) from audit_log_events where action like '%_SEEDED' group by action, actorNo;"
bash scripts/on-stack.sh self verify:demo-data
bash scripts/on-stack.sh self verify:audit
```
Expected：重铺后 5 行 `ASSET_SEEDED|RELEASE|2`、`CUSTODIAN_WALLET_SEEDED|RELEASE|7`、`SWAP_FEE_LEVEL_SEEDED|RELEASE|3`、`TRANSACTION_LIMIT_SEEDED|RELEASE|15`、`WITHDRAWAL_FEE_LEVEL_SEEDED|RELEASE|2`；`demo:setup` 后再加 `CUSTOMER_DEPOSIT_ADDRESS_SEEDED|DEMO_SEED|12`（6 位演示客户 × 2）与 `WITHDRAWAL_ADDRESS_SEEDED|DEMO_SEED|8`（6 银行 + 2 链上）；`verify:demo-data` R5 ✓；`verify:audit` 七项恒绿（不变量③ 退役码零写入）。再跑一次 `db:biz:init` 行数不翻倍（去重钥匙同式）。

- [ ] **Step 7: Commit**

```bash
git add prisma/seed-audit.helper.ts prisma/seed.business.ts scripts/demo-lib.ts scripts/verify-demo-data.ts src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(audit): 配置装载即留痕——七个 *_SEEDED 码，业务种子 RELEASE / 演示造数 DEMO_SEED（波一 T14）"
```

**本任务过哪几条**：新审计码 → 先入册四属性再接写点 + 封册 spec；改 seed → 重铺闸；判据脚本新增一条自身跑绿。

---

### Task 15: 文档、剧本、数据字典——`modules/` 现状 / `demo/` 验收 / 三本账 / 变更日志

**本任务做**：`modules/v3-financial-config.md` §0–§6 按波一终态重写；`modules/overview.md` §1 / §4 跟改；`demo/script.md` 站 2 / 4 / 5 重写；`demo/data.md`「资产与钱包」段重写；`demo/baseline.md` 封册行与判据行订正；`BACKLOG.md` 销账与登记；`PRODUCTION-NOTES.md:49` 划掉；`TOOLING-DEBT.md` 登记 X2；`CHANGELOG.md` 一行。**不做**：波二 spec 展开（只在 Task 16 写「承接上一波」）。

**Files:**
- Modify: `doc-final/modules/v3-financial-config.md`、`doc-final/modules/overview.md`（第 13、49–51、60、65、82–84、86、88 行）
- Modify: `doc-final/demo/script.md`（第 27–46 行站 2 / 4 / 5）、`doc-final/demo/data.md`（「资产与钱包」段 + 客户矩阵 Grace 行）、`doc-final/demo/baseline.md`（绿名单「封册」行、`verify:act1` 约束段）
- Modify: `doc-final/BACKLOG.md`、`doc-final/PRODUCTION-NOTES.md`、`doc-final/TOOLING-DEBT.md`、`doc-final/CHANGELOG.md`

- [ ] **Step 1: `v3-financial-config.md` 整篇替换**

```markdown
# V3 · 财务配置（资产 / 钱包地址 / 提现地址簿 / 费率 / 限额 / 定价）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：<波一收尾日期>（V3 治愈波一「结构与退役」收尾走查）
> 演示幕次：第一幕「开业」后半 ｜ 验收：第一幕后半走查（`demo/script.md` 站 2 / 4 / 5）+ 本篇 §4
> 两波总纲：`superpowers/specs/2026-09-03-v3-config-cure-waves-outline.md`；波二（法一留痕全域推广 / 判据扩容）另起会话脑暴。

## 0. 一句话定位

管**交易的静态参数**：上什么资产（在哪条网络、什么合约）、钱放在哪个容器（vault × 网络的地址行）、客户往哪提（按网络登记的地址簿）、收多少费、限多少额。不管单据怎么流转（V4–V6）、不管客户是谁（V2）。**上币不在管理台**——走开发流程随版本装载，"先有账后有货"发生在装载时。

## 1. 业务叙事

**网络是一等实体。** 资产 = 币种 × 网络 × 合约地址；`USDT-TRON` 的合约地址是防诈骗字段——入金信号的合约对不上任何资产直接拒收留痕（`DEPOSIT_SIGNAL_REJECTED`）。网络（`TRON` / `AED_ZAND`）是代码注册表（`config/manifests/networks.manifest.ts`），不建表、不做管理面；托管方（HexTrust / Zand）按网络给地址。

**资产只有开关。** 两个资产随版本装载（审计第一行 `ASSET_SEEDED`，actor `RELEASE`）；运营提暂停 / 恢复，CISO 批（12h）；暂停 = 充值 / 兑换 / 提现三条路的资产门当场关。上架 / 激活 / 编辑整条路已退役——将来上币见 BACKLOG「新资产上线整条流程」。

**钱包行 = 一个地址。** 平台侧 4 个 vault（F_OPS / F_SET / F_FEE / F_LIQ）× 网络 = 7 行只从种子来（`CUSTODIAN_WALLET_SEEDED`），管理台只读，余额一律看账本（钱包表上没有余额）。客户侧唯一写路径是"客户在某网络上要一个收款地址"（`POST /client/deposit-wallets { network }`）：同网络第二次直接复用——一 vault 一链一地址（HexTrust 语义），将来上第二个 TRC-20 币零地址工作。

**提现地址簿按网络。** 登记选网络不选资产；24h 冷却、首个法币账户即时生效、每网络最多 3 条不变；改只改标签与收款人（改地址 = 新登记，冷却闸才有意义）；冷却期内可取消、自助可停用（最后一个法币账户与有在途提现的地址停不掉）、管理员可暂停 / 恢复 / 跳过冷却（⚡ 后门必留痕）；五条边写在迁移表里，非法跃迁 409。

**限额从种子来、只改不建不删。** 15 条规则（单笔 6 / 累计 8 / 大额 1）随版本铺好（`TRANSACTION_LIMIT_SEEDED`）；运营提改金额、高管批；落地前 before-vs-current 冲突守卫；规则没有生命周期——`approvalCaseNo` 非空即"变更中"，一条规则同时只能有一张待批单。

**费率增删改查齐。** 等级 `PENDING_APPROVAL → ACTIVE | REJECTED | CANCELLED`、`ACTIVE → RETIRED`（"删" = 退役终态；该币对 / 资产最后一个 ACTIVE 默认档不可退）；创建被拒不再消失，列表筛 REJECTED 是真的；变更走独立请求单（`SFC…` / `WFC…`，configHash 快照守卫，`EXPIRED` 单独终态）；受众谓词（默认档 / 标签 + 时间窗）——Grace（VIP）命中 `VIP-USDT-AED`、Alice 命中默认档，报价在够格的档里选最便宜。

## 2. 状态机

| 主体 | 迁移表 | 边 |
|---|---|---|
| 资产 | `assets/constants/asset-transitions.constant.ts` | `ACTIVE --SUSPEND--> SUSPENDED --REACTIVATE--> ACTIVE`（请求层也走表：对 ACTIVE 提恢复 → 409） |
| 钱包行 | `wallets/wallets.service.ts#WALLET_STATUS_TRANSITIONS` | `CREATING → ACTIVE`｜`CREATING → FAILED`；两者终态（DISABLED / FROZEN 已退役——停入金靠 V2 限制账） |
| 提现地址 | `withdrawal-addresses/constants/withdrawal-address-transitions.constant.ts` | `PENDING_ACTIVATION --ACTIVATE--> ACTIVE`｜`--CANCEL--> CANCELLED`｜`ACTIVE --SUSPEND--> SUSPENDED --UNSUSPEND--> ACTIVE`｜`ACTIVE --DEACTIVATE--> DEACTIVATED` |
| 费率等级（两族） | `trading/shared/fee-level-transitions.constant.ts` | `PENDING_APPROVAL --APPROVE--> ACTIVE`｜`--DECLINE--> REJECTED`｜`--CANCEL--> CANCELLED`｜`ACTIVE --RETIRE--> RETIRED` |
| 费率变更单 | 同上 | `PENDING_APPROVAL → APPROVED ｜ REJECTED ｜ CANCELLED ｜ EXPIRED` |
| 限额规则 | — | 无生命周期（恒生效）；`approvalCaseNo` 非空 = 变更中 |

## 3. 决策点与角色

| 动作 | 谁发起（权限组） | 谁裁决（策略） | 要点 |
|---|---|---|---|
| 资产暂停 / 恢复 | **OPS_OFFICER**（`ASSET_CONFIG_WRITE`，运营独有；技术官只剩 IAM） | **CISO** 12h（`ASSET_SUSPENSION` / `ASSET_REACTIVATION`） | 有待批单时详情显示徽章 + 单号，动作按钮隐去 |
| 客户收款地址 | 客户本人（客户端） | 无审批 | 交易就绪门只在开新地址时过；同网络复用 |
| 提现地址登记 / 改标签 / 取消 / 停用 | 客户本人 | 无审批 | 24h 冷却；首个法币账户即时生效 |
| 提现地址暂停 / 恢复 / 跳过冷却 | **TREASURY_OFFICER**（`WITHDRAWAL_ADDRESS_WRITE`，金库独有） | 直接执行，必留痕 | 跳过冷却是 ⚡ 后门（Manual Simulation 区） |
| 限额改金额 | **OPS_OFFICER**（`TRANSACTION_LIMIT_WRITE`） | **SENIOR_MANAGEMENT_OFFICER** 48h | 一条规则同时只能有一张待批单；落地前冲突守卫 |
| 费率创建 / 变更 / 退役 | **CFO**（`*_FEE_LEVEL_WRITE`，财务独有） | **OPS_OFFICER** 48h（`*_CREATION` / `*_CHANGE` / `*_RETIRE`） | maker≠checker（verify:rbac S5 / S8 / S9 守）；最后一个默认档不可退 |
| 上币 / 建平台钱包 / 建限额 | 开发（随版本装载） | 无——发布标记审计 `*_SEEDED` | 管理台无入口 |

## 4. 演示脚本（第一幕 · 后半）

管理台 `P+1`，11 职务账号见 `demo/data.md`；完整 6 站剧本见 `demo/script.md`，本篇只补技术细节：

1. **站 2 · 费率页**：`cfo@` 改一档兑换费 → `ops_officer@` 批 → 客户端报价立刻变；对照：Grace（VIP 标签）与 Alice 各拿一次 USDT→AED 报价——Grace 命中 `VIP-USDT-AED`、Alice 命中 `STD-USDT-AED`（受众谓词 + 最便宜档）；退役：`cfo@` 对某档点 Retire → `ops_officer@` 批 → 列表筛 RETIRED；对 `STD-USDT-AED` 点 Retire 会被 `LAST_ACTIVE_DEFAULT` 拒
2. **站 4 · 资产管控**：`ops_officer@` 对 USDT-TRON 提暂停 → `ciso@` 批 → 切客户端 alice：充值 / 兑换 / 提现三条路的 USDT 当场不可用 → `ops_officer@` 提恢复 → `ciso@` 批；讲清：上币不在这页——审计页按 USDT 查，第一行 `ASSET_SEEDED`（随版本上架）
3. **站 5 · 限额页**：按类型筛选三种门各看一眼 → `ops_officer@` 改一条单笔限额 → 详情待批徽章 → `sm@` 批
4. **站 5 · 托管钱包页**（`treasury@`）：只读看容器——5 组（4 平台 vault + CLIENT_DEPOSIT）按 vault 分组，每行 = 一个网络上的一个地址；余额引导去账本页
5. **站 5 · 提现地址簿**（客户端 alice + 管理台 `treasury@`）三拍：① 登记一条 TRON 地址（选网络）→ 冷却倒计时 → Cancel registration；② 再登记一条 → `treasury@` 详情 ⚡ Skip Cooling → ACTIVE → Force Suspend → Unsuspend；③ 用尚无法币账户的种子客户登记首个银行账户 → 即时 ACTIVE
6. **收款地址复用**（补充走查）：对同一网络重复点开地址 → 返回同一行，总数不变

## 5. 关键技术节点（≤30 行）

- 注册表 `config/manifests/{networks,vaults,assets}.manifest.ts`：`assertNetwork()`（三列写入前都过）｜ `validateAddressForNetwork()` ｜ `platformWalletSlots()`（恒 7）｜ `DEFAULT_ASSETS`（含合约 / 标准 / 确认数 / 托管键）
- 资产 `asset-treasury/assets/`：`assets.service.ts`（`suspendAsset / reactivateAsset / linkApprovalCase / clearApprovalCase`）｜ `asset-admin.controller.ts`（suspend / reactivate）｜ `asset-{suspension,reactivation}-workflow`（请求层走 `assertAssetTransition`）｜ `asset-provisioning.service.ts#systemAccountCodesFor`（种子开系统科目）
- 钱包 `asset-treasury/wallets/`：`wallets.service.ts`（迁移表 + `createWalletRecord` 校验 vault × 网络槽位）｜ `customer-deposit-wallet.service.ts#createOrReturn(customerId, network)` ｜ `mock-custodian.adapter.ts#createAddress`（TRON 形态地址 / AE IBAN）｜ `wallet-query.service.ts`（挂 `networkInfo`，无余额）｜ `funds-layer/domain/system-wallet-resolver.service.ts`（按资产网络找 `PLATFORM` / `CLIENT_DEPOSIT` 行）
- 入金信号 `deposit-transactions/inbound-transfer-signals.service.ts`：钥匙①（network, address｜iban）→ 钱包行；钥匙②（network, contractAddress）→ 资产；对不上 → `DEPOSIT_SIGNAL_REJECTED`（DENIED / `UNKNOWN_ASSET`）
- 提现地址 `asset-treasury/withdrawal-addresses/`：迁移表常量 ｜ `withdrawal-address.service.ts`（`MAX_ADDRESSES_PER_NETWORK=3` / `COOLING_PERIOD_HOURS=24` / `BANK_RAIL_NETWORK` / `createBankAccount` 首法币免冷却 / `deactivate` 两道守卫 / `unsuspend` / `updateDetails`）｜ workflow（`updateAddress` / `unsuspendAddress`）｜ sweep（@Cron */5 + 查询前懒激活）
- 限额 `asset-treasury/transaction-limits/`：`rules.service`（只改：`attachApprovalCase / clearApprovalCase / applyAmountChange`）｜ `gate.service#evaluate`（L1）｜ `rule-workflow`（变更审批 + 冲突守卫）｜ 种子 `seedTransactionLimitRules`（15 条）
- 费率 `trading/{swap,withdrawal}-fee-level/`：`*-fee-level.service`（`declineLevel / cancelLevel / retireLevel / assertNotLastActiveDefault / expireChangeRequest`；`findByLevelCode` 带 `pendingChangeRequest`）｜ `*-creation / *-change / *-retire-workflow`（+ approval 发射器）｜ `trading/shared/fee-level-transitions.constant.ts` ｜ 受众 `trading/shared/fee-audience.util.ts` ｜ 报价 `swap-quote` / `withdraw-quote`（交易域，未动）
- 种子身世 `prisma/seed-audit.helper.ts`：`*_SEEDED` ×7，actorNo `RELEASE` / `DEMO_SEED`，metadata `{ seedVersion, commit }`；`verify:demo-data` R5 守数量
- 判据：`verify:act1` B6（钱包业务键）/ B7（对 ACTIVE 提恢复 409）｜ `verify:rbac` S5 / S8（MAKER 表与策略一一对应）/ S9（裁决人持详情页读权限）+ 资产 / 地址 / 费率退役探针
- 审计：本域全部写点在 `audit-actions.constant.ts` 合同（CONFIG / DEPOSIT 域，四属性齐）；退役码 20 个在 `DEPRECATED_AUDIT_ACTIONS`（资产六 / 钱包六 / 限额四 / 旧充值地址两 …），`verify:audit` 不变量③守零写入

## 6. 演示缺口（BACKLOG 有账）

- **新资产上线整条流程**（未来：上币包装载 + 就绪检查 + 运营提激活）
- **充值累计限额未接**；充值下限拦截不经 gate 留痕、被守卫拦下留痕、客户动作 actor=CUSTOMER 全域推广、行为判据扩容 —— 波二
- **报价未落资格快照 / 费率 30 日历日生效闸未做**
- 只有 TRON 一条链、一个链上资产："同链共用地址"没有第二个币可演——结构对了即可
```

- [ ] **Step 2: `overview.md`**

- 第 13 行 V3 那行：`| V3 财务配置 | 资产 / 网络 / 钱包地址行 / 提现地址簿 / 费率 / 限额 | 交易的静态参数从哪来（上币随版本装载） |`。
- 第 49 行标题 `## 4. 权限包拆分（12 域 49 桶）`；第 51 行 `12 域、50 桶` → `12 域、49 桶`（`treasury.manage_wallets` 退役）。
- 第 60 行 Treasury 行：`| Treasury | 查资产 / 暂停恢复资产 ｜ 查钱包地址行 ｜ 查/管提现地址 ｜ 查/管限额 | 7 桶；「暂停 / 恢复资产」独属运营，「管提现地址」独属金库专员；钱包地址行只从种子来、管理台只读 |`。
- 第 65 行 Pricing 行末尾加"（创建 / 变更 / 退役三种单）"。
- 第 82–84 行：`TREASURY_OFFICER | 管提现地址（暂停 / 恢复 / 跳过冷却）——钱往哪提归他；钱包地址行只读`；`TECH_OFFICER | 只剩 IAM（邀请 / 定义角色 / 重置凭据）；资产管控 2026-09 起归运营`；`OPS_OFFICER` 行加"暂停 / 恢复资产"。
- 第 86 行矩阵头条："钱包与提现地址只在金库专员" → "提现地址只在金库专员 ｜ 资产暂停 / 恢复只在运营"。
- 第 88 行：`PermissionGroup` 类型 60 个 → 59 个；50 桶 → 49 桶。

- [ ] **Step 3: `script.md` 站 2 / 4 / 5**

第 27–30 行（站 2）替换为：

```markdown
**站 2 · 一笔配置要过门**（配置有身世）
账号：`cfo@`（财务负责人，maker）→ `ops_officer@`（运营，checker）；切客户端 `demo_grace`（VIP）与 `demo_alice`
走查：① 费率页给兑换费改一档 → 财务负责人提交（费率写权限现为财务独有）→ ② 换运营账号登录批准 → ③ 切客户端拿一次报价 → ④ 对照：Grace 与 Alice 各拿一次 USDT→AED 报价——Grace 命中 `VIP-USDT-AED`（VIP 标签），Alice 命中 `STD-USDT-AED`（默认档）：够格的档里选最便宜 → ⑤ 财务对某档点 Retire（理由）→ 运营批准 → 列表筛 RETIRED 看得到它；对 `STD-USDT-AED` 点 Retire 会被拒（最后一个默认档不可退）
期望：报价当场变（直通第四幕）；受众档与默认档同屏对照；"删" = 退役终态不是消失；提单人是财务、批的人是运营，两条线不落一人
```
第 37–40 行（站 4）替换为：

```markdown
**站 4 · 资产管控**（暂停就是总开关；上币不在这页）
账号：`ops_officer@`（运营，maker）→ `ciso@`（CISO，checker）；切客户端 `demo_alice`
走查：① 资产页打开 USDT-TRON——身份字段一屏看全：网络 TRON、合约 `TR7N…`（防诈骗字段）、TRC-20、19 个确认、托管方资产键 → ② 点 Suspend 填理由提交 → 详情出现待批徽章 + 审批单号 → ③ 换 `ciso@` 批准 → 状态 SUSPENDED → ④ 切客户端 alice：充值页选不到 USDT、兑换 USDT 报价被拒、提现 USDT 被拒（三域建单前的资产门只认 ACTIVE）→ ⑤ 回 `ops_officer@` 提恢复 → `ciso@` 批 → ACTIVE → ⑥ 审计页按 USDT 查：第一行 `ASSET_SEEDED`（actor `RELEASE`，metadata 带版本与 commit）——上币走开发流程随版本上架，管理台没有"新建资产"
期望：两个人的戏（运营提、CISO 批）；暂停当场关三条路；配置的身世从装载那一刻就有
```
第 42–46 行（站 5）替换为：

```markdown
**站 5 · 三种门与容器**（钱放在哪、拦在哪一刻）
账号：`ops_officer@`（运营，maker）→ `sm@`（高管，checker）；钱包与地址环节 `treasury@`（金库专员）；切客户端 `demo_alice`；首个法币账户用尚无法币地址的种子客户（见 data.md「地址簿种子」）
走查：① 限额页按类型筛选（单笔／累计／大额）各看一眼，说清三种门在哪一刻拦人 → ② 改一条单笔限额 → 运营提交 → 详情待批徽章 → 换高管账号批准（限额裁决人是高管，非运营自批；规则从种子来，这页没有新建）→ ③ 托管钱包页（`treasury@`）只读看容器：按 vault 分五组，每行 = 一个网络上的一个地址（7 行平台 + 客户地址行），余额去账本页看 → ④ 切客户端登记一个 TRON 地址（选网络不选资产）→ 24h 冷却倒计时 → 三拍：a) 冷却期内 Cancel registration；b) 再登记一条 → `treasury@` 详情 ⚡ Skip Cooling（理由必填，后门留痕）→ ACTIVE → Force Suspend → Unsuspend；c) 用尚无法币账户的种子客户登记首个银行账户 → 即时生效
期望：三种门各在哪一刻拦人；容器是 vault × 网络不是资产；冷却闸的例外规则与后门都有痕
```

- [ ] **Step 4: `data.md`「资产与钱包」段替换**

```markdown
## 资产、网络与钱包地址行

**网络注册表**（代码，不建表）：`TRON`（链，HexTrust，地址 `T` + 33 位 Base58，19 个确认）｜ `AED_ZAND`（银行通道，Zand，IBAN `AE` + 21 位数字）。

**资产**（随版本装载，审计 `ASSET_SEEDED`）：`AED`（法币，AED_ZAND）｜ `USDT-TRON`（TRC-20，合约 `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`，6 位小数，托管键 `tron_USDT`）。上币不在管理台。

**平台钱包地址行**（7 行，审计 `CUSTODIAN_WALLET_SEEDED`，管理台只读）：

| vault | TRON | AED_ZAND |
|---|---|---|
| F_OPS 运营 | ✓ 地址 | ✓ IBAN |
| F_SET 结算 | —（只走法币通道） | ✓ IBAN |
| F_FEE 手续费 | ✓ 地址 | ✓ IBAN |
| F_LIQ 流动性 | ✓ 地址 | ✓ IBAN |

**客户收款地址行**（`demo:setup`，审计 `CUSTOMER_DEPOSIT_ADDRESS_SEEDED`）：alice / bob / grace / jack / kate / frank 各一条 TRON（C_DEP）+ 一条 AED_ZAND（C_VIBAN），vault `CLIENT_DEPOSIT`；账本科目仍按资产。

**地址簿种子**（审计 `WITHDRAWAL_ADDRESS_SEEDED`）：六位客户各一条 ACTIVE 银行账户（AED_ZAND，即本人 vIBAN）；alice / bob 各一条 ACTIVE 的 TRON 地址。**尚无法币账户的种子客户**：Henry Acme（`demo_henry@example.com`，企业客户；邮箱以 `seed.business.ts#seedCustomers` 为准）——站 5 ④c 用他演"首个法币账户即时生效"。

**费率**：`STD-USDT-AED` / `STD-AED-USDT`（默认档）+ `VIP-USDT-AED`（requiredTags `["VIP"]`，各档比 STD 便宜；Grace 带 VIP 标签命中它）；提现 `STD-AED-AED_ZAND` / `STD-USDT-TRON`。**限额**：15 条（单笔 6 / 累计 8 / 大额 1）。

**现场登记用的合法 TRON 样例地址**：`bash -c 'npx ts-node -e "import(\"./src/common/utils/tron-address.util\").then(m=>console.log(m.fakeTronAddress(\"demo-register-1\")))"'` 生成一枚（形态合法、不做校验和）。
```
客户矩阵 Grace 行的"用来演什么"改"费率受众谓词（命中 VIP-USDT-AED）"。

- [ ] **Step 5: 三本账 + 基线 + 变更日志**

- `BACKLOG.md`：第 22 行「新建资产表单」条目末尾追加 `｜ 2026-09 V3 波一：建资产 / 编辑 / 激活整条路退役，此条随之作废`；`git grep -n "2026-09-03 V3 体检" doc-final/BACKLOG.md` 命中的条目里，凡本波已做的（网络优先 / 上币退役 / 地址簿按网络 / 限额只改 / 费率退役 / 种子身世）标 `[x]` 并注 `已解（V3 波一，<commit>）`；未做的（充值累计限额、下限拦截留痕、判据扩容）保留并注"波二"。
- `PRODUCTION-NOTES.md` 第 49 行：`- [x] 提现后端补提现地址 ACTIVE 校验 …｜ 2026-09 核实：代码自 08-04 起已校验地址状态（withdraw-transactions.service 建单时按网络 + ACTIVE 查在册地址），此条销账`。
- `TOOLING-DEBT.md` 按文件规矩追加一条：

```markdown
## X2 · 合并进 main 后主栈不重启、权限字典不 sync，前端立刻 403（2026-09 登记，V3 体检两次撞上）

**复现**：在 main 栈跑着的情况下 `git merge` 一支改了 `rbac.catalog.ts` 的分支 → 不重启后端、不 `db:base:sync` → 用 `treasury@` 打开钱包详情 → 403（内存里的 `RBAC_PERMISSION_DEFINITIONS` 与 DB 权限字典都是旧的）。
**期望**：`bash scripts/stack.sh down main && bash scripts/on-stack.sh main db:base:sync && bash scripts/stack.sh up main` 后同一页 200。
**这轮不修的原因**：合并后重启 + sync 是流程动作（`delivery-checklist.md` 已列），不是工具缺陷；登记在此是让下一次撞上的人一眼找到复现与解法。
```
- `demo/baseline.md`：绿名单「封册」行改 `audit-vocabulary-closure.spec 四条：平面表归籍 / 六册互斥 / 写点闭合退役词零引用 / 码全局唯一禁裸名`（旧"V3 附册冻结快照"已不存在）；「verify:act1 操作约束」段末尾加一句 `波一起 B6 夹具按 (vaultCode, network, ownerNo) 建平台行、B7 改为对 ACTIVE 资产提恢复（运营 token）→ 409`；「单测」行的套数 / 例数在 Task 16 实测后回填。
- `CHANGELOG.md` 顶部追加：

```markdown
- [<波一收尾日期>] **V3 财务配置治愈 · 波一「结构与退役」**：观众能感知的变化——① 资产页没有"新建"了，上币随版本上架、审计第一行就是 `ASSET_SEEDED`；运营提暂停 / 恢复、CISO 批，暂停当场关三条交易路 ② 托管钱包页变成只读的"容器清单"（vault × 网络 7 行 + 客户地址行），余额一律看账本 ③ 客户在充值页按网络要地址，同网络只有一个；入金信号合约对不上直接拒收留痕 ④ 提现地址簿按网络登记、可取消 / 改标签，管理员多了"恢复"，跳过冷却进 ⚡ 区 ⑤ 限额没有"新建"了，改金额待批有徽章 ⑥ 费率能退役（CFO 提、运营批，最后一个默认档退不掉），创建被拒不再消失，Grace 的 VIP 档与 Alice 的默认档同屏对照 ⑦ 五块配置装载即留痕（七个 `*_SEEDED`）。判据：verify:rbac +S8/S9 与六条新探针、verify:act1 B7 改写、verify:demo-data +R5。
```

- [ ] **Step 6: Commit**

```bash
git add doc-final
git commit -m "docs(v3): 波一收尾——模块篇 §0–§6 重写、剧本站 2/4/5、数据字典、三本账、基线、变更日志（波一 T15）"
```

**本任务过哪几条**：改页面 / 种子 → `demo/data.md` + `demo/script.md` 同步（已做）；`modules/` 现状唯一真相（已重写）；出口三本账各归其位；CHANGELOG 一行。

---

### Task 16: 收尾闸、真机三查、承接记录、合并主线

**本任务做**：按基线顺序跑全部收尾闸；站 2 / 4 / 5 真机三查（走通没有 / 页面对不对 / 审计查得到吗）+ 截图；把「承接上一波」写进波二 spec 开头（不展开波二）；merge main 复跑三份共享文件相关判据；合并进 main，主栈重铺 + 重启 + sync；归档波一 spec / plan；清 worktree。**不做**：波二任何内容；新判据。

**Files:**
- Modify: `doc-final/superpowers/specs/2026-09-03-v3-config-cure-wave2-design.md`（只在开头插入「承接上一波」段）
- Modify: `doc-final/demo/baseline.md`（回填单测套数 / 例数）
- Move: `doc-final/superpowers/specs/2026-09-03-v3-config-cure-wave1-design.md`、`doc-final/superpowers/plans/2026-09-03-v3-config-cure-wave1.md` → `doc-final/archive/`（合并后）

- [ ] **Step 1: 收尾闸（worktree，self 栈；顺序不可颠倒）**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx tsc --noEmit -p tsconfig.json && (cd admin-web && npx tsc -b --noEmit) && (cd client-web && npx tsc -b --noEmit)
npx jest 2>&1 | tail -5                        # 记下 "Tests: N passed" 与 "Test Suites"，回填 baseline
npm run test:client
bash scripts/stack.sh down self && bash scripts/on-stack.sh self db:base:sync && bash scripts/stack.sh up self
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self verify:act1
bash scripts/stack.sh down self && bash scripts/stack.sh reset self && bash scripts/stack.sh up self
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:audit
bash scripts/on-stack.sh self verify:demo-data
bash scripts/on-stack.sh self recon:demo:pass
bash scripts/stack.sh down self && bash scripts/stack.sh reset self && bash scripts/stack.sh up self && bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self recon:demo:break
bash scripts/on-stack.sh self test:e2e
```
Expected（对照 `demo/baseline.md` 绿名单）：tsc ①②③ 零错；jest 退出码 0；vitest 全绿；`ALL RBAC CHECKS PASS`；`verify:act1` B0–B14 全 PASS；`demo:all` 花名册 29/29 + COA 四恒等式；`verify:coa` PASS；`verify:audit` 七项 ✓；`verify:demo-data` R1–R5 ✓；`recon:demo:pass` PASS；`recon:demo:break` 14/14 场景 + 11/11 钱包桶 + `casesOpened` 完整；`test:e2e` 全绿。任何红 → 修代码，**禁止改脚本迁就**；诊断不动 → 回主会话。

- [ ] **Step 2: 真机三查（站 2 / 4 / 5）**

栈已起（`demo:all` 之后的库）。每站按剧本走一遍，三问各一张截图：走通没有（终态截图）/ 页面对不对（关键页截图）/ 审计查得到吗（审计页按单号 / 资产码筛出该动作的截图）：
1. 站 2：`cfo@` 改一档 → `ops_officer@` 批 → 客户端 grace / alice 报价对照 → `cfo@` Retire `VIP-USDT-AED` → 批 → 审计页按 `VIP-USDT-AED` 查：`SWAP_FEE_LEVEL_SEEDED` → `SWAP_FEE_LEVEL_RETIRE_REQUESTED` → `SWAP_FEE_LEVEL_RETIRED` 三行成串（同 correlationId 的两行 + 种子行）。
2. 站 4：暂停 / 恢复整条路 + 客户端三条路当场停 + 审计页按 USDT 资产号查：第一行 `ASSET_SEEDED`。
3. 站 5：限额改金额待批徽章 → 高管批；托管钱包页五组只读；地址簿三拍；审计页按 addressNo 查：`WITHDRAWAL_ADDRESS_REGISTERED / COOLING_SKIPPED / SUSPENDED / UNSUSPENDED` 同一 correlationId（地址的 traceId）。
4. 主库重铺后 `audit_log_events` 里五块配置各有 `*_SEEDED` 行（Task 14 Step 6 的 sqlite 查询再跑一次贴进报告）。
截图用 `SendUserFile` 交给业主；报告里按站列"三查"结论。

- [ ] **Step 3: 「承接上一波」写进波二 spec 开头**

`2026-09-03-v3-config-cure-wave2-design.md` 标题之后插入（只写事实，不展开波二方案）：

```markdown
## 承接上一波（波一收尾时写，<日期>）

**波一交付**：spec `2026-09-03-v3-config-cure-wave1-design.md` §2–§9 全部落地（合并 commit `<hash>`）。

**与 spec 的四处实施裁定**（见 plan 头部）：① `Wallet` 保留内部列 `ownerId`；② `InboundTransferSignal` 保留 `walletId / assetId` 列，只改 DTO；③ AED 网络码 `AED_ZAND`、银行账户地址网络 `AED_ZAND`；客户端 `PATCH /client/withdrawal-addresses/:addressNo` 不登 catalog（同其三条兄弟路由）；④ 费率族无码因删行作废，`*_CREATION_CANCELLED` 保留。

**verify:rbac S8 的显式豁免表**：`WITHDRAW_LARGE_VALUE_APPROVAL`（系统开单）+ IAM 四条 + `APPROVAL_POLICY_CHANGE` + `CUSTOMER_RESTRICTION_RELEASE_MLRO`（裁决人与提单组刻意重叠，运行时 SoD 拒自批）——波二若动这些策略，先看这张表。

**波一刻意没做、留给波二的**（总纲表右列）：法一留痕全域推广（被守卫拦下留痕、客户动作 actor=CUSTOMER——`CUSTOMER_DEPOSIT_ADDRESS_CREATED` 已是第一例可照抄）、充值下限拦截经 gate 留痕、行为判据扩容（资产暂停生效 / 地址五条边 / 限额冲突 / 费率四条 / VIP 命中）。

**波一新发现（登 BACKLOG 的）**：<收尾时逐条列，来源标"V3 波一"；没有就写"无">

**环境事实**：主栈已重铺 + 重启 + `db:base:sync`；worktree `v3-wave1` 与分支已清；`demo/baseline.md` 单测数字已回填为 <N 套 / M 例>。
```

- [ ] **Step 4: merge main 复跑、合并、主栈重铺、归档、清场**

```bash
git fetch . main 2>/dev/null; git merge main            # 冲突高发：rbac.catalog.ts / approval.constants.ts / audit-actions.constant.ts / DEPRECATED 列表 / schema.prisma
npx tsc --noEmit -p tsconfig.json && npx jest src/modules/audit-logging/constants src/modules/identity --no-coverage
bash scripts/stack.sh down self && bash scripts/on-stack.sh self db:base:sync && bash scripts/stack.sh up self
bash scripts/on-stack.sh self verify:rbac && bash scripts/on-stack.sh self verify:act1
bash scripts/stack.sh down self && bash scripts/stack.sh reset self && bash scripts/stack.sh up self && bash scripts/on-stack.sh self demo:all && bash scripts/on-stack.sh self verify:coa
```
全绿后回主工作树合并（`git status` 先确认主树干净——并行会话常带 WIP，只 add 具名文件、不动别人的改动）：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git merge --no-ff feat/v3-config-cure-wave1 -m "merge: 并入 V3 财务配置治愈 · 波一「结构与退役」（16 tasks）"
cd Exchange_js
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm run prisma:generate
bash scripts/stack.sh down main && bash scripts/stack.sh reset main && bash scripts/stack.sh up main
bash scripts/on-stack.sh main db:base:sync && bash scripts/stack.sh down main && bash scripts/stack.sh up main
bash scripts/on-stack.sh main demo:all && bash scripts/on-stack.sh main verify:coa
git mv doc-final/superpowers/specs/2026-09-03-v3-config-cure-wave1-design.md doc-final/archive/
git mv doc-final/superpowers/plans/2026-09-03-v3-config-cure-wave1.md doc-final/archive/
git commit -m "chore(archive): V3 波一 spec/plan 归档（波二骨架与总纲留在 specs/）"
git worktree remove .claude/worktrees/v3-wave1 && git branch -d feat/v3-config-cure-wave1
bash scripts/stack.sh status
```
Expected: 主栈 `demo:all` 29/29 + `verify:coa` PASS；`stack.sh status` 只剩 main 栈；`git worktree list` 只剩主树。

- [ ] **Step 5: 收尾报告**

按 CLAUDE.md §9 报一行：`Documentation updated: modules§0-4 / modules§5 / demo / none(decisions) — V3 波一：模块篇重写、剧本站 2/4/5 与数据字典、基线数字回填、承接段写进波二 spec`。附：三站三查截图、收尾闸输出摘要（各判据 PASS 行）、退役清单核对表（六个文件组 + 20 个退役码）、BACKLOG 新登记项。

**本任务过哪几条**：收尾闸全部（⑥ demo:all ⑦ verify:coa ⑧ 重铺）；真机走查三查 + 截图；多波行——承接写进下一波 spec 开头、不展开下一波；合并后主栈重启 + sync（X2）；归档；worktree 清场。
