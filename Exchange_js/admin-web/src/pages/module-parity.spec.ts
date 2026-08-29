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

  /* 2026-08-24 业主逮到：一笔 complianceVerdict='approved' 的 SUCCESS 兑换单，L2 仍是琥珀。
     根因是兑换读的是**嵌套证据** `sumsubDetail?.verdict`，而那个对象由 sumsubDetailJson
     派生 —— 该列只在 applyKytVerdict 收到 detailRaw 时才写（getTxn 没返回 raw、
     或 demo 直接落裁决时都为空）。充值/提现读的是**顶层裁决列**，所以没这毛病。
     这条钉住三域都读顶层列。 */
  it('三域 L2 都读顶层裁决列，不读可能为空的嵌套 sumsubDetail', () => {
    const l2StyleOf = (file: string): string =>
      srcOf(file).match(/const l2Style = getComplianceLayerStyle\([\s\S]{0,120}?\);/)?.[0] ?? '';
    expect(l2StyleOf(DETAIL_PAGES.DEPOSIT)).toContain('data.sumsubVerdict');
    expect(l2StyleOf(DETAIL_PAGES.WITHDRAW)).toContain('data.sumsubVerdict');
    expect(l2StyleOf(DETAIL_PAGES.SWAP)).toContain('data.complianceVerdict');
    // 反面：三域都不许把 L2 的颜色判据接到嵌套证据上
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      expect([domain, l2StyleOf(file).includes('sumsubDetail')]).toEqual([domain, false]);
    }
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
  /* 提现的 createMockData() 写的是 {from,to,action,timestamp} —— **没有 status 字段**，
     经 POST /withdraw-transactions/mock 可达。不读 `|| item.to` 的话
     getStatusMeta(undefined) 落 fallback、徽章渲染成空白。
     （2026-08-23 终审发现：原 JSDoc 声称「三种全覆盖、没有第四种」是错的。） */
  it('状态读法覆盖第四种写入形状（提现 mock 数据的 {from,to} 无 status）', () => {
    expect(shared).toContain('getStatusMeta(item.status || item.to)');
    expect((shared.match(/getStatusMeta\(item\.status \|\| item\.to\)/g) ?? []).length).toBe(3);
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

describe('规则① 同一职责同一组件 · needsReview 横幅（Task 5）', () => {
  it('三域都用共享的 NeedsReviewBanner，各一次', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, src.includes("from '../components/compliance/NeedsReviewBanner'")]).toEqual([domain, true]);
      expect([domain, (src.match(/<NeedsReviewBanner\b/g) ?? []).length]).toEqual([domain, 1]);
      // 反面断言：不能只查组件出现过——必须接了真数据。show={false} 之类的
      // 静默常量会让横幅永远不渲染，前三条断言照样绿（终审变异实测过）。
      expect([domain, /<NeedsReviewBanner[^>]*show=\{[^}]*needsReview[^}]*\}/.test(src)]).toEqual([domain, true]);
    }
  });

  /* 反面断言：手写横幅与侧栏 KV 都必须消失。业主裁定这面旗只在页顶出现一次。 */
  it('三域都不再手写横幅、也不再有 needsReview 侧栏 KV', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, src.includes('bg-adm-red/5 px-6 py-2.5')]).toEqual([domain, false]);
      expect([domain, src.includes('bg-adm-red/10 px-6 py-2 ')]).toEqual([domain, false]);
      expect([domain, src.includes('label="Needs Review"')]).toEqual([domain, false]);
    }
  });

  /* 三域文案必须**不同** —— 三个域的 needsReview 语义不是一回事，
     照抄会说错话（充值那面旗是资金腿重试耗尽，不是迟到的 KYT 裁决）。 */
  it('三域文案各不相同', () => {
    const msgOf = (file: string) => {
      const m = srcOf(file).replace(/\s+/g, ' ').match(/<NeedsReviewBanner[^>]*message=\{?["'`]([^"'`]+)/);
      return m?.[1] ?? '';
    };
    const msgs = Object.values(DETAIL_PAGES).map(msgOf);
    expect(msgs.every((m) => m.length > 0)).toBe(true);
    expect(new Set(msgs).size).toBe(3);
  });
});

describe('规则② 内容差异允许，但同族卡片要连续（Task 6）', () => {
  /** 抽出主列 DetailCard 的 title，按出现顺序。 */
  const mainCardsOf = (file: string): string[] =>
    [...srcOf(file).matchAll(/<DetailCard\s+title="([^"]*)"/g)].map((m) => m[1]);

  it('兑换的交易信息三张卡连续出现在最前', () => {
    const cards = mainCardsOf(DETAIL_PAGES.SWAP);
    expect(cards.slice(0, 3)).toEqual(['Conversion', 'Pricing', 'Technical']);
  });

  it('充值/提现的交易信息卡也在最前（对照组，本轮不改）', () => {
    expect(mainCardsOf(DETAIL_PAGES.DEPOSIT)[0]).toBe('Transaction Details');
    expect(mainCardsOf(DETAIL_PAGES.WITHDRAW)[0]).toBe('Transaction Details');
  });
});

describe('规则① 同一模块显示逻辑一致 · ⚡ Simulation（Task 7 + 2026-08-24 业主改判）', () => {
  /* 业主 2026-08-24 裁定：**兑换的裁决键只在 COMPLIANCE_PENDING 高亮，其余一律置灰**。
     这条取代了原先按后端 KYT_VERDICT_TERMINAL_STATUSES 反推的两档谓词
     （`isSwapFullyIgnored` / `isSwapOrderTerminalButPersonStillAffected`，都已删）。
     充值/提现**不受影响**，仍按各自的后端忽略集合置灰 —— 那两域有多个态投裁决是有效的
     （ACTION_PENDING / OPERATION_PENDING / MANUAL_CHECKING），一刀切到单态会误灰。 */
  const ORDER_LEVEL_DOMAINS = { DEPOSIT: DETAIL_PAGES.DEPOSIT, WITHDRAW: DETAIL_PAGES.WITHDRAW } as const;

  it('三域面板都常显 —— 渲染条件里不许再有 data.status 判断', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      /* 必须 matchAll 全量取：非全局 .match() 只看第一处，注释里单起一行恰好写着
         `{simEnabled && (` 就能掩盖真闸门改回带 status 判断（审查变异 C5b 实证）。 */
      const gates = [...srcOf(file).matchAll(/\{simEnabled[^\n]*/g)].map((m) => m[0].trim());
      expect([domain, gates]).toEqual([domain, ['{simEnabled && (']]);
    }
  });

  it('充值/提现按自家忽略集合置灰，集合内容与后端逐字一致', () => {
    const EXPECTED: Record<string, string[]> = {
      DEPOSIT: ['SUCCESS', 'FAILED', 'CONFISCATED', 'RETURNED', 'SEIZED', 'CONFISCATING', 'RETURNING', 'SEIZING'],
      WITHDRAW: ['SUCCESS', 'REJECTED', 'FAILED', 'RETURNED'],
    };
    for (const [domain, file] of Object.entries(ORDER_LEVEL_DOMAINS)) {
      const m = srcOf(file).match(/_VERDICT_(?:IGNORED|TERMINAL)_STATUSES = new Set\(\[([\s\S]*?)\]\)/);
      /* 数组体内的注释先剥掉再 matchAll —— 否则把真元素挪成体内注释（例如
         `// 在途处置态 'CONFISCATING'`）时字面量还在，matchAll 照样抓到，
         测不出真元素其实已经没了（变异验证时发现）。数组*上方*的注释不受影响，
         因为 m[1] 从 `new Set([` 起算。 */
      const body = (m?.[1] ?? '').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
      const got = [...body.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
      expect([domain, got.sort()]).toEqual([domain, [...EXPECTED[domain]].sort()]);
    }
  });

  it('充值/提现的 FROZEN 不在数组里、但谓词认它（与后端两行结构同形）', () => {
    const NAME: Record<string, string> = {
      DEPOSIT: 'isDepositVerdictIgnored',
      WITHDRAW: 'isWithdrawVerdictIgnored',
    };
    for (const [domain, file] of Object.entries(ORDER_LEVEL_DOMAINS)) {
      const src = srcOf(file);
      const setBody = src.match(/_VERDICT_(?:IGNORED|TERMINAL)_STATUSES = new Set\(\[([^\]]*)\]/)?.[1] ?? '';
      expect([domain, setBody.includes('FROZEN')]).toEqual([domain, false]);
      /* 正则钉在谓词体内（从 `const isXxx` 到它自己的第一个 `;`），不是打在整份
         collapsed 源文本上 —— 否则把谓词第二支删掉、只在注释里留一句字面量，
         断言照样全绿（变异验证时发现）。 */
      const predicateBody = src.match(new RegExp(`const ${NAME[domain]}[^;]*;`))?.[0] ?? '';
      expect([domain, predicateBody.length > 0]).toEqual([domain, true]);
      expect([domain, /\|\|\s*status === 'FROZEN'/.test(predicateBody)]).toEqual([domain, true]);
    }
  });

  /* 业主改判后兑换的判据是**单态白名单**，不再有硬抄数组、也不再有 FROZEN 单独一支
     （FROZEN 不等于 COMPLIANCE_PENDING，天然落在置灰侧）。这条钉住它就是这一个态，
     谁把它改成集合或多态白名单都会红。 */
  it('兑换的判据是「只有 COMPLIANCE_PENDING 可投」这一个态', () => {
    const src = srcOf(DETAIL_PAGES.SWAP);
    const body = src.match(/const isSwapVerdictActionable[^;]*;/)?.[0] ?? '';
    expect(body.length).toBeGreaterThan(0);
    expect([...body.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1])).toEqual(['COMPLIANCE_PENDING']);
    // 旧的两档谓词与硬抄数组必须删净，否则是"新旧并存、谁在生效说不清"
    expect(src).not.toContain('isSwapFullyIgnored');
    expect(src).not.toContain('isSwapOrderTerminalButPersonStillAffected');
    expect(src).not.toContain('SWAP_KYT_VERDICT_TERMINAL_STATUSES');
  });

  it('提现 PAYOUT_PENDING 刻意不置灰（后端判 EVIDENCE_ONLY，不是 no-op）', () => {
    const w = srcOf(DETAIL_PAGES.WITHDRAW);
    expect(w.match(/_VERDICT_TERMINAL_STATUSES = new Set\(\[([^\]]*)\]/)?.[1]).not.toContain('PAYOUT_PENDING');
  });

  /* Important #3（Task 7 审查）：以上几条只查判据的静态定义，从没验证过 disabled
     属性、说明文案的渲染条件真的接到这些判据上 —— 审查跑了 7 个变异实测：三域各自
     把 disabled 里的谓词去掉、参数换成写死的 ''、删整段文案、改文案字、条件取反，
     以上断言全绿。下面把“接线”本身钉死。

     2026-08-29 三域面板抽成共享组件 SimulationPanel（Task 8）后，三份重复的按钮
     JSX 没了，下面两条跟着改形：
       · disabled 的判据接线——原来读按钮 disabled 属性，现在读 `<SimulationPanel
         ... disabled={...} />` 调用处传的是哪个表达式，逐域校验没被摘掉/换掉。
       · 说明文案的渲染条件——原来要三域各查一遍「文案条件 == 判据本身」，现在
         按钮置灰与说明文案共用 SimulationPanel 内部唯一一处 `props.disabled &&`
         接线，三域结构上不可能分叉，故只需校验 SimulationPanel 自身这一处即可，
         不必再逐页重复钉；判据是否传对了由上一条测试负责。
     文案内容本身（IGNORED_MSG）原样搬进了 SimulationPanel，没删没改字，仍然钉。 */
  it('SimulationPanel 的 disabled prop 真的接到自家判据上（不是被摘掉/参数被换掉）', () => {
    const disabledPropOf = (file: string): string => {
      const tag = srcOf(file).match(/<SimulationPanel[\s\S]*?\/>/)?.[0];
      if (!tag) throw new Error(`${file}: 找不到 <SimulationPanel ... />`);
      const m = tag.match(/disabled=\{([^}]*)\}/);
      if (!m) throw new Error(`${file}: SimulationPanel 调用处缺 disabled 属性`);
      return m[1];
    };
    expect(disabledPropOf(DETAIL_PAGES.DEPOSIT)).toBe('isDepositVerdictIgnored(data.status)');
    expect(disabledPropOf(DETAIL_PAGES.WITHDRAW)).toBe('isWithdrawVerdictIgnored(data.status)');
    // 兑换是**取反**接线（白名单：不在 COMPLIANCE_PENDING 就灰）。
    expect(disabledPropOf(DETAIL_PAGES.SWAP)).toBe('!isSwapVerdictActionable(data.status)');
  });

  it('置灰说明文案的渲染条件是 SimulationPanel 唯一的 props.disabled（三域共用一条接线，结构上不会分叉）', () => {
    expect(srcOf('../components/SimulationPanel.tsx')).toMatch(/\{props\.disabled && \(/);
  });

  it('置灰说明文案内容没被删、没被改字（随抽组件原样搬进 SimulationPanel）', () => {
    const IGNORED_MSG = '本单已进终态/处置态，投递的裁决会被后端记录但不改状态。';
    expect(srcOf('../components/SimulationPanel.tsx').includes(IGNORED_MSG)).toBe(true);
  });
});

const LIST_PAGES = {
  DEPOSIT: 'DepositTransactionList.tsx',
  WITHDRAW: 'WithdrawTransactionList.tsx',
  SWAP: 'SwapTransactionList.tsx',
} as const;

/* 注释里的散文不算数：三份列表页的注释本来就写着 needsReviewOnly（提现那句
   在本 Task 之前就存在），裸 toContain 会被散文喂饱 —— 先把注释剥掉再扫。 */
const codeOf = (file: string): string =>
  srcOf(file)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ');

describe('列表页三域对齐（Task 8）', () => {
  const columnsOf = (file: string): string[] =>
    [...srcOf(file).matchAll(/\[\s*'([^']+)',\s*'\d+px'\s*\]/g)].map((m) => m[1]);

  /** 数据行里的 <td> 个数 —— thead/colSpan 都对但 tbody 少一格照样串列。 */
  const bodyCellsOf = (file: string): number => {
    const src = srcOf(file);
    const start = src.indexOf('visibleItems.map((item)');
    if (start < 0) throw new Error(`${file}: 找不到 visibleItems.map((item) 数据行锚点`);
    const end = src.indexOf('</tr>', start);
    if (end < 0) throw new Error(`${file}: 数据行没有闭合 </tr>`);
    return (src.slice(start, end).match(/<td[\s>]/g) ?? []).length;
  };

  it('三域都有 Review 列', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      expect([domain, columnsOf(file).includes('Review')]).toEqual([domain, true]);
    }
  });

  it('列数与 colSpan 对得上（改了列忘改 colSpan 会串行）', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      const spans = [...srcOf(file).matchAll(/colSpan=\{(\d+)\}/g)].map((m) => Number(m[1]));
      expect([domain, [...new Set(spans)]]).toEqual([domain, [columnsOf(file).length]]);
    }
  });

  it('thead 列数 == tbody 每行 <td> 数（colSpan 对得上也可能少一格）', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      expect([domain, bodyCellsOf(file)]).toEqual([domain, columnsOf(file).length]);
    }
  });

  it('三域「只看需复核」勾选框真的接上了（绑定 / 亮灯谓词 / 页内过滤 / memo 依赖）', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      const code = codeOf(file);
      expect([domain, 'bind', code.includes('checked={filters.needsReviewOnly}')])
        .toEqual([domain, 'bind', true]);
      expect([domain, 'onChange', code.includes('needsReviewOnly: e.target.checked')])
        .toEqual([domain, 'onChange', true]);
      expect([domain, 'reset-lamp', code.includes('filters.needsReviewOnly ||')])
        .toEqual([domain, 'reset-lamp', true]);
      expect([domain, 'page-filter', code.includes('filters.needsReviewOnly ? it.needsReview : true')])
        .toEqual([domain, 'page-filter', true]);
      expect([domain, 'memo-dep', code.includes('[items, filters.needsReviewOnly,')])
        .toEqual([domain, 'memo-dep', true]);
    }
  });

  it('三域资产类型筛选真的接上了（select 绑定 / 亮灯谓词 / 真过滤动作）', () => {
    // 兑换一笔单有买卖两侧资产，任一命中即算 —— 正则同时钉住"两侧都在场"。
    const REAL_FILTER: Record<string, RegExp> = {
      DEPOSIT: /if \(next\.type\) \{ .{0,200}?\.toUpperCase\(\) === next\.type\.toUpperCase\(\)/,
      WITHDRAW: /if \(next\.type\) \{ .{0,200}?\.toUpperCase\(\) === next\.type\.toUpperCase\(\)/,
      SWAP: /filters\.type \? \[it\.fromAsset\.type, it\.toAsset\.type\]\.some\(/,
    };
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      const code = codeOf(file);
      expect([domain, 'bind', code.includes('value={filters.type}')])
        .toEqual([domain, 'bind', true]);
      expect([domain, 'option', code.includes('<option value="">All types</option>')])
        .toEqual([domain, 'option', true]);
      expect([domain, 'reset-lamp', code.includes('!!filters.type ||')])
        .toEqual([domain, 'reset-lamp', true]);
      expect([domain, 'real-filter', REAL_FILTER[domain].test(code)])
        .toEqual([domain, 'real-filter', true]);
    }
    // 兑换的 type 过滤住在 useMemo 里，依赖数组漏了它就永远算旧结果。
    expect(['SWAP', 'memo-dep', codeOf(LIST_PAGES.SWAP).includes(', filters.type]')])
      .toEqual(['SWAP', 'memo-dep', true]);
  });

  it('三域状态下拉的「全部」文案统一为 All status（且真的挂在状态下拉上）', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      const code = codeOf(file);
      expect([
        domain,
        /<option value="">All status<\/option> \{ ?\w*STATUS_FILTERS\.map\(/.test(code),
      ]).toEqual([domain, true]);
      expect([domain, /<option value="">All<\/option>/.test(code)]).toEqual([domain, false]);
    }
  });
});
