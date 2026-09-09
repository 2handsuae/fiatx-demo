# 第二幕迎客收尾轮：客户端快捷登录 + 客户可见面清账 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户端登录页做出与 admin 同款的 Quick login 面板（11 位种子客户一键登录），删掉 AuthGuard 里守着不存在路由的死守卫，并按业主 2026-09-08 逐条裁定把 BACKLOG §C 清账收口——第二幕只剩销户清退挂账。

**Architecture:** 纯前端 + 纯文档轮。client-web 只动两个文件（`CustomerLogin.tsx` 加面板、`AuthGuard.tsx` 删死块）；后端、schema、种子代码零改动。文档动三处：BACKLOG（4 销 2 迁 + 导语 + ⭐ 计数）、demo/script.md（环境行）、demo/data.md（客户矩阵 9→11 位 + quick login 一句）。设计脑暴与业主裁定见本轮会话，未单独落 spec（业主拍板直接进 plan）。

**Tech Stack:** React + framer-motion + lucide-react（client-web 既有栈），fx-* 设计 token（杂志风，见 `client-web/src/index.css`）。

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - **零后端改动**——`src/` 一行不许碰；发现"顺手修后端"冲动一律登记 BACKLOG/PRODUCTION-NOTES
  - 改了前端 → **preview 渲染 + 截图**验证，tsc 过不算数（永不豁免条 ①；本轮不动钱，条 ② 不触发）
  - 快捷登录面板的人设标签是**演示选角信息**（与 admin 登录页 Quick Login 同一先例：面板本身就是演示装置，观众是演示者不是真客户）——Carol 标 "Sanctioned · silent" 是刻意决定，评审不当 tipping-off 缺陷判
  - 执行在 worktree 隔离（`.claude/worktrees/act2-wrapup-quick-login/`，分支 `feat/act2-wrapup-quick-login`），栈用 self；`demo:*` 类脚本一律 `bash scripts/on-stack.sh self <script>`
  - 每条 npm/npx 命令前确认 `node -v` ≥ 20（本机已归一 v20.20.2，若见 v18 前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`）
  - client-web 无 React 组件测试基建（历史事实），两个组件的行为验证 = tsc + 截图走查，**不新写 .spec.tsx**
  - 派 subagent 时任务 prompt 带上 CLAUDE.md §0–§5 要点；任务执行/评审 → `sonnet`，终审 → 主会话（Fable）

**Files（全轮总览）:**
- Modify: `client-web/src/pages/CustomerLogin.tsx`（Task 1）
- Modify: `client-web/src/components/AuthGuard.tsx`（Task 2）
- Modify: `doc-final/BACKLOG.md`、`doc-final/demo/script.md`、`doc-final/demo/data.md`（Task 3）
- Modify: `doc-final/CHANGELOG.md`（Task 4，合并前）

**环境预备（执行开场，不算任务）:** worktree 内 `bash scripts/stack.sh reset` 从零建库（自动分端口记 `.stackports`），起栈后确认客户端端口可访问。种子客户与材料请求都来自 reset（`seed.business.ts`），不依赖 `demo:all`。

---

### Task 1: 客户端 Quick login 面板

**Files:**
- Modify: `client-web/src/pages/CustomerLogin.tsx`

**Interfaces:**
- Consumes: 既有 `POST /auth/customer/login`（body `{email, password}`，成功回 `{access_token}`）；`useAuth().refreshProfile`
- Produces: 页面内常量 `SEED_CUSTOMERS`、函数 `doLogin(loginData)` / `handleQuickLogin(account)`、state `quickOpen`（后续任务不依赖，仅本文件）

- [ ] **Step 1: 改 imports 与新增常量**

顶部 imports 改为（新增 `Zap`/`X` 与 `AnimatePresence`）：

```tsx
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Zap, X } from 'lucide-react';
```

`MASTHEAD` 常量块之后新增（人设标签 = 演示选角信息，与 `prisma/seed.business.ts` 的 `DEMO_CUSTOMERS` 一一对应，11 位，密码统一 123456）：

```tsx
/* 演示选角面板的账号清单——与 prisma/seed.business.ts DEMO_CUSTOMERS 对齐（11 位，密码全 123456）。
 * 人设标签是给演示者看的选角信息（与 admin 登录页 Quick Login 同一先例），不是客户面业务文案。 */
