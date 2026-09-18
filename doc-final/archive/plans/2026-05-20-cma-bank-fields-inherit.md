# CMA Bank Fields Inherit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin 创建 CMA 时手动填写 bankName/accountName；vIBAN 创建时自动从 CMA 继承这两个字段。

**Architecture:** 零 schema 变更。后端 DTO 新增两个可选字段，workflow 按 role 区分：CMA 必填校验 + 透传，vIBAN 查询 CMA + 复制。前端 modal 按 role 切换输入/只读展示。

**Tech Stack:** NestJS, Prisma, React, class-validator

---

### Task 1: Backend — DTO 新增 bankName / accountName

**Files:**
- Modify: `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts`

- [ ] **Step 1: 添加 bankName 和 accountName 字段**

```typescript
@ApiProperty({ required: false, description: 'Bank name — required for C_CMA role' })
@IsString()
@IsOptional()
bankName?: string;

@ApiProperty({ required: false, description: 'Account holder name — required for C_CMA role' })
@IsString()
@IsOptional()
accountName?: string;
```

在 `iban` 字段后面添加。

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts
git commit -m "feat: add bankName/accountName to CreateCustodianWalletDto"
```

---

### Task 2: Backend — CMA 创建校验 + vIBAN 继承

**Files:**
- Modify: `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts:47-124`

- [ ] **Step 1: 在 `initiateCreate` 方法中，`walletType` 赋值后（约行 112），添加 bankName/accountName 解析逻辑**

在 `const walletType = ...` 行之后，`const wallet = ...` 行之前插入：

```typescript
// ── bankName / accountName: CMA = required from DTO, vIBAN = inherit from CMA ──
let bankName: string | undefined;
let accountName: string | undefined;

if (dto.role === WalletRole.C_CMA) {
  if (!dto.bankName?.trim()) {
    throw new BadRequestException({
      code: 'BANK_NAME_REQUIRED',
      message: 'bankName is required for C_CMA wallets',
    });
  }
  if (!dto.accountName?.trim()) {
    throw new BadRequestException({
      code: 'ACCOUNT_NAME_REQUIRED',
      message: 'accountName is required for C_CMA wallets',
    });
  }
  bankName = dto.bankName.trim();
  accountName = dto.accountName.trim();
} else if (dto.role === WalletRole.C_VIBAN) {
  const cma = await this.prisma.wallet.findFirst({
    where: {
      walletRole: WalletRole.C_CMA,
      assetId: asset.id,
      status: 'ACTIVE',
    },
    select: { bankName: true, accountName: true },
  });
  if (!cma) {
    throw new BadRequestException({
      code: 'CMA_NOT_FOUND',
      message: `No active CMA wallet found for asset ${dto.assetNo}. Create the CMA first.`,
    });
  }
  bankName = cma.bankName ?? undefined;
  accountName = cma.accountName ?? undefined;
}
```

- [ ] **Step 2: 将 bankName/accountName 传入 createWalletRecord 调用**

修改 `this.walletsService.createWalletRecord(...)` 调用，在现有参数对象中追加：

```typescript
bankName,
accountName,
```

完整调用变为：

```typescript
const wallet = (await this.walletsService.createWalletRecord({
  assetId: asset.id,
  ownerType,
  ownerId: ownerType === 'PLATFORM' ? undefined : customer?.id,
  ownerNo: ownerType === 'PLATFORM' ? undefined : customer?.customerNo,
  walletRole: dto.role,
  status: 'PENDING_APPROVAL',
  type: walletType,
  vaultId: dto.vaultId,
  iban: dto.iban,
  bankName,
  accountName,
}))!;
```

- [ ] **Step 3: 确保 WalletRole import 包含 C_CMA 和 C_VIBAN**

文件顶部已有 `import { WalletRole } from './dto/wallet.dto';`，确认 WalletRole enum 包含 `C_CMA` 和 `C_VIBAN`。

Run: `grep -n 'C_CMA\|C_VIBAN' src/modules/asset-treasury/wallets/dto/wallet.dto.ts`

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts
git commit -m "feat: CMA bankName/accountName validation + vIBAN inherit from CMA"
```

---

### Task 3: Backend — 客户创建 vIBAN 时继承 CMA 字段

**Files:**
- Modify: `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts:57-87`

- [ ] **Step 1: 在 wallet create 前，查询 CMA 字段**

在 `const traceId = ...` 行（约行 74）之后、`const wallet = await this.prisma.wallet.create(...)` 之前，添加：

```typescript
// Inherit bankName/accountName from CMA for FIAT vIBAN
let bankName: string | null = null;
let accountName: string | null = null;
if (walletRole === WalletRole.C_VIBAN) {
  const cma = await this.prisma.wallet.findFirst({
    where: {
      walletRole: WalletRole.C_CMA,
      assetId,
      status: WalletStatus.ACTIVE,
    },
    select: { bankName: true, accountName: true },
  });
  if (cma) {
    bankName = cma.bankName;
    accountName = cma.accountName;
  }
}
```

- [ ] **Step 2: 在 wallet.create data 中加入 bankName / accountName**

修改 `this.prisma.wallet.create({ data: { ... } })` 调用，在 `status` 之后追加：

```typescript
bankName,
accountName,
```

- [ ] **Step 3: 确保 WalletRole import 已存在**

顶部已有 `import { WalletRole, WalletStatus } from './dto/wallet.dto';`，确认 OK。

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts
git commit -m "feat: customer vIBAN inherits bankName/accountName from CMA"
```

---

### Task 4: Admin Frontend — CMA 创建表单 + vIBAN 只读继承

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletCreateModal.tsx`

- [ ] **Step 1: 新增 state 变量**

