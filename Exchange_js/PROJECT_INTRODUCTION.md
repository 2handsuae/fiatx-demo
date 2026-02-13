# Project Introduction: FIATX Digital Asset Exchange & Financial System

## 1. Project Overview

### Purpose
The **FIATX Digital Asset Exchange & Financial System** is a comprehensive, enterprise-grade platform designed for managing digital assets, facilitating trades (swaps), and ensuring complete financial transparency. Unlike traditional exchanges that rely on simple balance updates, this platform integrates a sophisticated **Double-Entry Accounting Engine** that records every business event in a formal ledger, providing a robust audit trail for all financial movements.

### Target Users
- **End-Customers (Retail & Institutional)**: Users who need a secure and intuitive interface to manage multi-currency wallets, deposit/withdraw funds (both Crypto and Fiat), and perform real-time asset swaps.
- **Platform Administrators**: Staff responsible for overseeing platform health, managing liquidity providers, configuring asset parameters, and monitoring financial reporting via the Admin Console.
- **Compliance & Finance Teams**: Professionals who require accurate, real-time access to journals, ledgers, and clearing reports for auditing and financial reconciliation.

---

## 2. Functional Modules

### Core Identity & Access Management
- **Auth & User Management**: Secure authentication for both administrative staff and end-customers, featuring role-based access control (RBAC).
- **Customer Profiles**: Comprehensive management of customer data, verification status, and activity history.

### Asset & Wallet Management
- **Multi-Currency Support**: Ability to define and manage various digital and fiat assets.
- **Wallet Orchestration**: Automated creation and management of user wallets, with real-time balance tracking and historical transaction views.
- **Treasury Management**: Centralized oversight of platform-owned assets and liquidity reserves.

### Transaction & Trading Engine
- **Payin & Deposit**: Automated handling of incoming funds, including blockchain monitoring for crypto deposits and manual confirmation for fiat.
- **Payout & Withdrawal**: Secure outbound transaction workflows for both crypto and fiat, featuring multi-step verification and status tracking.
- **Swap Transactions**: High-performance asset exchange engine allowing users to trade between different currency pairs with real-time pricing.

### Automated Accounting Engine (The Financial Core)
- **Chart of Accounts (COA)**: A flexible system to define the organizational financial structure.
- **Event-Driven Journaling**: Automatic generation of journal entries based on business events (e.g., a "Swap Completed" event triggers precise Debit/Credit entries).
- **Accounting Templates**: Pre-defined header and line templates that ensure consistency and accuracy across all automated bookkeeping.
- **Clearing & Settlement**: Dedicated logic for settling internal balances and reconciling with external liquidity providers.

### Liquidity & Market Operations
- **Liquidity Provider Integration**: Management of external liquidity sources to ensure market depth and stability.
- **Dynamic Configuration**: Admin tools to adjust liquidity parameters, pricing spreads, and asset availability on the fly.

### Infrastructure & Orchestration
- **Workflow Orchestrators**: Sophisticated services that coordinate complex, multi-domain business logic (e.g., the Swap Workflow coordinates between Wallets, Accounting, and Notifications).
- **Real-time Notifications**: WebSocket-based updates to keep users and admins informed of critical transaction statuses.
- **System Monitoring**: Comprehensive tracking of system performance, event logs, and correlation IDs for deep traceability.

---

## 3. Technical Stack Highlights
- **Backend**: Built with **NestJS** (Node.js) using **TypeScript** for a scalable, modular architecture.
- **Frontend**: Two distinct **React** applications (Client Web and Admin Web) powered by **Vite** and **Tailwind CSS**.
- **Data Layer**: **Prisma ORM** for type-safe database interactions with a relational database (SQLite/PostgreSQL).
- **Architecture**: **Event-Driven Architecture** utilizing `EventEmitter2` for decoupled, asynchronous workflow orchestration.
- **Accounting Standards**: Full implementation of double-entry bookkeeping principles within the core logic.
