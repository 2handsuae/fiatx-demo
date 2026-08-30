/**
 * 客户虚拟账号（C_VIBAN）对外展示的收款行信息。
 *
 * 所有客户的 VIBAN 共用同一家银行、同一个户名 —— 因为钱物理上确实躺在同一个
 * 客户资金隔离户里，VIBAN 只是给每个客户的虚拟账号，用来把入金认领到人。
 *
 * 2026-08-30：此前这两个值是**从 C_CMA 钱包上读**的（客户资金归集户）。C_CMA
 * 那一轮退役了 —— 它没有自己的账本头寸（余额是读时现算的 Σ C_VIBAN）、对账
 * 也不覆盖它，摆在钱包表里属于错误归类，详见 `system-wallet.util.ts` 的退役注记。
 * 退役后这两个字段没了来源，于是提成常量：它们本来就是**展示用的固定文案**，
 * 不是任何账本状态派生出来的东西。
 *
 * 消费方两处，必须共用这一份（这正是当初分散写导致 C_CMA 退役时漏掉生产路径的原因）：
 *   - `customer-deposit-wallet.service.ts` —— 真实开户 API 建 VIBAN
 *   - `scripts/demo-lib.ts` —— 演示造数建 VIBAN
 */
export const CUSTOMER_VIBAN_BANK_NAME = 'Zand Bank PJSC';
export const CUSTOMER_VIBAN_ACCOUNT_NAME = 'FiatX Ltd';
