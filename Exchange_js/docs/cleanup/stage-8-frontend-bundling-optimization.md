# Stage 8: Frontend Bundling Optimization

Status: completed
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: `admin-web`, `client-web` build output and Vite chunk strategy
Supersedes: none
Depends On: `docs/cleanup/wave-3-cleanup-master-plan.md`
Source of Truth Level: cleanup-stage

## Current Debt
- 本阶段已完成后，`admin-web` 与 `client-web` 的 large chunk warning 已通过页面级路由懒加载消除。
- 当前未再识别出必须立即处理的 bundling debt；若后续页面继续膨胀，再单独评估新的 chunk 策略。

## Target End State
- `admin-web` 与 `client-web` build 继续通过，且 large chunk warning 明显下降或消失。
- 首屏加载路径不因无关页面和重依赖而被过度放大。

## In Scope
- 首页级路由懒加载。
- Vite `manualChunks` 评估与拆分。
- vendor / approvals / charts / editor / export 等大依赖的 chunk 策略。

## Out Of Scope
- 业务逻辑修改。
- schema 或 contract 变更。
- 物理 rename。

## Preconditions
- Stage 6 / Stage 7 不再阻塞前端路由与页面语义。
- `admin-web` 与 `client-web` 当前 build 均稳定通过。

## Implementation Notes
- 本轮已完成：
  - `admin-web/src/App.tsx` 页面级路由已切到 `React.lazy + Suspense`
  - `client-web/src/App.tsx` 页面级路由已切到 `React.lazy + Suspense`
- 懒加载后两端构建 warning 已消失，因此本轮未引入 `manualChunks`。
- 必须避免为消 warning 而引入路径、权限、SEO、hydration 或路由行为回归。
- 后续仅当新的 large chunk warning 重新出现时，再评估 `manualChunks`。

## Acceptance / Exit Criteria
- `admin-web` build 通过，且 large chunk warning 已消失。
- `client-web` build 通过，且 large chunk warning 已消失。
- 页面路径、权限行为和主交互不回归。

## Blockers / Rollback Note
- 若 chunk 拆分导致首屏、登录、权限路由或关键页面异常，应优先回退 chunk 策略，而不是带着 warning 消失但行为退化的实现合入。
