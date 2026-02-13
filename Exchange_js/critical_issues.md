# 关键问题详细说明文档

## 1. 前端运行时崩溃风险 (Undefined Function)
在 `admin-web/src/pages/DepositTransactionList.tsx` 中，多处调用了 `copyToClipboard` 函数，但该函数在该文件及导入中均未定义。
- **位置:** `admin-web/src/pages/DepositTransactionList.tsx:325, 339, 357, 371`
- **后果:** 用户点击复制按钮时，React 应用将抛出 `ReferenceError` 并可能导致白屏。

## 2. 自动化测试失效
目前的测试套件存在大量失败，主要原因是 NestJS 测试模块配置不完整（缺少 Provider 或 Module 导入）。
- **典型错误:** `Nest can't resolve dependencies of the AuthService (?)`
- **位置:** `src/modules/auth/auth.service.spec.ts` 等多个文件。
- **后果:** 无法验证代码更改的正确性，增加了引入回归 Bug 的风险。

## 3. 前端工程化缺陷 (Hardcoded URLs)
在 `admin-web` 和 `client-web` 中发现了 60 多处硬编码的 API 请求地址。
- **模式:** `fetch('http://localhost:3000/...')`
- **后果:** 无法通过环境变量切换后端地址，导致无法直接部署到测试或生产环境。

## 4. 后端代码冗余
`generateSwapNo` 和 `generateDepositNo` 的实现逻辑几乎完全一致。
- **位置:** 
  - `src/modules/swap-transactions/swap-transactions.service.ts`
  - `src/modules/deposit-transactions/deposit-transactions.service.ts`
- **后果:** 维护成本增加，若编号生成规则变更需要修改多处。

## 5. 类型安全性缺失
虽然配置了 `no-explicit-any: error`，但代码中仍通过 `(this.prisma as any)` 等方式规避了类型检查。
- **后果:** 丧失了 TypeScript 提供的编译时安全保护。