type SeedCustomer = { name: string; email: string; persona: string };

const SEED_CUSTOMERS: SeedCustomer[] = [
  { name: 'Alice Happy',    email: 'demo_alice@example.com', persona: 'Active · happy path' },
  { name: 'Bob Happy',      email: 'demo_bob@example.com',   persona: 'Active · happy path' },
  { name: 'Carol Silent',   email: 'demo_carol@example.com', persona: 'Sanctioned · silent' },
  { name: 'Dave Pending',   email: 'demo_dave@example.com',  persona: 'In verification' },
  { name: 'Eve New',        email: 'demo_eve@example.com',   persona: 'Just registered' },
  { name: 'Frank HighRisk', email: 'demo_frank@example.com', persona: 'High risk · EDD' },
  { name: 'Grace Premium',  email: 'demo_grace@example.com', persona: 'Premium tier · VIP fees' },
  { name: 'Henry Acme',     email: 'demo_acme@example.com',  persona: 'Corporate · Acme Trading LLC' },
  { name: 'Ivy Restricted', email: 'demo_ivy@example.com',   persona: 'Material expired · restricted' },
  { name: 'Jack Trader',    email: 'demo_jack@example.com',  persona: 'Active trader' },
  { name: 'Kate Trader',    email: 'demo_kate@example.com',  persona: 'Active trader' },
];
```

- [ ] **Step 2: 抽出 doLogin、加 handleQuickLogin 与弹窗 state**

组件内新增 state（与既有 state 并列）：

```tsx
const [quickOpen, setQuickOpen] = useState(false);
```

Escape 关弹窗（新增一个 useEffect，与既有 toast useEffect 并列）：

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setQuickOpen(false); };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, []);
```

把现 `handleSubmit` 的请求段抽成 `doLogin`，`handleSubmit` 只负责拼 body（**错误处理逐字保留**，包括 `CUSTOMER_ACCOUNT_CLOSED` 转 toast 那支）：

```tsx
const doLogin = async (loginData: Record<string, string>) => {
  setIsLoading(true);
  setError('');
  try {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginData),
    });
    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('customer_token', data.access_token);
      await refreshProfile();
      navigate('/profile');
    } else {
      const err = await response.json().catch(() => ({}));
      const code = String(err?.code || '').trim().toUpperCase();
      if (code === 'CUSTOMER_ACCOUNT_CLOSED') {
        setError('');
        setToastMessage('This account has been closed.');
      } else {
        setError(
          typeof err?.message === 'string' && err.message ? err.message : 'Login failed',
        );
      }
    }
  } catch {
    setError('Network error. Please try again.');
  } finally {
    setIsLoading(false);
  }
};

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  const loginData: Record<string, string> = { password: formData.password };
  if (method === 'email') {
    loginData.email = formData.email.trim();
  } else {
    loginData.phone = formData.phone.trim();
  }
  await doLogin(loginData);
};

const handleQuickLogin = async (account: SeedCustomer) => {
  setQuickOpen(false);
  setMethod('email');
  setFormData((prev) => ({ ...prev, email: account.email, password: '123456' }));
  await doLogin({ email: account.email, password: '123456' });
};
```

- [ ] **Step 3: 入口按钮 + 弹窗 JSX**

Password 行的 label 行（现 `<label className="fx-cap">Password</label>` + `Forgot?` 那个 `justify-between` div）改为右侧两个链接：

```tsx
<div className="flex items-center justify-between mb-3">
  <label className="fx-cap">Password</label>
  <div className="flex items-center gap-5">
    <button
      type="button"
      onClick={() => setQuickOpen(true)}
      className="fx-cap inline-flex items-center gap-1.5 text-fx-brass hover:text-fx-ember transition-colors"
    >
      <Zap size={10} />
      Quick login
    </button>
    <a href="#" className="fx-cap text-fx-dust hover:text-fx-brass transition-colors">
      Forgot?
    </a>
  </div>
</div>
```

