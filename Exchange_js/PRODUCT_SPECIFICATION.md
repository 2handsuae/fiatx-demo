# Product Specification: FIATX Digital Asset Exchange & Financial System
# 产品介绍文档：FIATX 数字资产交易与财务管理系统

---

## 1. Project Positioning | 项目定位
**English:**
The **FIATX Digital Asset Exchange & Financial System** is a next-generation enterprise platform designed for digital asset management, high-frequency trading, and automated financial reconciliation. Unlike traditional exchanges that rely on disconnected ledger systems, FIATX features an integrated **Automated Financial Core**. Its core value lies in providing **unparalleled financial transparency, operational efficiency, and business agility** through a unified, event-driven architecture that links every transaction directly to a double-entry accounting ledger.

**中文：**
**FIATX 数字资产交易与财务管理系统**是一款集资产管理、高频交易与自动化财务对账于一体的下一代企业级平台。与传统交易平台将业务逻辑与财务系统割裂的设计不同，FIATX 核心集成了**自动化财务引擎**。其核心价值在于通过统一的事件驱动架构，将每一笔业务操作与双录会计准则直接挂钩，为企业提供**极致的财务透明度、运营效率与业务敏捷性**。

---

## 2. Core Functionality Breakdown | 核心功能拆解

### I. Unified Asset Gateway | 全场景资产网关
*   **Description:** Manages the full lifecycle of multi-currency assets (both Fiat and Crypto). It handles complex wallet orchestration, real-time balance tracking, and secure deposit/withdrawal workflows.
*   **Business Value:** Solves the problem of fragmented asset management. It ensures that funds are accurately tracked from the moment they enter the platform until they are withdrawn, reducing the risk of fund leakage and improving user trust.

*   **功能描述：** 管理多币种资产（法币与虚拟币）的全生命周期。涵盖复杂的钱包编排、实时余额追踪以及安全的充值/提现工作流。
*   **业务价值：** 解决资产管理碎片化痛点。确保资金从进入平台到提取的每一步都受到严密追踪，降低资金流失风险并提升用户信任。

### II. Atomic Swap Engine | 原子化交易引擎
*   **Description:** A high-performance internal exchange module that allows users to swap assets (e.g., USDT to BTC) instantly.
*   **Business Value:** Eliminates the risk of partial transactions or inconsistent states. By ensuring "atomicity" (the transaction either succeeds completely or fails completely), it protects the platform from technical arbitrage and ensures a seamless, high-speed trading experience for users.

*   **功能描述：** 高性能内部兑换模块，允许用户瞬间完成资产兑换（如 USDT 兑换 BTC）。
*   **业务价值：** 杜绝部分成交或状态不一致的风险。通过确保“原子性”（交易要么全成功，要么全失败），保护平台免受技术套利干扰，并为用户提供无感的高速交易体验。

### III. Automated Accounting Core | 自动化会计中枢
*   **Description:** A sophisticated engine that translates every business event (Swap, Deposit, Withdraw) into standardized double-entry journal entries based on pre-defined templates.
*   **Business Value:** Replaces manual reconciliation with real-time, auditable financial records. This allows the platform to generate an accurate balance sheet at any second, drastically reducing audit costs and ensuring compliance with international financial standards.

*   **功能描述：** 一套精密的引擎，可根据预设模板将每一个业务事件（兑换、充值、提现）自动转化为标准的双录会计分录。
*   **业务价值：** 用实时的、可审计的财务记录取代繁琐的人工对账。使平台能够随时生成准确的资产负债表，大幅降低审计成本，确保符合国际财务合规标准。

### IV. Dynamic Clearing & Settlement | 柔性清分结算模块
*   **Description:** A template-driven system that calculates fees, commissions, and net payout amounts for every transaction.
*   **Business Value:** Provides business agility. Revenue models (e.g., changing fee percentages for VIP users) can be adjusted via templates without a single line of code change, allowing the platform to respond rapidly to market competition.

*   **功能描述：** 模板驱动的结算系统，自动计算每笔交易的手续费、佣金及最终支付净额。
*   **业务价值：** 赋予业务极高的灵活性。业务团队无需修改代码，仅通过模板即可调整收入模型（如针对 VIP 用户调整手续费比例），使平台能快速响应市场竞争。

---

## 3. Business Process (User Journey) | 业务流程推导

### Typical Journey: From Deposit to Withdrawal | 典型路径：从入金到出金

1.  **Onboarding & Deposit (入金)**:
    *   User registers and deposits assets.
    *   *System Action:* The system creates a wallet, detects incoming funds, and **automatically generates a journal entry** (Debit: Transit Account, Credit: User Wallet).
2.  **Trading & Growth (交易)**:
    *   User performs a Swap to exchange assets.
    *   *System Action:* The Swap Engine ensures the source funds are locked, executes the exchange, and **triggers an accounting event** to update the ledger in real-time.
3.  **Profit & Withdrawal (出金)**:
    *   User requests a withdrawal of profits.
    *   *System Action:* The **Clearing Module** calculates the platform fee based on current templates. The **Accounting Core** records the fee as platform revenue and the remainder as a liability reduction. Finally, the funds are sent to the user's external address.

---

## 4. Technology Empowering Business | 技术反哺业务

### I. Event-Driven Reliability (事件驱动与可靠性)
*   **Tech Choice:** NestJS EventEmitter2.
*   **Contribution:** Decouples complex business steps. If a notification fails, it doesn't stop the financial transaction. This ensures the **"Financial Core"** remains stable regardless of peripheral system issues.
*   **贡献：** 解耦复杂的业务步骤。即使通知系统出现故障，也不会影响财务交易的完成。这确保了无论周边系统状态如何，**“财务核心”**始终稳如磐石。

### II. State Machines & Idempotency (状态机与幂等性)
*   **Tech Choice:** Explicit status transitions and unique correlation IDs.
*   **Contribution:** Prevents "double-spending" or duplicate ledger entries. Even if a user clicks "Withdraw" twice or a network retry occurs, the system's **idempotency** ensures the operation is only executed once, guaranteeing data integrity.
*   **贡献：** 杜绝“双花”或重复入账。即便用户误操作多次点击提现或网络发生重试，系统的**幂等性设计**也能确保操作仅执行一次，从底层保障数据完整性。

### III. Template-Driven Business Logic (模板驱动的业务逻辑)
*   **Tech Choice:** Relational database schemas for Accounting and Clearing templates.
*   **Contribution:** Moves business rules from code to configuration. This allows the product to iterate faster and support diverse commercial scenarios (like different fee structures for different regions) with minimal engineering overhead.
*   **贡献：** 将业务规则从代码抽离到配置中。这使得产品能够以极低的技术成本快速迭代，并支持多样化的商业场景（如针对不同地区实施差异化的费率政策）。

---

## 5. Conclusion | 结语
**English:**
FIATX is not just a trading tool; it is a **Financial Operating System**. By merging high-performance trading with institutional-grade accounting, it provides a foundation of trust that is essential for scaling in the modern digital asset economy.

**中文：**
FIATX 不仅仅是一个交易工具，它更是一个**财务操作系统**。通过将高性能交易与机构级会计准则深度融合，它为现代数字资产经济中的规模化扩张奠定了至关重要的信任基石。
