# 客户端黑白模式 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户端加浅色模式（乙版亮白净）：fx token 改 CSS 变量单一来源双色板，默认深色，状态栏日/月切换钮。

**Architecture:** 照搬 admin-web 成熟模式——`:root` 放浅色 RGB 三元组、`.dark` 覆盖为现深色原值、Tailwind 具名色引变量；ThemeContext 现成基础设施只改默认值；index.html 预置 class 防首帧闪白。

**Tech Stack:** Tailwind CSS（darkMode:'class'）+ CSS 变量 ｜ React ThemeContext（现成）

**Spec:** `doc-final/superpowers/specs/2026-09-15-client-dark-light-theme-design.md`（乙版 token 对照表 §3 为色值权威，本计划不重抄全表）

## Global Constraints

- **深色零变化是硬验收**：切到深色的每一页与改造前逐像素同观感——token 改造不许顺手调深色值；`.dark` 块是既有视觉的封存件
- 浅色值以 spec §3 表为起点，截图走查后允许微调，**调色只动 `:root` 浅色块**
- 仅 client-web；admin-web 零改动；legacy 具名色（brand-*/fin-* 7 个，实测全仓 .tsx 零消费）**不动**（零引用纪律：留账不顺手删）
- UI 零中文；不加防御性校验/性能优化
- 闸：每任务 `cd client-web && npx tsc -b --noEmit` + 根下 `npm run test:client`（91 例）全绿；闸⑤截图由控制者亲自执行（含深色零变化对比与双模式走查）
- 执行环境：worktree（EnterWorktree，命令拆单条——复合 bash 会被隔离守卫拒）

**现状事实（已核，动笔前自行复核）**：`client-web/src/index.css:5-20` `:root` 现存 13 个 `--fx-*` hex/rgba + `color-scheme: dark` 写死；`tailwind.config.js:12-24` 13 个 fx-* hex 字面量（与变量两处手写同步）+ `:26-33` legacy 7 个；`index.css @layer` 里 ~10 处直接 `var(--fx-*)` 消费（变量重定义自动跟随）；`ThemeContext.tsx` 完整（localStorage + `.dark` class + toggleTheme），默认回退 `prefers-color-scheme`；状态栏在 `CustomerDashboardLayout.tsx`（:57 DXB 时钟，~:278 头像 initials）；游离硬编码仅 `CustomerRegister.tsx:639` `stroke="#0B0908"`。

---

### Task 1: token 单一来源化 + 乙版双色板

**Files:**
- Modify: `client-web/src/index.css`（:root/.dark 双色板 + color-scheme）
- Modify: `client-web/tailwind.config.js`（fx-* 13 色改引变量；vignette/hairline 变量化）
- Modify: `client-web/src/pages/CustomerRegister.tsx:639`（stroke 收 token）

**Interfaces:**
- Produces: 全站 fx-* 具名色随 `.dark` class 自动换肤；Task 2 只管切 class

- [ ] **Step 1: index.css 双色板**——`:root` 改为**浅色**（值取 spec §3「浅色」列，RGB 三元组格式，如 `--fx-obsidian: 250 250 247;`）+ `color-scheme: light`；新增 `.dark { ... }` 块放**现深色原值**（同样转三元组，逐个从现 hex 机械换算，换算错一个深色就变——换算完用工具校验：`node -e "console.log(parseInt('0B',16),parseInt('09',16),parseInt('08',16))"` 逐色核对）+ `color-scheme: dark`。`--fx-rule`/`--fx-rule-strong` 带 alpha，保持完整 rgba 值形态（浅色 `rgba(26,25,22,.09)/.16`、深色现值原样），不转三元组。新增两个整值变量：`--fx-vignette-color`（浅 `rgba(250,250,247,0.6)` ｜ 深 `rgba(11,9,8,0.6)` 现值）、`--fx-grain-opacity`（浅 `0` ｜ 深 `1`——浅色纹理走查再定，先给关闭起点，spec §3.3）。body 的 `background-image`（index.css @layer base 里的内联 grain SVG）套 `opacity` 不可行（是 background）——改法：给 body 的 grain 挪到 `body::before` 伪元素铺层（`position:fixed; inset:0; pointer-events:none; z-index:0; opacity:var(--fx-grain-opacity)`），页面根容器保证 `position:relative; z-index:1`（App 根已有定位容器则不必动，现场核）。
- [ ] **Step 2: tailwind.config.js 引变量**——13 个 fx-* 改 `'fx-obsidian': 'rgb(var(--fx-obsidian) / <alpha-value>)'` 形态；`'fx-rule': 'var(--fx-rule)'`（整值）；`boxShadow.fx-hairline` 改 `inset 0 0 0 1px var(--fx-rule)`；`backgroundImage.fx-vignette` 改 `radial-gradient(ellipse at center, transparent 0%, var(--fx-vignette-color) 100%)`；`fx-brass` shadow 里两处 rgba(200,155,60,…) 改 `rgb(var(--fx-brass) / 0.3)`/`/ 0.4)` 形态（Tailwind 配置串里直接写 CSS 函数即可）；`fx-grain` 的 backgroundImage 定义保留（消费点挪到 ::before）。legacy 7 色一行不动。
- [ ] **Step 3: CustomerRegister.tsx:639** `stroke="#0B0908"` 改 `stroke="rgb(var(--fx-obsidian))"`——语义存疑就现场看这枚 SVG 是画在什么底上（若是画在 brass 按钮上的深色图形，浅色下该跟 obsidian 还是固定深色由观感定，报告里说明选择）。
- [ ] **Step 4: 闸** `cd client-web && npx tsc -b --noEmit` + 根下 `npm run test:client` 91 例全绿。
- [ ] **Step 5: Commit** `feat(黑白模式): fx token 单一来源双色板——:root 乙版浅色+.dark 封存现深色,vignette/hairline/grain 变量化`

