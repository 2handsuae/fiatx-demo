import { readFileSync } from 'fs';
import { join } from 'path';

/* B 档 · 文本扫描单测（见计划 G6）。
   本仓库无法单测 React 组件（jest.config.js 的 moduleFileExtensions 没有 tsx、
   testRegex 只匹配 .spec.ts、testEnvironment 是 node），所以这里直接读 .tsx
   源文本，把业主那三条规则写成可执行断言：
     ① 同一职责的模块 → 同一个组件
     ② 内容差异允许
     ③ 侧栏结构必须一样
   本文件不被 admin-web 的 tsc 闸门编译（tsconfig.app.json 的 exclude），
   只由 npx jest 执行。 */

export const DETAIL_PAGES = {
  DEPOSIT: 'DepositTransactionDetail.tsx',
  WITHDRAW: 'WithdrawTransactionDetail.tsx',
  SWAP: 'SwapTransactionDetail.tsx',
} as const;

export const srcOf = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('规则① 同一职责同一组件 · L1/L2 闸门格子（Task 1）', () => {
  it('三域各用 GateTile 恰好两次（L1 一次、L2 一次）', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const n = (srcOf(file).match(/<GateTile\b/g) ?? []).length;
      expect([domain, n]).toEqual([domain, 2]);
    }
  });

  /* 反面断言：内联手写的格子必须消失。只查 <GateTile> 出现过是不够的 ——
     加了新组件却留着旧 JSX，页面会渲染两遍，而正面断言照样绿。 */
  it('三域都不再内联手写闸门格子（旧 JSX 必须删干净）', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, /border-l-\[3px\]\} *`\}>/.test(src)]).toEqual([domain, false]);
      expect([domain, src.includes('>L1 · Eligibility<')]).toEqual([domain, false]);
      expect([domain, src.includes('>L2 · Transaction Screen<')]).toEqual([domain, false]);
    }
  });

  it('三域 L1 副行按业主口径：充值 Post-arrival、提现与兑换都是 Pre-creation', () => {
    expect(srcOf(DETAIL_PAGES.DEPOSIT)).toContain('Post-arrival check');
    expect(srcOf(DETAIL_PAGES.WITHDRAW)).toContain('Pre-creation check');
    expect(srcOf(DETAIL_PAGES.SWAP)).toContain('Pre-creation check');
    // 旧措辞必须消失
    expect(srcOf(DETAIL_PAGES.SWAP)).not.toContain('Pre-execution gate');
  });

  it('L2 主值：充值/提现按 sumsubTxnType 转人话；兑换锁死 Finance 且不再用 KYT:', () => {
    for (const d of ['DEPOSIT', 'WITHDRAW'] as const) {
      const src = srcOf(DETAIL_PAGES[d]).replace(/\s+/g, ' ');
      expect([d, src.includes("'travelRule' ? 'Travel Rule' : 'Finance'")]).toEqual([d, true]);
    }
    const swap = srcOf(DETAIL_PAGES.SWAP).replace(/\s+/g, ' ');
    expect(swap).toContain('Finance:');
    expect(swap).not.toContain('KYT:');
    // 兑换没有 Travel Rule（无第三方对手方），不许出现
    expect(swap).not.toContain('Travel Rule');
  });

  it('兑换 Compliance 改用 DetailCard，不再手写 div+h3', () => {
    const swap = srcOf(DETAIL_PAGES.SWAP).replace(/\s+/g, ' ');
    expect(swap).toContain('<DetailCard title="Compliance"');
    expect(swap).not.toContain('className="px-6 py-5"');
  });
});
