-- Migrate old V1 wallet role values to V3 taxonomy
UPDATE wallets SET "walletRole" = 'C_DEP' WHERE "walletRole" = 'DEPOSIT';
UPDATE wallets SET "walletRole" = 'C_MAIN' WHERE "walletRole" = 'MASTER';
UPDATE wallets SET "walletRole" = 'C_OUT' WHERE "walletRole" = 'PAYOUT';
UPDATE wallets SET "walletRole" = 'F_LIQ' WHERE "walletRole" IN ('LIQ', 'LIQ_BANK');
UPDATE wallets SET "walletRole" = 'C_CMA' WHERE "walletRole" = 'CUST_BANK';
UPDATE wallets SET "walletRole" = 'F_OPS' WHERE "walletRole" = 'GENERAL' AND "ownerType" = 'PLATFORM';
UPDATE wallets SET "walletRole" = 'C_DEP' WHERE "walletRole" = 'GENERAL' AND "ownerType" = 'CUSTOMER';