根 div 收尾 `</div>`（`</main>` 之后、组件 return 的最外层闭合前）插入弹窗——视觉走 client 杂志风（obsidian 面板 + brass 顶线 + hairline 分隔），**不抄 admin 的琥珀终端风**：

```tsx
{/* ── Demo quick login（演示选角面板，与 admin 登录页 Quick Login 同一先例）── */}
<AnimatePresence>
  {quickOpen && (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={() => setQuickOpen(false)}
      />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.22, ease: [0.19, 1, 0.22, 1] }}
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      >
        <div className="pointer-events-auto w-full max-w-md mx-4 bg-fx-obsidian border border-fx-rule">
          <div className="h-[2px] bg-fx-brass" />
          <div className="flex items-center justify-between px-6 py-4 border-b border-fx-rule">
            <div className="flex items-center gap-2">
              <Zap size={11} className="text-fx-brass" />
              <span className="fx-cap text-fx-sand">Demo quick login</span>
            </div>
            <button
              onClick={() => setQuickOpen(false)}
              className="text-fx-dust hover:text-fx-sand transition-colors"
              aria-label="Close quick login"
            >
              <X size={14} />
            </button>
          </div>
          <div className="px-6 py-2 border-b border-fx-rule bg-fx-brass/5">
            <span className="fx-cap text-fx-brass/80">All accounts · password 123456</span>
          </div>
          <div className="p-2 max-h-[60vh] overflow-y-auto">
            {SEED_CUSTOMERS.map((account) => (
              <button
                key={account.email}
                onClick={() => void handleQuickLogin(account)}
                className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-fx-rule/20 transition-colors group"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-3">
                    <span className="fx-serif text-[14px] text-fx-sand">{account.name}</span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-brass">
                      {account.persona}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-fx-dust truncate mt-0.5">{account.email}</div>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-fx-dust group-hover:text-fx-brass transition-colors">
                  →
                </span>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </>
  )}
</AnimatePresence>
```

- [ ] **Step 4: tsc 闸③**

Run: `cd client-web && npx tsc -b --noEmit && cd ..`
Expected: 零输出零错误

- [ ] **Step 5: preview 截图验证（永不豁免）**

self 栈已起（见环境预备）。走查并**截图落盘**（`.superpowers/` 或任务报告附图）：
1. 打开客户端 `/login` → 截图 ①：Password 行右侧出现 "⚡ Quick login" 入口，风格与页面协调
2. 点开面板 → 截图 ②：11 位账号齐、人设标签与邮箱可读、密码提示行在
3. 点 Alice Happy → 截图 ③：真登入、落 `/profile`，Alice 档案渲染
4. 回登录页点 Dave Pending → 截图 ④：落 lifecycle gate 页（"Verification in progress"）——证明快捷登录对非 ACTIVE 人设同样如实呈现
5. Escape 与点遮罩能关面板（行为确认，不必截图）

Expected: 四图齐、无 console 报错（`read_console_messages` 复核）

- [ ] **Step 6: Commit**

```bash
git add client-web/src/pages/CustomerLogin.tsx
git commit -m "feat(client): 登录页 Quick login 面板——11 位种子客户一键登录（演示选角）"
```

---

### Task 2: AuthGuard 死守卫删除（/wallet/send）

**Files:**
- Modify: `client-web/src/components/AuthGuard.tsx`

**Interfaces:**
- Consumes: 无（独立清理）
- Produces: 无——纯删除；`isApproved` 分支其余逻辑（trading-readiness 门等）逐字不动

**背景（写给执行者）**：`/wallet/send` 路由全仓不存在（`client-web/src/App.tsx` 只注册了 `/wallet`），也无任何入口链向它（`grep -rn "wallet/send" client-web/src` 仅 AuthGuard 一处命中）。这段重定向是守着一扇不存在的门的死代码，业主裁定清理。

- [ ] **Step 1: 删守卫块、收口注释**

把 `AuthGuard.tsx` 的这一段（`isApproved` 分支开头，含注释与 if 块）：

