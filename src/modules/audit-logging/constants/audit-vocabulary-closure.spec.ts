import * as fs from 'fs';
import * as path from 'path';
import {
  AuditActions,
  V1_AUDIT_ACTIONS,
  V4_DEPOSIT_AUDIT_ACTIONS,
  V5_WITHDRAW_AUDIT_ACTIONS,
  V6_SWAP_AUDIT_ACTIONS,
  V8_RECON_AUDIT_ACTIONS,
  V2_CUSTOMER_AUDIT_ACTIONS,
  V7_TREASURY_AUDIT_ACTIONS,
  INCIDENT_AUDIT_ACTIONS,
  REG_FILING_AUDIT_ACTIONS,
  COMPLIANCE_OFFICE_AUDIT_ACTIONS,
  COMPLAINT_AUDIT_ACTIONS,
  CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS,
  CAMPAIGN_B_LP_EXCHANGE_AUDIT_ACTIONS,
  CAMPAIGN_B_CAPITAL_INJECTION_AUDIT_ACTIONS,
  CAMPAIGN_B_VENDOR_PAYMENT_AUDIT_ACTIONS,
  DEPRECATED_AUDIT_ACTIONS,
} from './audit-actions.constant';

/**
 * 站7 封册守则（2026-08-27，Phase 4 末站之锚）——词表从此永不再散。
 *
 * 两层闭合：
 *   ① 平面表归籍：AuditActions 每个串键要么在十四本名册、要么在退役闸——无籍即红；
 *   ② 写点闭合（源扫描）：全仓生产代码引用的每个动作词 ∈ 十四册，且绝不引用退役词。
 *      扫描是本守则的执法手段，不是功能绿灯——功能对错由各域行为测试负责
 *      （review-rubric 的"文本扫描自证"禁令针对后者）。
 *
 * 新词入册流程：先在对应 V*_AUDIT_ACTIONS 名册登记四属性，再接写点——
 * 顺序反了本守则当场红。
 *
 * 曾有第三层「附册封存」：一个 V3 财务配置域遗留词汇的嵌套组常量，按当日实况整册
 * 冻结（多一词少一词都红），保证正式入册前没人往里塞新词。2026-09-02（Task 15
 * 收尾）随最后两个活词（常规登录 MFA 二次校验）迁入 V1_AUDIT_ACTIONS 合同，附册
 * 本体已删除——三层闭合收窄为两层，不再需要单独测试一个不存在的常量。
 *
 * 2026-09-28（战役甲波五 T2）：第十一本入册——COMPLAINT_AUDIT_ACTIONS（投诉主体十码）。
 * 2026-09-29（战役乙波一 T2）：第十二本入册——CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS（LP 档案八码）。
 * 2026-09-29（战役乙波一 T4）：第十三本入册——CAMPAIGN_B_LP_EXCHANGE_AUDIT_ACTIONS（LP 兑换单八码）。
 * 2026-09-29（战役乙波二 T2）：第十四本入册——CAMPAIGN_B_CAPITAL_INJECTION_AUDIT_ACTIONS（注资单六码）。
 * 2026-09-29（战役乙波二 T4）：第十五本入册——CAMPAIGN_B_VENDOR_PAYMENT_AUDIT_ACTIONS（付款单六码）。
 */
const REGISTRIES: Record<string, Record<string, unknown>> = {
  V1_AUDIT_ACTIONS,
  V4_DEPOSIT_AUDIT_ACTIONS,
  V5_WITHDRAW_AUDIT_ACTIONS,
  V6_SWAP_AUDIT_ACTIONS,
  V8_RECON_AUDIT_ACTIONS,
  V2_CUSTOMER_AUDIT_ACTIONS,
  V7_TREASURY_AUDIT_ACTIONS,
  INCIDENT_AUDIT_ACTIONS,
  REG_FILING_AUDIT_ACTIONS,
  COMPLIANCE_OFFICE_AUDIT_ACTIONS,
  COMPLAINT_AUDIT_ACTIONS,
  CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS,
  CAMPAIGN_B_LP_EXCHANGE_AUDIT_ACTIONS,
  CAMPAIGN_B_CAPITAL_INJECTION_AUDIT_ACTIONS,
  CAMPAIGN_B_VENDOR_PAYMENT_AUDIT_ACTIONS,
};

const registered = new Set<string>(
  Object.values(REGISTRIES).flatMap((r) => Object.keys(r)),
);
const deprecated = new Set<string>(DEPRECATED_AUDIT_ACTIONS);

describe('站7 · 词表封册守则', () => {
  it('① 平面表归籍：每个串键 ∈ 十四册 ∪ 退役闸，无籍即红', () => {
    const flatKeys = Object.entries(AuditActions)
      .filter(([, v]) => typeof v === 'string')
      .map(([k]) => k);
    const stateless = flatKeys.filter((k) => !registered.has(k) && !deprecated.has(k));
    expect(stateless).toEqual([]);
  });

  it('② 十四册两两互斥，且与退役闸零交集', () => {
    const names = Object.keys(REGISTRIES);
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const a = new Set(Object.keys(REGISTRIES[names[i]]));
        const overlap = Object.keys(REGISTRIES[names[j]]).filter((k) => a.has(k));
        expect({ pair: `${names[i]}∩${names[j]}`, overlap }).toEqual({
          pair: `${names[i]}∩${names[j]}`,
          overlap: [],
        });
      }
    }
    expect([...registered].filter((k) => deprecated.has(k))).toEqual([]);
  });

  it('③ 写点闭合：生产代码引用的动作词 ∈ 十四册，退役词零引用', () => {
    const srcRoot = path.resolve(__dirname, '../../..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (
          entry.name.endsWith('.ts') &&
          !entry.name.includes('.spec.') &&
          !p.includes('audit-actions.constant')
        ) {
          files.push(p);
        }
      }
    };
    walk(srcRoot);

    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bAuditActions\.([A-Z][A-Z0-9_]+)\b/g)) {
        const w = m[1];
        if (!registered.has(w)) offenders.push(`${path.relative(srcRoot, f)}: AuditActions.${w}`);
      }
      // 双段词判据：审计词全部含下划线;单段大写(如资金单状态历史的 action: 'CREATE')
      // 是别家字段的合法值,不在本守则管辖。
      for (const m of src.matchAll(/\baction:\s*'([A-Z][A-Z0-9]*_[A-Z0-9_]+)'/g)) {
        const w = m[1];
        if (!registered.has(w)) {
          offenders.push(`${path.relative(srcRoot, f)}: '${w}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('④ 审计码全局唯一且禁裸名——不许再出现跨族撞车', () => {
    const contracted = Object.values(REGISTRIES).flatMap((r) => Object.keys(r));
    expect(new Set(contracted).size).toBe(contracted.length);
    const BARE = ['CREATION_REQUESTED', 'CREATION_APPLIED', 'CHANGE_REQUESTED', 'CHANGE_APPLIED',
                  'ACTIVATION_REQUESTED', 'TAG_ASSIGNED', 'CREATE_REQUESTED', 'ADDRESS_REGISTERED'];
    expect(contracted.filter((c) => BARE.includes(c))).toEqual([]);
  });
});