**⚠️ 本任务收尾即请控制者跑「深色零变化」对比**：worktree 栈起 client，`.dark` 状态下关键页截图 vs 改前——发现色差即回炉（三元组换算错/漏改消费点）。

---

### Task 2: 默认深色 + 状态栏切换钮 + 防闪白

**Files:**
- Modify: `client-web/src/context/ThemeContext.tsx`（默认值）
- Modify: `client-web/index.html`（预置 class 防 FOUC）
- Modify: `client-web/src/components/CustomerDashboardLayout.tsx`（状态栏钮）

- [ ] **Step 1: 默认深色**——ThemeContext useState 初始化：`return saved === 'light' ? 'light' : 'dark';`（删 prefers-color-scheme 回退，业主拍板不跟随系统；注释一句说明）。
- [ ] **Step 2: 防首帧闪白**——`index.html` 的 `<html>` 直接写 `class="dark"`，并在 `<head>` 最前加内联脚本：`<script>try{if(localStorage.getItem('theme')==='light')document.documentElement.classList.remove('dark')}catch(e){}</script>`——bundle 加载前定妆，两个方向都无闪（深色默认党无闪白、浅色党无闪黑）。
- [ ] **Step 3: 状态栏钮**——`CustomerDashboardLayout.tsx` DXB 时钟（:57 一带）与头像之间插一枚图标钮：lucide `Sun`/`Moon`（浅色显 Moon 提示可切深、深色显 Sun？不——mockup 定稿是**当前深色显月亮**图形；实现取「点它切到对方」语义：深色态显 `Sun`（点了变亮）、浅色态显 `Moon`，`aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}`），`onClick={toggleTheme}`，样式对齐邻位图标（`text-fx-dust hover:text-fx-brass`）。`useTheme()` 从 ThemeContext 取。
- [ ] **Step 4: 闸** tsc + vitest 全绿。
- [ ] **Step 5: Commit** `feat(黑白模式): 默认深色+index.html 预置 class 防闪+状态栏日月切换钮`

---

### Task 3: 双模式走查定稿（控制者亲自执行）

- [ ] **Step 1: 深色零变化终验**——登录页/Overview/三交易页/任一详情页深色截图与合并前基线肉眼比对（Task 1 已比过一轮，Task 2 后复扫一遍防连带）。
- [ ] **Step 2: 浅色走查**——同一组页面切浅色逐页截图：金色 on 白、弱文字 on 底两处对比度重点；grain 纹理按 §3.3 二选一定稿（`--fx-grain-opacity` 浅色给 0 还是调亮矩阵）；发现刺眼处微调 `:root` 值（只动浅色块）。
- [ ] **Step 3: 行为三验**——无 localStorage 首访=深色｜点钮切浅+刷新仍浅｜再点切回；`grep -rn "#[0-9a-fA-F]\{6\}" client-web/src --include='*.tsx'` 业务页零命中。
- [ ] **Step 4: 浅色板截图发业主过目**（乙版 mockup 是起点，实机定稿），微调后复扫。
- [ ] **Step 5: 收尾闸**——demo:all 不受影响（纯前端）但照跑（worktree 栈铺数已含）；`rules/frontend-client.md` 若有颜色/主题约定段落补一句 token 单一来源纪律（delivery-checklist 对照）；合并时 CHANGELOG 一行。

## Self-Review 记录

- Spec 覆盖：§2 机制四点→T1｜§3 色板+3.3 纹理→T1+T3 定稿｜§4 默认与钮→T2｜§5 验收→T1 尾+T3。新增 spec 未涵盖项一处：index.html 预置 class 防 FOUC（首帧闪白是演示可见缺陷，属 §4 默认深色的落地必需件，非范围蔓延）。
- 占位扫描：无 TBD；grain 的「二选一」带决策规则与走查时机（spec §3.3 原文如此）。
- 类型一致性：ThemeContext 现有 `Theme = 'light' | 'dark'` 不变；T2 只改初始化表达式。