```tsx
    // RESTRICTED（parity 2026-08-14 定稿，本轮沿用）：受限能力的页面【不再重定向】——
    // Swap/Withdraw 页自禁按钮 + RestrictionBanner 逐条提示（业主拍板：页面基本不动）。
    // 唯一保留的重定向是 /wallet/send（该页没有禁用 UI，放进去会裸奔）。
    // 后端 L1 门（CAPABILITY_RESTRICTED）原样在——这里只是体验层。
    // 判据来自 disclosedBlocked：SILENT 便签前端拿不到，被制裁客户在这里与正常
    // 客户完全同路，不会因为多一次跳转而暴露调查（tipping-off）。
    if (isCapabilityRestricted(user, 'WITHDRAW')) {
      const p = '/wallet/send';
      if (location.pathname === p || location.pathname.startsWith(`${p}/`)) {
        return <Navigate to="/profile" replace />;
      }
    }
```

整体替换为（政策陈述保留，例外句随死路由删除）：

```tsx
    // RESTRICTED（parity 2026-08-14 定稿）：受限能力的页面一律【不重定向】——
    // Swap/Withdraw 页自禁按钮 + RestrictionBanner 逐条提示（业主拍板：页面基本不动）；
    // 后端 L1 门（CAPABILITY_RESTRICTED）原样在，前端只是体验层。
```

- [ ] **Step 2: 清孤儿 import**

删除后 `Navigate` 与 `isCapabilityRestricted` 在本文件再无使用（删前 grep 确认），两处 import 同步收口：

```tsx
import { useNavigate, useLocation } from 'react-router-dom';
```

并整行删除：

```tsx
import { isCapabilityRestricted } from '../utils/restrictedCapabilities';
```

（`useLocation` 仍被 readiness 门与 `/onboarding/verify` 分支使用，保留。）

- [ ] **Step 3: tsc 闸③**

Run: `cd client-web && npx tsc -b --noEmit && cd ..`
Expected: 零输出零错误（若报 unused 之外的错，说明删多了——回看 Step 1 的替换范围）

- [ ] **Step 4: 回归截图（顺证 BACKLOG 双横幅销账）**

用 Task 1 的面板点 **Ivy Restricted** 登录 → 进 Withdraw 页 → 截图 ⑤：
- 页面正常渲染（AuthGuard 改动无回归）
- 顶部对 Ivy 的材料过期事项**只有一组卡片、不重复**（材料请求卡带 CTA，或未被认领的限制卡显 Contact support——两者不同时对同一事项出现）：这张图就是 BACKLOG「双横幅重复」条实证已修（`f67a9629`）的销账证据，Task 3 引用

Expected: 截图 ⑤ 落盘，console 无报错

- [ ] **Step 5: Commit**

```bash
git add client-web/src/components/AuthGuard.tsx
git commit -m "chore(client): 删 AuthGuard 里守着不存在路由 /wallet/send 的死守卫"
```

---

### Task 3: BACKLOG 清账 + 演示文档同步

**Files:**
- Modify: `doc-final/BACKLOG.md`
- Modify: `doc-final/demo/script.md`
- Modify: `doc-final/demo/data.md`

**Interfaces:**
- Consumes: Task 2 的截图 ⑤（双横幅销账实证）
- Produces: 无

**业主 2026-09-08 逐条裁定（本任务的唯一依据，不许自行增删）**：/wallet/send 清理销账 ｜ 双横幅实证已修销账 ｜ 豁免位作废删除（材料与评分都在 Sumsub，豁免不归我方）｜ 客户列表限制筛选清理删除 ｜ 订单级折叠迁 §F ｜ CAPABILITY_RESTRICTED 区分迁 §D ｜ 销户两条与机构 stub 条原地不动。

- [ ] **Step 1: BACKLOG §C 删四条、迁两条**

从 §C 整条删除（原文以现 HEAD 为准，按条目首句定位）：
1. 「客户列表的「限制」筛选只作用于当前页」（①静态矩阵 节）
2. 「Swap/Withdraw 页 `PendingActionBanner` 与 `RestrictionBanner` 对同一条挂限制的材料请求各显示一张卡」（销户与材料 节）
3. 「**豁免位有效期**」（销户与材料 节）
4. 「⭐ **`AuthGuard` 里 `/wallet/send` 的受限重定向守着一条不存在的路由**」（便签联动 节）

