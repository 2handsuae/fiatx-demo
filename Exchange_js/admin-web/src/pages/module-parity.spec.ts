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

describe('规则① 同一模块显示逻辑一致 · ⚡ Simulation（Task 7）', () => {
  it('三域面板都常显 —— 渲染条件里不许再有 data.status 判断', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      /* 必须 matchAll 全量取：非全局 .match() 只看第一处，注释里单起一行恰好写着
         `{simEnabled && (` 就能掩盖真闸门改回带 status 判断（审查变异 C5b 实证）。 */
      const gates = [...srcOf(file).matchAll(/\{simEnabled[^\n]*/g)].map((m) => m[0].trim());
      expect([domain, gates]).toEqual([domain, ['{simEnabled && (']]);
    }
  });

  it('三域都按自家忽略集合置灰，且集合内容与后端逐字一致', () => {
    const EXPECTED: Record<string, string[]> = {
      DEPOSIT: ['SUCCESS', 'FAILED', 'CONFISCATED', 'RETURNED', 'SEIZED', 'CONFISCATING', 'RETURNING', 'SEIZING'],
      WITHDRAW: ['SUCCESS', 'REJECTED', 'FAILED', 'RETURNED'],
      SWAP: ['SUCCESS', 'REJECTED', 'FAILED', 'REVERSED'],
    };
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file);
      const m = src.match(/_VERDICT_(?:IGNORED|TERMINAL)_STATUSES = new Set\(\[([\s\S]*?)\]\)/);
      // 数组体内的注释先剥掉再 matchAll —— 否则把真元素挪成体内注释（例如
      // `// 在途处置态 'CONFISCATING'`）时，字面量还在文本里，matchAll 照样
      // 抓到，测不出真元素其实已经没了（变异验证时发现）。数组*上方*的注释
      // 不受影响，因为 m[1] 从 `new Set([` 起算，不含上方注释。
      const body = (m?.[1] ?? '').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
      const got = [...body.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
      expect([domain, got.sort()]).toEqual([domain, [...EXPECTED[domain]].sort()]);
    }
  });

  /* FROZEN 三域都在集合之外、走谓词第二支 —— 与后端两行结构同形。
     塞进数组就与后端语义脱节（后端那个集合另有含义）。 */
  it('FROZEN 不在数组里，但谓词认它', () => {
    // 各域「忽略谓词」的真实名字——兑换在 Important #2 修复后拆成两个谓词，
    // 真正 100% no-op（认 FROZEN）的那个改名叫 isSwapFullyIgnored,不再叫
    // *VerdictIgnored,别去 grep 老名字。
    const IGNORED_PREDICATE_NAME: Record<string, string> = {
      DEPOSIT: 'isDepositVerdictIgnored',
      WITHDRAW: 'isWithdrawVerdictIgnored',
      SWAP: 'isSwapFullyIgnored',
    };
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file);
      const setBody = src.match(/_VERDICT_(?:IGNORED|TERMINAL)_STATUSES = new Set\(\[([^\]]*)\]/)?.[1] ?? '';
      expect([domain, setBody.includes('FROZEN')]).toEqual([domain, false]);
      // 正则钉在谓词体内（从 `const isXxx` 到它自己的第一个 `;`），不是打在
      // 整份 collapsed 源文本上 —— 否则把谓词第二支删掉、只在注释里留一句
      // `// || status === 'FROZEN'` 字面量,四条断言照样全绿(变异验证时发现)。
      const predicateBody =
        src.match(new RegExp(`const ${IGNORED_PREDICATE_NAME[domain]}[^;]*;`))?.[0] ?? '';
      expect([domain, predicateBody.length > 0]).toEqual([domain, true]);
      // \s* 允许 prettier 把 `||` 和 `status` 换行折断（兑换那个谓词体较长，
      // 折行是预期格式，不该让断言对格式敏感）。
      expect([domain, /\|\|\s*status === 'FROZEN'/.test(predicateBody)]).toEqual([domain, true]);
    }
  });

  /* 兑换的第二档谓词是**手写字面量**（不是硬抄的数组），it2 钉不到它。
     审查变异 N1（把它与 isSwapFullyIgnored 的取值域对调）会让 SUCCESS/REJECTED
     重新被灰掉 —— Important #2 原样复活而八条断言全绿。这条专钉它。
     依据：swap-workflow.service.ts 的 KYT_VERDICT_TERMINAL_STATUSES 分支里有
     carve-out `(status === REJECTED || status === SUCCESS) && verdict === 'rejected'`
     → handleRejectDisposition，这两态**会真的重跑客户级处置**，不是 no-op。 */
  it('兑换「本单终态但客户仍受影响」那一档恰好是 SUCCESS + REJECTED', () => {
    const bucket =
      srcOf(DETAIL_PAGES.SWAP).match(/const isSwapOrderTerminalButPersonStillAffected[^;]*;/)?.[0] ?? '';
    expect(bucket.length).toBeGreaterThan(0);
    expect([...bucket.matchAll(/status === '([A-Z_]+)'/g)].map((x) => x[1]).sort()).toEqual([
      'REJECTED',
      'SUCCESS',
    ]);
  });

  it('提现 PAYOUT_PENDING、兑换 PROCESSING 刻意不置灰', () => {
    const w = srcOf(DETAIL_PAGES.WITHDRAW);
    const s = srcOf(DETAIL_PAGES.SWAP);
    expect(w.match(/_VERDICT_TERMINAL_STATUSES = new Set\(\[([^\]]*)\]/)?.[1]).not.toContain('PAYOUT_PENDING');
    expect(s.match(/_VERDICT_TERMINAL_STATUSES = new Set\(\[([^\]]*)\]/)?.[1]).not.toContain('PROCESSING');
  });

  /* Important #3（Task 7 审查）：以上几条只查集合/谓词的静态定义，从没验证过
     JSX 里的 disabled 属性、说明文案的渲染条件真的接到这些谓词上——审查跑了
     7 个变异实测：三域各自把 disabled 里的谓词去掉、兑换谓词参数换成写死的
     ''、删掉充值整段说明文案、提现文案改字、兑换说明条件取反 `!谓词`,
     以上所有断言全绿。下面三条把"接线"本身钉死。 */
  it('Simulation 按钮的 disabled 属性真的调用了自家忽略谓词（不是被摘掉/参数被换掉）', () => {
    const disabledAttrOf = (file: string): string => {
      // 用 `simSubmitting !== null` 定位——这行文本在各文件里只在 Simulation
      // 按钮的 disabled 属性上出现一次，其余 disabled（dispositionSubmitting/
      // slaSubmitting 等）都不含它，不会认错目标。
      const m = srcOf(file).match(/disabled=\{\s*simSubmitting !== null[^}]*\}/);
      if (!m) throw new Error(`${file}: 找不到 Simulation 按钮的 disabled 属性`);
      return m[0];
    };
    expect(disabledAttrOf(DETAIL_PAGES.DEPOSIT)).toContain('isDepositVerdictIgnored(data.status)');
    expect(disabledAttrOf(DETAIL_PAGES.WITHDRAW)).toContain('isWithdrawVerdictIgnored(data.status)');
    const swapAttr = disabledAttrOf(DETAIL_PAGES.SWAP);
    // 兑换：真正决定置灰的是 isSwapFullyIgnored（100% no-op），且必须给⑦⑧
    // 人级键留豁免——否则 BACKLOG「⑦⑧ 在被拒单上无 UI 入口」等于没解
    // （Important #1）。
    expect(swapAttr).toContain('isSwapFullyIgnored(data.status)');
    expect(swapAttr).toContain('SWAP_PERSON_LEVEL_KEYS.has(s.key)');
  });

  it('说明文案的渲染条件就是自家谓词本身（不是取反、不是接到别的谓词）', () => {
    expect(srcOf(DETAIL_PAGES.DEPOSIT)).toMatch(/\{isDepositVerdictIgnored\(data\.status\) && \(/);
    expect(srcOf(DETAIL_PAGES.DEPOSIT)).not.toMatch(/\{!isDepositVerdictIgnored/);
    expect(srcOf(DETAIL_PAGES.WITHDRAW)).toMatch(/\{isWithdrawVerdictIgnored\(data\.status\) && \(/);
    expect(srcOf(DETAIL_PAGES.WITHDRAW)).not.toMatch(/\{!isWithdrawVerdictIgnored/);
    // 兑换 Important #2 修复后是两句话，各自挂自己的谓词：isSwapFullyIgnored
    // → 真 no-op 那句；isSwapOrderTerminalButPersonStillAffected → SUCCESS/
    // REJECTED 那句"客户仍可能被限制"的新文案。
    const swap = srcOf(DETAIL_PAGES.SWAP);
    expect(swap).toMatch(/\{isSwapFullyIgnored\(data\.status\) && \(/);
    expect(swap).toMatch(/\{isSwapOrderTerminalButPersonStillAffected\(data\.status\) && \(/);
    expect(swap).not.toMatch(/\{!isSwapFullyIgnored/);
    expect(swap).not.toMatch(/\{!isSwapOrderTerminalButPersonStillAffected/);
  });

  it('说明文案内容没被删、没被改字', () => {
    const IGNORED_MSG = '本单已进终态/处置态，投递的裁决会被后端记录但不改状态。';
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      expect([domain, srcOf(file).includes(IGNORED_MSG)]).toEqual([domain, true]);
    }
    // 兑换独有的第二句（Important #2：SUCCESS/REJECTED 状态不变，但客户级
    // 处置仍会重跑，不是"什么都不会发生"）。
    expect(srcOf(DETAIL_PAGES.SWAP)).toContain(
      '本单已终态，状态不会再变；但重投拒绝类裁决仍会重跑客户级处置（客户可能被限制）。',
    );
  });

  /* Important #1（Task 7 审查）：⑦⑧ 投的是 applicantActionReviewed，作用对象
     是人不是单，不走 applyKytVerdict——终态单上必须点得动，这正是 BACKLOG
     「⑦⑧ 人级模拟键在被拒单上无 UI 入口」要的入口。上面「disabled 属性真的
     调用了自家忽略谓词」那条已经断言了 SWAP_PERSON_LEVEL_KEYS 出现在 disabled
     豁免里；这条钉住豁免集合本身没被改错。 */
  it('兑换⑦⑧人级键的豁免集合就是 V7_ACTION_GREEN / V8_ACTION_RED', () => {
    const src = srcOf(DETAIL_PAGES.SWAP);
    expect(src).toContain(
      "const SWAP_PERSON_LEVEL_KEYS = new Set(['V7_ACTION_GREEN', 'V8_ACTION_RED']);",
    );
  });
});

const LIST_PAGES = {
  DEPOSIT: 'DepositTransactionList.tsx',
  WITHDRAW: 'WithdrawTransactionList.tsx',
  SWAP: 'SwapTransactionList.tsx',
} as const;

describe('列表页三域对齐（Task 8）', () => {
  const columnsOf = (file: string): string[] =>
    [...srcOf(file).matchAll(/\[\s*'([^']+)',\s*'\d+px'\s*\]/g)].map((m) => m[1]);

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

  it('三域都有「只看需复核」勾选框与资产类型筛选', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, src.includes('needsReviewOnly')]).toEqual([domain, true]);
      expect([domain, src.includes('All types')]).toEqual([domain, true]);
    }
  });

  it('三域状态下拉的「全部」文案统一为 All status', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      const src = srcOf(file);
      expect([domain, src.includes('>All status<')]).toEqual([domain, true]);
      expect([domain, /<option value="">All<\/option>/.test(src)]).toEqual([domain, false]);
    }
  });
});
