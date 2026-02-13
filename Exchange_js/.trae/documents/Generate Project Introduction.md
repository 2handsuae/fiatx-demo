# Project Introduction Generation Plan

## 1. Information Gathering
- Finalize the list of key features by reviewing `src/modules` and the frontend page structures in `admin-web` and `client-web`.
- Confirm the technical stack details (NestJS, React, Prisma, etc.) to include in the technical overview if needed.

## 2. Document Creation
- Generate a comprehensive `PROJECT_INTRODUCTION.md` in English.
- **Section 1: Overview**
    - Define the project as a Digital Asset Exchange and Financial Management System.
    - Identify target users: End-customers (traders/investors) and Platform Administrators.
    - State the primary goal: Providing a secure, transparent, and accounting-integrated exchange platform.
- **Section 2: Functional Modules**
    - **Customer Operations**: Registration, Wallet Management, Deposit/Withdrawal, Asset Swapping.
    - **Admin Operations**: User Oversight, Liquidity Configuration, Asset Management.
    - **Core Engine**: Transaction state management, Workflow Orchestration (Deposit/Swap/Withdraw).
    - **Financial Integrity**: Automated Double-Entry Accounting, Chart of Accounts (COA), Journaling, and Clearing.
    - **Market Liquidity**: Liquidity Provider (LP) management and pricing configuration.
- **Section 3: Technical Highlights**
    - Event-driven architecture using NestJS EventEmitter2.
    - Double-entry bookkeeping for all financial movements.
    - Modern React-based frontends for both users and admins.

## 3. Verification
- Review the generated document for clarity, professional tone, and accuracy against the existing codebase.
- Ensure all requirements from the user (overview, functional modules, document generation) are met.

Does this plan look good to you? Once confirmed, I will proceed to generate the document.