迁移两条（**原文整段照搬，只在来源栏尾追加** `；2026-09-08 业主裁定归订单域，自第二幕迁入`）：
- 「Q1 制裁客户的订单级折叠未做」→ §F（第五幕·钱出），插在 ⭐「规则 A（tipping-off 防线）只在充值域落实」条**之后**（两条台账本就写着同源一并排期）
- 「`CAPABILITY_RESTRICTED` 挂起原因区分不出 SANCTION 与 ADMIN_SUSPENSION」→ §D（第三幕·钱进）「四条弧与详情页」小节，插在「`LIFECYCLE_NOT_ACTIVE` 挂起的单…」条**之后**（同属 L1 挂起族）

迁删完成后「**便签联动（tipping-off）**」小节已空，**小节标题一并删除**。

- [ ] **Step 2: BACKLOG 导语、计数与销账区**

- §C 导语（`> 讲「客户是谁、能不能交易由合规说了算」…` 行）改为：

```markdown
> 讲「客户是谁、能不能交易由合规说了算」这一幕的缺口。入驻（波二）与档位升级（波三）已重建完成销账；2026-09-08 收尾轮清掉客户可见面小账（快捷登录上线、横幅重复实证已修、坏路由删除），两条挂起可见性缺口归订单域（§D/§F）。剩销户清退挂账（业主裁定暂不做）。
```

- 文件头「**⭐ = 带同事走七幕时会当场看到或讲不圆的**，共 16 条」→ **共 15 条**（本轮删了 ⭐ 坏路由条；迁移两条均非 ⭐）
- `Last Updated: 2026-09-08` 保持（同日）
- 在「## 本轮销账（2026-09-08 按演示动线重排，已勾条目整批归档）」**之前**新增一节：

```markdown
## 本轮销账（2026-09-08 第二幕收尾轮）

- [x] ⭐ `AuthGuard` 里 `/wallet/send` 的受限重定向守着一条不存在的路由 —— 死代码随本轮删除；实证：路由表无注册、全仓无入口（`grep -rn "wallet/send" client-web/src` 仅 AuthGuard 一处命中）
- [x] Swap/Withdraw 页 `PendingActionBanner` 与 `RestrictionBanner` 重复卡 —— 陈账：实际早已修复于 `f67a9629`（RestrictionBanner 按 `claimedByMaterialRequestNo` 过滤被材料请求认领的便签，余下行一律 Contact support），本轮 Ivy 走查截图复证后销账
- [x] 豁免位有效期（poa/questionnaires 提交时间戳待验）—— 2026-09-08 业主裁定作废：材料收取与画像评分都在 Sumsub 侧，豁免机制不归我方系统
- [x] 客户列表「限制」筛选只作用于当前页 —— 2026-09-08 业主裁定清理：demo 规模下的已知取舍成立（footer 已明示范围），不再挂账
```

- [ ] **Step 3: script.md 环境行**

`**环境**：` 段中「管理台 admin@fiatx.com / 123456；客户端用 demo_* 种子客户（见 data.md）。」改为：

```markdown
管理台 admin@fiatx.com / 123456（登录页 Quick Login 面板可一键切 8 职务）；客户端用 demo_* 种子客户（见 data.md）——客户端登录页同样有 Quick login 面板，11 位种子客户一键登录，剧本里所有「切客户端 demo_*」步骤都可走它。
```

- [ ] **Step 4: data.md 客户矩阵补 Jack/Kate + quick login 一句**

- 节标题「## 客户矩阵（business seed，9 位，覆盖 8 种状态位）」→ **11 位**
- 导语段「7 位 ACTIVE 客户开户日已回填」→ **9 位**；「其余 5 位 ACTIVE 客户落 `basic-cdd-level`」→ **其余 7 位**（Jack/Kate 均 ACTIVE + basic 档，实证见 `prisma/seed.business.ts` DEMO_CUSTOMERS）
- 表格补两行（Ivy 行之后）：

```markdown
| Jack Trader | 快乐路径（对账素材） | 第六幕破口场景的钱包与流水素材 |
| Kate Trader | 快乐路径（对账素材） | 同上——MATCHED 桶的干净代表 |
```

