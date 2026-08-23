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
      // 全 admin-web 里只有 GateTile.tsx 含 border-l-[3px]，源文本里再出现即说明旧内联格子没删干净
      expect([domain, srcOf(file).includes('border-l-[3px]')]).toEqual([domain, false]);
      // \s* 允许 prettier 的多行换行；GateTile 的 title="L1 · Eligibility" 前后不是 > <，不会被误伤
      expect([domain, />\s*L1 · Eligibility\s*</.test(srcOf(file))]).toEqual([domain, false]);
      expect([domain, />\s*L2 · Transaction Screen\s*</.test(srcOf(file))]).toEqual([domain, false]);
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
      expect([d, src.includes("'Travel Rule'") && src.includes("'Finance'")]).toEqual([d, true]);
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

describe('规则① 同一职责同一组件 · SumsubDetailSection（Task 2）', () => {
  it('三个详情页都不再本地定义 SumsubDetailSection', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      expect([domain, srcOf(file).includes('const SumsubDetailSection = ')]).toEqual([domain, false]);
    }
  });

  it('三个详情页都从共享路径 import 它', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, /import \{[^}]*SumsubDetailSection[^}]*\} from '\.\.\/components\/compliance\/SumsubDetailSection'/.test(src)]).toEqual([domain, true]);
    }
  });

  it('三个详情页仍各渲染它一次（合并不等于删功能）', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const n = (srcOf(file).match(/<SumsubDetailSection\b/g) ?? []).length;
      expect([domain, n]).toEqual([domain, 1]);
    }
  });
});

describe('规则① 同一职责同一组件 · StatusTimeline（Task 3）', () => {
  it('三个详情页都不再本地定义 StatusTimeline', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      expect([domain, srcOf(file).includes('const StatusTimeline = ')]).toEqual([domain, false]);
    }
  });

  it('三个详情页都从共享路径 import，且各渲染一次', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, src.includes("from '../components/compliance/StatusTimeline'")]).toEqual([domain, true]);
      expect([domain, (src.match(/<StatusTimeline\b/g) ?? []).length]).toEqual([domain, 1]);
    }
  });

  /* 三域各传自己的 statusMeta —— 传错域会让颜色/文案串味（改之前兑换那份
     硬编码绿色，同一条 FROZEN 事件充值页红、兑换页绿）。 */
  it('三域各传自己域的 getStatusMeta', () => {
    expect(srcOf(DETAIL_PAGES.DEPOSIT).replace(/\s+/g, ' ')).toContain('getStatusMeta={getDepositStatusMeta}');
    expect(srcOf(DETAIL_PAGES.WITHDRAW).replace(/\s+/g, ' ')).toContain('getStatusMeta={getWithdrawStatusMeta}');
    expect(srcOf(DETAIL_PAGES.SWAP).replace(/\s+/g, ' ')).toContain('getStatusMeta={getSwapStatusMeta}');
  });
});

describe('合并后的 StatusTimeline 保住了最健壮那份的守卫（Task 3）', () => {
  const shared = readFileSync(
    join(__dirname, '..', 'components', 'compliance', 'StatusTimeline.tsx'),
    'utf8',
  ).replace(/\s+/g, ' ');

  /* 合并前充值那份没有这三样，statusHistory 存进非数组 JSON 会整页白屏。
     这三条钉住「合并时取的是最健壮的一份，不是随便挑一份」。 */
  it('有非数组守卫', () => {
    /* 组件顶部 JSDoc 出于文档目的也提到 "Array.isArray" 这个词，光查裸字符串
       'Array.isArray' 删掉真实的 `if (!Array.isArray(parsed))` 守卫也测不出来
       （变异验证时发现）。查带括号的调用形态,只在实际代码里出现。 */
    expect(shared).toContain('Array.isArray(parsed)');
  });
  it('排序不可变（不原地改传入数组）', () => {
    expect(shared).toContain('[...parsed].sort');
  });
  it('日期有兜底', () => {
    /* 光查裸字符串 '|| 0' 挡不住把排序比较器里那两处删掉却留着 <time> 那处的
       变异（会让 new Date(undefined).getTime() → NaN 把排序打乱，仍然全绿——
       变异验证时发现）。钉住比较器的真实形态 + 全文只应出现 3 次。 */
    expect(shared).toContain('b.timestamp || b.changedAt || 0).getTime()');
    expect(shared).toContain('a.timestamp || a.changedAt || 0).getTime()');
    expect((shared.match(/\|\| 0/g) ?? []).length).toBe(3);
  });
  it('读字段覆盖三域三种后端写入形状', () => {
    expect(shared).toContain('item.note || item.reason');
    expect(shared).toContain('item.operator || item.operatorId || item.actorType');
  });
});

describe('规则③ 侧栏结构必须一样（Task 4）', () => {
  /** 抽出侧栏区（从 w-[272px] 到文件末）里 SidebarGroup 的 title，按出现顺序。 */
  const sidebarGroupsOf = (file: string): string[] => {
    const src = srcOf(file);
    const i = src.indexOf('w-[272px]');
    if (i < 0) throw new Error(`${file}: 找不到侧栏容器`);
    return [...src.slice(i).matchAll(/<SidebarGroup title="([^"]*)"/g)].map((m) => m[1]);
  };

  it('三域信息段逐字相同：SLA → Identity → Lifecycle', () => {
    const INFO = ['SLA', 'Identity', 'Lifecycle'];
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const tail = sidebarGroupsOf(file).slice(-3);
      expect([domain, tail]).toEqual([domain, INFO]);
    }
  });

  it('兑换操作段为空 —— 侧栏只有信息段三组', () => {
    expect(sidebarGroupsOf(DETAIL_PAGES.SWAP)).toEqual(['SLA', 'Identity', 'Lifecycle']);
  });

  /* 反面断言：兑换的 Ops Disposition 装的是客户合规信息（Restrictions / Hard Line），
     业主裁定「客户合规信息不放在订单里」。这条钉住它不会被谁"顺手加回来"。 */
  it('兑换侧栏不再出现客户级合规信息', () => {
    const swap = srcOf(DETAIL_PAGES.SWAP);
    expect(swap).not.toContain('label="Restrictions"');
    expect(swap).not.toContain('label="Hard Line"');
    expect(swap).not.toContain('<SidebarGroup title="Frozen Disposition">');
  });

  it('三域 Identity 都是纯身份 4 行，且第 4 行按域给（充值/提现 Asset、兑换 Pair）', () => {
    const identityKVsOf = (file: string): string[] => {
      const src = srcOf(file);
      const i = src.indexOf('<SidebarGroup title="Identity">');
      const j = src.indexOf('</SidebarGroup>', i);
      return [...src.slice(i, j).matchAll(/<SidebarKV\s+label="([^"]*)"/g)].map((m) => m[1]);
    };
    expect(['DEPOSIT', identityKVsOf(DETAIL_PAGES.DEPOSIT)]).toEqual(
      ['DEPOSIT', ['Deposit No', 'Owner', 'Owner Type', 'Asset']]);
    expect(['WITHDRAW', identityKVsOf(DETAIL_PAGES.WITHDRAW)]).toEqual(
      ['WITHDRAW', ['Withdraw No', 'Owner', 'Owner Type', 'Asset']]);
    expect(['SWAP', identityKVsOf(DETAIL_PAGES.SWAP)]).toEqual(
      ['SWAP', ['Swap No', 'Owner', 'Owner Type', 'Pair']]);
  });
});
