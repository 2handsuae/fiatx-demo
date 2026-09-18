# 客户端黑白模式（默认深色 · 状态栏切换 · 乙版浅色板）· 设计稿

2026-09-15 立 ｜ 业主三拍板：切换钮放状态栏 ｜ 默认深色 ｜ 浅色板选**乙 · 亮白净**（mockup 已过目）｜ 底数来源：复检报告取数员 D §8 ｜ 顺序：**在订单详情增强之后做**（该任务全站截图基线钉完再换色）

## 0. 背景（实证现状）

client-web 的主题基础设施是"半具骨架"：`ThemeContext.tsx` 完整（localStorage + `<html>` class 切换 + `toggleTheme()` 导出，Provider 已包全站）、`tailwind.config.js` `darkMode:'class'` 开着——但全仓 **0 处 `dark:` variant、0 处 `useTheme()` 调用、只有一套深色板**，三缺一等于功能不存在。颜色已集中在 19 个 `fx-*` 具名色（游离硬编码仅 `CustomerRegister.tsx` 一处），但具名色是 **hex 字面量、与 `index.css` 的 13 个 `--fx-*` 变量两处手写同步**。admin-web 已有成熟模式：CSS 变量双色板 + `.dark` 覆盖块 + Tailwind 具名色引变量，`dark:` variant 仅 7 处——照搬。

## 1. 本任务做 / 不做

**做**：fx token 改 CSS 变量单一来源（§2）｜乙版浅色板（§3）｜默认深色 + 状态栏切换钮（§4）｜`CustomerRegister.tsx` 游离硬编码收进 token｜双模式截图走查。

**不做**：admin-web 任何改动（它有自己的主题机制）｜「跟随系统」默认（业主拍板默认深色）｜逐组件铺 `dark:` variant（admin 先例证明 CSS 变量自动响应即可，`dark:` 只留给个别非对称场景）｜浅色新插画/新纹理创作（噪点纹理按 §3.3 处理）。

## 2. 机制：token 单一来源化（主要工作量）

1. `tailwind.config.js` 19 个 `fx-*` 具名色从 hex 字面量改 `rgb(var(--fx-*) / <alpha-value>)`（admin 同款 RGB 三元组格式）；`fx-rule`/`fx-rule-strong` 这类自带透明度的改 `rgb(var(--fx-*-rgb) / 0.09)` 形态或保留独立变量，落地时取与 admin 一致的写法。
2. `index.css` `:root` 放**浅色**值（新常态基准）、`.dark {}` 覆盖为现深色板原值——**深色像素零变化**是硬验收（切到深色截图与改前逐像素同观感）。
3. `color-scheme`：`:root { color-scheme: light }`、`.dark { color-scheme: dark }`（现状写死 dark 要改）。
4. tailwind config 里引用固定 rgba 的 `boxShadow`（fx-hairline/fx-brass）、`fx-vignette` 渐变一并变量化；`fx-grain` 噪点见 §3.3。

## 3. 乙版浅色板（token 对照表，截图走查后可微调、以走查定稿）

| token | 深色（现值，进 `.dark`） | 浅色（新 `:root`） | 语义 |
|---|---|---|---|
| `--fx-obsidian` | `#0B0908` | `#FAFAF7` | 页面底 |
| `--fx-ink` | `#141110` | `#FFFFFF` | 表层 |
| `--fx-charcoal` | `#1E1A16` | `#FFFFFF`（差异靠 border + 薄影） | 卡片 |
| `--fx-shadow` | `#2A231C` | `#F1EFE9` | 悬停行 |
| `--fx-sand` | `#F5EDE0` | `#1A1916` | 主文字 |
| `--fx-dune` | `#C8B896` | `#5C574C` | 次文字 |
| `--fx-dust` | `#8B7B6A` | `#8D877A` | 弱文字 |
| `--fx-brass` | `#C89B3C` | `#9A741F` | 主点缀金 |
| `--fx-copper` | `#B07530` | `#7E5F1A` | 深悬停 |
| `--fx-ember` | `#E5B85F` | `#B08A2E` | 高亮 |
| `--fx-sage` | `#739477` | `#47714E` | 正向 |
| `--fx-rust` | `#B85A4A` | `#A6473A` | 错误 |
| `--fx-rule` | `rgba(245,237,224,.08)` | `rgba(26,25,22,.09)` | 发丝线 |
| `--fx-rule-strong` | `rgba(245,237,224,.16)` | `rgba(26,25,22,.16)` | 强分隔 |

3.3 **噪点纹理**：body 的 `fx-grain` SVG 颜色矩阵是暖白值（深底上是微光）——浅色下同一张会糊成脏色。处理：矩阵值按浅底重调成深色微粒、alpha 减半；调不出干净观感就浅色下直接去纹理（`.dark` 独享），截图走查时二选一定稿。

## 4. 默认色与切换钮

- `ThemeContext`：无 localStorage 记录时**默认 `'dark'`**（删 `prefers-color-scheme` 回退——业主拍板不跟随系统）；已有记录沿用；切换写回 localStorage（现有逻辑不动）。
- 切换钮：状态栏 DXB 时钟与头像之间（mockup 定稿位），日/月图标，调现成 `toggleTheme()`，`aria-label` 带当前模式。全站唯一入口，不进设置页。

## 5. 验收

- tsc ③ + vitest 全绿（现有 87 例不红）
- ⑤ preview 双模式截图各一轮：登录页、Overview、充值/兑换/提现三页、任一详情页（新版排布）、Profile——浅色对比度肉眼过（金色 on 白、弱文字 on 底 两处重点）
- 行为：无 localStorage 首访 = 深色｜点钮切浅色、**刷新仍浅色**｜再点切回
- **深色零变化**：切回深色与改前截图同观感（token 改造不许顺手调深色值）
- `grep -rn "#[0-9a-fA-F]\{6\}" client-web/src --include='*.tsx'` 业务页零命中（CustomerRegister 收编后）
- 收尾闸：demo:all 照跑（纯前端，防连带）

## 6. 风险

- token 改造是全站换血管：改错一个具名色映射，某页某状态会瞎——vitest 保逻辑、截图轮保观感，逐页过不抽查。
- 浅色板 spec 值是 mockup 起点，走查中允许微调；**调色只动 `:root` 浅色块**，`.dark` 是既有视觉的封存件。