- 表格之后补一句：

```markdown
客户密码统一 123456；客户端登录页 Quick login 面板列全 11 位、点击一键登录（2026-09-08 第二幕收尾轮，演示选角不再手输邮箱）。
```

- [ ] **Step 5: 自查与 Commit**

自查：`grep -n "wallet/send\|豁免位\|限制」筛选" doc-final/BACKLOG.md` → 应只剩销账区四行里的命中；`grep -c "⭐" doc-final/BACKLOG.md` 与改后计数一致性人工目视。

```bash
git add doc-final/BACKLOG.md doc-final/demo/script.md doc-final/demo/data.md
git commit -m "docs(第二幕收尾): BACKLOG §C 清账 4 销 2 迁 + demo 文档同步 Quick login 与 11 位客户矩阵"
```

---

### Task 4: 收尾闸 + CHANGELOG（主会话执行，不派 subagent）

**Files:**
- Modify: `doc-final/CHANGELOG.md`

- [ ] **Step 1: 三闸 tsc 全绿**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
```

Expected: 三条全零输出（后端与 admin 本轮零改动，跑闸是防误伤）

- [ ] **Step 2: 收尾闸⑥ demo:all（self 栈）**

```bash
bash scripts/on-stack.sh self demo:all
```

Expected: 花名册 29/29 全绿 + COA 恒等式全绿（本轮零后端改动，此闸是保险不是验收对象；若红，先查是否撞上 BACKLOG §A 已登记的 1/13 偶发失衡——复跑一次区分，勿当本轮回归追）

- [ ] **Step 3: 截图清点**

确认五张截图齐：① 登录页入口 ② 面板 11 位 ③ Alice 登入 profile ④ Dave 落 gate 页 ⑤ Ivy Withdraw 单组卡。缺哪张回对应任务补。

- [ ] **Step 4: CHANGELOG 一行**

`doc-final/CHANGELOG.md` 顶部按现有格式加：

```markdown
- [2026-09-08] **第二幕收尾轮：客户端快捷登录 + 客户可见面清账** —— 观众能感知的变化是：客户端登录页出现与管理台同款的 Quick login 面板，11 位种子客户带人设标签（快乐路径/制裁静默/认证中/高风险 EDD/机构/材料受限/对账素材…）一键登录，演示选角不再手输邮箱。顺手删掉 AuthGuard 里守着不存在路由 `/wallet/send` 的死守卫。BACKLOG §C 按业主逐条裁定收口：4 销（坏路由随删、横幅重复实证已修于 f67a9629、豁免位与限制筛选裁定作废）、2 迁订单域（订单级折叠 →§F、挂起原因带 cause →§D）——第二幕自此只剩销户清退挂账。零后端改动。
```

```bash
git add doc-final/CHANGELOG.md
git commit -m "docs(CHANGELOG): 第二幕收尾轮一行"
```

- [ ] **Step 5: 交业主**

按 superpowers:finishing-a-development-branch 报告：分支就绪、五截图、闸门全绿，合并方式（ff into main）等业主拍板。合并后无需 db:base:sync/reset（零后端零 schema 零权限改动），worktree + 分支照章清理。收尾报告行：`Documentation updated: demo / none — BACKLOG §C 收口 + demo 两篇同步，modules 层零改动`

---

## 本任务过哪几条（delivery-checklist 判定，由 plan 写死）

| 清单行 | 判定 |
|---|---|
| 改了前端 → preview + 截图 | **触发**——五张截图，Task 1/2 产出、Task 4 清点 |
| 改页面 → 同步 demo/data.md + script.md | **触发**——Task 3（生成区不碰，只动手写区） |
| 每轮收尾 → 分层收口 + CHANGELOG + BACKLOG | **触发**——Task 3/4 |
| 新字段/新状态到客户面 → tipping-off 决定 | **当场决定并记录**：快捷登录人设标签是演示选角信息（admin 同先例），非客户面业务数据——见 Global Constraints |
| 其余行（审计/状态机/动钱/审批/权限/端点/事件/schema/三域） | **不触发**——零后端改动 |