在现有 state（`iban` 之后）添加：

```typescript
const [bankName, setBankName] = useState('');
const [accountName, setAccountName] = useState('');
const [cmaLoading, setCmaLoading] = useState(false);
```

- [ ] **Step 2: 新增 derived state**

在 `needsIban` 之后添加：

```typescript
const isCma = role === 'C_CMA';
const isViban = role === 'C_VIBAN';
const needsBankFields = isCma || isViban;
```

- [ ] **Step 3: 添加 useEffect — 当 role=C_VIBAN 且已选择资产时 fetch CMA**

在 role/asset 变更的 useEffect 附近添加：

```typescript
useEffect(() => {
  if (!isViban || !selectedAsset) {
    // Reset if not vIBAN
    if (!isCma) {
      setBankName('');
      setAccountName('');
    }
    return;
  }
  // Fetch CMA for this asset
  const fetchCma = async () => {
    setCmaLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/custodian-wallets?walletRole=C_CMA&assetId=${selectedAsset.id}&status=ACTIVE&take=1`,
      );
      if (res.ok) {
        const data = await res.json();
        const items = data.items ?? data;
        if (items.length > 0) {
          setBankName(items[0].bankName || '');
          setAccountName(items[0].accountName || '');
        } else {
          setBankName('');
          setAccountName('');
        }
      }
    } catch {
      // ignore
    } finally {
      setCmaLoading(false);
    }
  };
  void fetchCma();
}, [role, assetNo]);
```

- [ ] **Step 4: 添加 CMA 必填校验到 handleSubmit**

在 `if (needsIban && !iban.trim())` 校验之后添加：

```typescript
if (isCma && !bankName.trim()) { setError('Bank Name is required for CMA wallets.'); return; }
if (isCma && !accountName.trim()) { setError('Account Holder is required for CMA wallets.'); return; }
```

- [ ] **Step 5: 提交时把 bankName/accountName 加入 body**

在 `if (needsIban && iban.trim()) body.iban = iban.trim();` 之后添加：

```typescript
if (isCma && bankName.trim()) body.bankName = bankName.trim();
if (isCma && accountName.trim()) body.accountName = accountName.trim();
```

- [ ] **Step 6: 添加表单 UI — Bank Name + Account Holder**

在 IBAN 输入框之后（`{needsIban && (...)}`），添加：

```tsx
{/* Bank Name — CMA: editable, vIBAN: read-only from CMA */}
{needsBankFields && (
  <div>
    <label className={labelCls}>Bank Name{isCma ? ' *' : ''}</label>
    <input
      type="text"
      value={bankName}
      onChange={(e) => isCma && setBankName(e.target.value)}
      readOnly={isViban}
      placeholder={isViban ? (cmaLoading ? 'Loading from CMA…' : 'Inherited from CMA') : 'e.g. Zand Bank PJSC'}
      className={`${inputCls} ${isViban ? 'bg-gray-50 text-adm-t3' : ''}`}
    />
  </div>
)}

{/* Account Holder — CMA: editable, vIBAN: read-only from CMA */}
{needsBankFields && (
  <div>
    <label className={labelCls}>Account Holder{isCma ? ' *' : ''}</label>
    <input
      type="text"
      value={accountName}
      onChange={(e) => isCma && setAccountName(e.target.value)}
      readOnly={isViban}
      placeholder={isViban ? (cmaLoading ? 'Loading from CMA…' : 'Inherited from CMA') : 'e.g. FiatX Ltd'}
      className={`${inputCls} ${isViban ? 'bg-gray-50 text-adm-t3' : ''}`}
    />
  </div>
)}
```

- [ ] **Step 7: Reset bankName/accountName when role changes**

在已有的 `useEffect` 中（`setIban('')`），追加：

```typescript
setBankName('');
setAccountName('');
```

- [ ] **Step 8: 验证编译通过**

Run: `cd admin-web && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/pages/CustodianWalletCreateModal.tsx
git commit -m "feat: admin CMA form adds bankName/accountName, vIBAN auto-inherits"
```

---

### Task 5: End-to-end 验证

- [ ] **Step 1: 启动后端**

```bash
npx ts-node -T -r tsconfig-paths/register src/main.ts &
```

等待 `Listening on port 3500`

- [ ] **Step 2: 通过 API 创建 CMA，验证 bankName/accountName 必填**

```bash
# 缺少 bankName → 400
curl -s localhost:3500/admin/custodian-wallets -X POST \
  -H 'Content-Type: application/json' \
  -d '{"assetNo":"AS...","role":"C_CMA","iban":"AE070331234567890123456"}' | jq .

# 完整 → 201
curl -s localhost:3500/admin/custodian-wallets -X POST \
  -H 'Content-Type: application/json' \
  -d '{"assetNo":"AS...","role":"C_CMA","iban":"AE070331234567890123456","bankName":"Zand Bank PJSC","accountName":"FiatX Ltd"}' | jq .
```

- [ ] **Step 3: 创建 vIBAN，验证自动继承**

```bash
curl -s localhost:3500/admin/custodian-wallets -X POST \
  -H 'Content-Type: application/json' \
  -d '{"assetNo":"AS...","role":"C_VIBAN","customerNo":"CU..."}' | jq .
```

确认返回的 wallet 中 bankName/accountName 与 CMA 一致。

- [ ] **Step 4: 启动 Admin 前端，视觉验证表单**

```bash
cd admin-web && npm run dev -- --port 3501
```

打开 http://localhost:3501，创建 CMA 和 vIBAN，确认字段展示正确。

- [ ] **Step 5: Commit 验证结果 (如有修复)**

Documentation updated: implementation plan written.
