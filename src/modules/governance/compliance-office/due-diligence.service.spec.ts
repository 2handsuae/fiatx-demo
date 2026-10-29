// 甲波六 T3：尽调评估主体（DDA / SCR）。Prisma 是行为化内存 mock（按 where 真读写，不认识的 where 键直接抛），
// 审计走真 AuditLogsService——每条审计都经 assertActionSpec 过闸，词表声明的必填字段与 correlationId 继承
// 是否被本服务喂对，只有让真校验跑一遍才知道。
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DueDiligenceService } from './due-diligence.service';
import { DocumentsService } from '../../../core/documents/documents.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';

const LP = 'LIQUIDITY_PROVIDER';
const VENDOR = 'OUTSOURCING_VENDOR';
const LP_NO = 'LPP261029000001';

const compliance: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-comp', userNo: 'ADM-COMP', roleCodes: ['COMPLIANCE_OFFICER'] };
const ciso: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-ciso', userNo: 'ADM-CISO', roleCodes: ['CISO'] };

const alice = { seq: 1, name: 'Alice Ng' };
const bob = { seq: 2, name: 'Bob Ito' };
const sendInput = { companyName: 'Acme Liquidity Ltd', beneficialOwners: [alice, bob], requireInfosec: false };

/** 行为化内存 mock：findUnique/findMany/update 真按 where 过滤，不认识的 where 形态当场抛——不许无视 where。 */
function makePrisma() {
  const assessments: any[] = [];
  const records: any[] = [];
  const events: any[] = [];
  const byIdempotencyKey = new Map<string, any>();

  const matchAssessment = (a: any, where: any) => {
    if (where.assessmentNo !== undefined) return a.assessmentNo === where.assessmentNo;
    if (where.targetType_targetNo) {
      return a.targetType === where.targetType_targetNo.targetType && a.targetNo === where.targetType_targetNo.targetNo;
    }
    throw new Error(`mock: unsupported dueDiligenceAssessment where ${JSON.stringify(where)}`);
  };
  const matchRecord = (r: any, where: any) => {
    const keys = Object.keys(where);
    for (const k of keys) {
      if (!['recordNo', 'assessmentId'].includes(k)) throw new Error(`mock: unsupported screeningRecord where key ${k}`);
      if (r[k] !== where[k]) return false;
    }
    return true;
  };

  return {
    dueDiligenceAssessment: {
      findUnique: jest.fn(async ({ where }: any) => assessments.find((a) => matchAssessment(a, where)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        if (assessments.some((a) => a.targetType === data.targetType && a.targetNo === data.targetNo)) {
          throw new Error('mock: unique constraint (targetType, targetNo)');
        }
        const row = {
          id: randomUUID(), riskTier: null, opinion: null, conditions: null, conclusion: null, conclusionReason: null,
          concludedAt: null, concludedByUserId: null, infosecSoc2: null, infosecIso27001: null,
          infosecDataLocationOk: null, infosecDrPlanOk: null, infosecOpinion: null, infosecVerdict: null,
          infosecByUserId: null, infosecAt: null, createdAt: new Date(), updatedAt: new Date(), ...data,
        };
        assessments.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const idx = assessments.findIndex((a) => matchAssessment(a, where));
        if (idx < 0) throw new Error(`mock: no such assessment ${JSON.stringify(where)}`);
        assessments[idx] = { ...assessments[idx], ...data, updatedAt: new Date() };
        return assessments[idx];
      }),
    },
    screeningRecord: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), evidenceDocNo: null, createdAt: new Date(), ...data };
        records.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => records.find((r) => matchRecord(r, where)) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => records.filter((r) => matchRecord(r, where ?? {}))),
      update: jest.fn(async ({ where, data }: any) => {
        const idx = records.findIndex((r) => matchRecord(r, where));
        if (idx < 0) throw new Error(`mock: no such screening record ${JSON.stringify(where)}`);
        records[idx] = { ...records[idx], ...data };
        return records[idx];
      }),
    },
    auditLogEvent: {
      findUnique: jest.fn(async ({ where }: any) => (where?.idempotencyKey ? byIdempotencyKey.get(where.idempotencyKey) ?? null : null)),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), seq: events.length + 1, ...data };
        events.push(row);
        if (row.idempotencyKey) byIdempotencyKey.set(row.idempotencyKey, row);
        return row;
      }),
    },
    auditLogSubject: { createMany: jest.fn(async (_args: any) => ({ count: 0 })) },
    __assessments: assessments,
    __records: records,
    __events: events,
  };
}

describe('DueDiligenceService (甲波六 T3)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: DueDiligenceService;
  let documents: { store: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    documents = { store: jest.fn(async () => ({ docNo: 'DOC261029000001' })) };
    const mod = await Test.createTestingModule({
      providers: [
        DueDiligenceService,
        AuditLogsService, // 真服务：每条审计过 assertActionSpec
        { provide: PrismaService, useValue: prisma },
        { provide: DocumentsService, useValue: documents },
      ],
    }).compile();
    service = mod.get(DueDiligenceService);
  });

  const actions = () => prisma.__events.map((e: any) => e.action);

  async function openLp(): Promise<string> {
    return (await service.open(LP, LP_NO, compliance)).assessmentNo;
  }
  const screen = (dto: any) => service.recordScreening(LP, LP_NO, dto, compliance);
  const green = (extra: Record<string, unknown>) => ({ listsChecked: ['UN', 'OFAC'], result: 'GREEN', ...extra });
  const company = (name = sendInput.companyName, result = 'GREEN') => screen(green({ subjectKind: 'COMPANY', subjectName: name, result }));
  const ubo = (u: { seq: number; name: string }, result = 'GREEN') =>
    screen(green({ subjectKind: 'BENEFICIAL_OWNER', subjectName: u.name, uboSeq: u.seq, result }));
  const fullyScreened = async () => { await company(); await ubo(alice); await ubo(bob); };
  const msg = async (p: Promise<unknown>): Promise<string> => {
    try { await p; } catch (e: any) { expect(e).toBeInstanceOf(BadRequestException); return e.message; }
    throw new Error('expected rejection');
  };

  // ── open ─────────────────────────────────────────────────────────────
  describe('open', () => {
    it('开两次同一目标只开一份 DDA，审计 DD_ASSESSMENT_OPENED 仅一条', async () => {
      const first = await service.open(LP, LP_NO, compliance);
      const second = await service.open(LP, LP_NO, compliance);
      expect(first.assessmentNo).toMatch(/^DDA\d{12}$/);
      expect(second.assessmentNo).toBe(first.assessmentNo);
      expect(prisma.__assessments).toHaveLength(1);
      expect(actions()).toEqual(['DD_ASSESSMENT_OPENED']);
      expect(prisma.__assessments[0]).toMatchObject({ targetType: LP, targetNo: LP_NO, createdByUserId: 'ADM-COMP' });
    });

    it('不同目标（LP 与服务商同号也算不同目标）各开各的', async () => {
      const a = await service.open(LP, 'X001', compliance);
      const b = await service.open(VENDOR, 'X001', compliance);
      expect(a.assessmentNo).not.toBe(b.assessmentNo);
      expect(prisma.__assessments).toHaveLength(2);
    });
  });

  // ── getView / recordScreening ────────────────────────────────────────
  describe('getView / recordScreening', () => {
    it('目标无评估壳 → getView 返回 null', async () => {
      expect(await service.getView(LP, 'NOPE')).toBeNull();
    });

    it('新开的壳：定档/意见/结论全空，infosec 为 null，无记录', async () => {
      const assessmentNo = await openLp();
      const view = await service.getView(LP, LP_NO);
      expect(view).toMatchObject({
        assessmentNo, targetType: LP, targetNo: LP_NO, riskTier: null, opinion: null, conditions: null,
        conclusion: null, conclusionReason: null, concludedAt: null, infosec: null, screeningRecords: [],
      });
      expect(view!.flags).toEqual({ hasRed: false, missingNames: [], infosecBlocked: false });
    });

    it('recordScreening 返回 SCR 单号，getView 列出记录且 listsChecked 为数组、recordedBy 是 ADM 号', async () => {
      await openLp();
      const { recordNo } = await screen({
        subjectKind: 'BENEFICIAL_OWNER', subjectName: 'Alice Ng', uboSeq: 1,
        listsChecked: ['UN', 'PEP', 'ADVERSE_MEDIA'], result: 'YELLOW', screenedAt: '2026-10-20T08:00:00.000Z',
      });
      expect(recordNo).toMatch(/^SCR\d{12}$/);
      const view = await service.getView(LP, LP_NO);
      expect(view!.screeningRecords).toEqual([{
        recordNo, subjectKind: 'BENEFICIAL_OWNER', subjectName: 'Alice Ng', uboSeq: 1,
        listsChecked: ['UN', 'PEP', 'ADVERSE_MEDIA'], result: 'YELLOW',
        screenedAt: '2026-10-20T08:00:00.000Z', evidenceDocNo: null, recordedBy: 'ADM-COMP',
      }]);
      expect(Array.isArray(view!.screeningRecords[0].listsChecked)).toBe(true);
      expect(JSON.stringify(view)).not.toMatch(/uuid-comp/); // 零 UUID
    });

    it('COMPANY 记录的 uboSeq 恒落 null；screenedAt 缺省取当下', async () => {
      await openLp();
      const before = Date.now();
      await screen(green({ subjectKind: 'COMPANY', subjectName: sendInput.companyName, uboSeq: 9 }));
      const rec = (await service.getView(LP, LP_NO))!.screeningRecords[0];
      expect(rec.uboSeq).toBeNull();
      expect(new Date(rec.screenedAt).getTime()).toBeGreaterThanOrEqual(before);
    });

    it('目标无评估壳 → recordScreening 404', async () => {
      await expect(screen(green({ subjectKind: 'COMPANY', subjectName: 'x' }))).rejects.toThrow(NotFoundException);
    });

    it('记录审计 DD_SCREENING_RECORDED：metadata 带对象名/名单/结果/uboSeq', async () => {
      await openLp();
      await ubo(alice, 'RED');
      const ev = prisma.__events.find((e: any) => e.action === 'DD_SCREENING_RECORDED');
      expect(JSON.parse(ev.metadata)).toMatchObject({
        subjectKind: 'BENEFICIAL_OWNER', subjectName: 'Alice Ng', uboSeq: 1, listsChecked: ['UN', 'OFAC'], result: 'RED',
      });
    });
  });

  // ── attachEvidence ───────────────────────────────────────────────────
  describe('attachEvidence', () => {
    const file = { originalname: 'hit.png', mimetype: 'image/png', size: 10, buffer: Buffer.from('x') };

    it('先按 recordNo 找到记录，再调 documents.store(SCREENING_RECORD 归属)，回写 evidenceDocNo', async () => {
      await openLp();
      const { recordNo } = await company();
      const r = await service.attachEvidence(recordNo, file, compliance);
      expect(r).toEqual({ docNo: 'DOC261029000001' });
      expect(documents.store).toHaveBeenCalledWith(
        { ownerType: 'SCREENING_RECORD', ownerNo: recordNo, docType: 'SCREENING_EVIDENCE', file },
        compliance,
      );
      const rec = (await service.getView(LP, LP_NO))!.screeningRecords[0];
      expect(rec.evidenceDocNo).toBe('DOC261029000001');
    });

    it('recordNo 不存在 → 404，且不碰 documents.store', async () => {
      await expect(service.attachEvidence('SCR_NOPE', file, compliance)).rejects.toThrow(NotFoundException);
      expect(documents.store).not.toHaveBeenCalled();
    });
  });

  // ── saveAssessment / recordInfosec ───────────────────────────────────
  describe('saveAssessment / recordInfosec', () => {
    it('saveAssessment 落风险档/意见/附加条件，可覆盖；审计 DD_ASSESSMENT_SAVED 带 riskTier', async () => {
      await openLp();
      await service.saveAssessment(LP, LP_NO, { riskTier: 'MEDIUM', opinion: 'ok', conditions: 'USDT/AED spot only' }, compliance);
      expect(await service.getView(LP, LP_NO)).toMatchObject({ riskTier: 'MEDIUM', opinion: 'ok', conditions: 'USDT/AED spot only' });
      await service.saveAssessment(LP, LP_NO, { riskTier: 'HIGH', opinion: 'revised' }, compliance);
      expect(await service.getView(LP, LP_NO)).toMatchObject({ riskTier: 'HIGH', opinion: 'revised', conditions: null });
      const saved = prisma.__events.filter((e: any) => e.action === 'DD_ASSESSMENT_SAVED');
      expect(saved).toHaveLength(2);
      expect(JSON.parse(saved[1].metadata)).toMatchObject({ riskTier: 'HIGH' });
    });

    it('recordInfosec 落 CISO 评估，view.infosec 映射字段名；审计 DD_INFOSEC_RECORDED 带 verdict', async () => {
      const assessmentNo = await service.open(VENDOR, 'VEN001', compliance).then((r) => r.assessmentNo);
      await service.recordInfosec(VENDOR, 'VEN001', {
        soc2: 'HAS', iso27001: 'EXPIRED', dataLocationAcceptable: true, drPlanAcceptable: false,
        opinion: 'DR plan thin', verdict: 'ACCEPTABLE',
      }, ciso);
      const view = (await service.getView(VENDOR, 'VEN001'))!;
      expect(view.assessmentNo).toBe(assessmentNo);
      expect(view.infosec).toMatchObject({
        soc2: 'HAS', iso27001: 'EXPIRED', dataLocationAcceptable: true, drPlanAcceptable: false,
        opinion: 'DR plan thin', verdict: 'ACCEPTABLE', recordedBy: 'ADM-CISO',
      });
      expect(typeof view.infosec!.recordedAt).toBe('string');
      const ev = prisma.__events.find((e: any) => e.action === 'DD_INFOSEC_RECORDED');
      expect(JSON.parse(ev.metadata)).toMatchObject({ verdict: 'ACCEPTABLE', soc2: 'HAS', iso27001: 'EXPIRED' });
    });
  });

  // ── assertSendable：五道顺序检查 ─────────────────────────────────────
  describe('assertSendable', () => {
    it('有 RED 记录 → 400 含 "RED"；先于缺名检查（RED + 缺名时报 RED）', async () => {
      await openLp();
      await company(sendInput.companyName, 'RED'); // alice/bob 都没筛
      const m = await msg(service.assertSendable(LP, LP_NO, sendInput));
      expect(m).toBe('Screening hit (RED) — only REJECT is allowed');
    });

    it('RED 记录属于已被删除的人也照拦（字面规则：评估下任一记录为红）', async () => {
      await openLp();
      await company(); await ubo(alice);
      await ubo({ seq: 3, name: 'Removed Person' }, 'RED');
      await service.saveAssessment(LP, LP_NO, { riskTier: 'LOW', opinion: 'x' }, compliance);
      const m = await msg(service.assertSendable(LP, LP_NO, { ...sendInput, beneficialOwners: [alice] }));
      expect(m).toContain('RED');
    });

    it('UBO seq 2 无记录 → "Screening missing for: <name>"', async () => {
      await openLp();
      await company(); await ubo(alice);
      expect(await msg(service.assertSendable(LP, LP_NO, sendInput))).toBe('Screening missing for: Bob Ito');
    });

    it('公司名与多位 UBO 都缺 → 逗号分隔，按输入顺序（公司在前）', async () => {
      await openLp();
      expect(await msg(service.assertSendable(LP, LP_NO, sendInput)))
        .toBe('Screening missing for: Acme Liquidity Ltd, Alice Ng, Bob Ito');
    });

    it('R4(a)：seq 1 曾筛 "Alice"，现 seq 1 换成 "Bob" → 缺 Bob（不继承被删者的记录）', async () => {
      await openLp();
      await company();
      await ubo({ seq: 1, name: 'Alice' });
      const input = { ...sendInput, beneficialOwners: [{ seq: 1, name: 'Bob' }] };
      expect(await msg(service.assertSendable(LP, LP_NO, input))).toBe('Screening missing for: Bob');
    });

    it('R4(b)：记录名与现名只差大小写/首尾空白 → 算已筛', async () => {
      await openLp();
      await screen(green({ subjectKind: 'COMPANY', subjectName: '  ACME liquidity LTD ' }));
      await screen(green({ subjectKind: 'BENEFICIAL_OWNER', subjectName: 'alice NG', uboSeq: 1 }));
      await screen(green({ subjectKind: 'BENEFICIAL_OWNER', subjectName: ' Bob Ito', uboSeq: 2 }));
      await service.saveAssessment(LP, LP_NO, { riskTier: 'LOW', opinion: 'x' }, compliance);
      await expect(service.assertSendable(LP, LP_NO, sendInput)).resolves.toBeUndefined();
    });

    it('同名但 seq 对不上不算；UBO 记录不能顶替公司记录', async () => {
      await openLp();
      await ubo({ seq: 1, name: sendInput.companyName }); // 公司名被当 UBO 筛了——公司本体仍缺
      await ubo({ seq: 5, name: bob.name });               // Bob 的 seq 是 2，不是 5
      await ubo(alice);
      expect(await msg(service.assertSendable(LP, LP_NO, sendInput)))
        .toBe('Screening missing for: Acme Liquidity Ltd, Bob Ito');
    });

    it('已删除的人的记录留着但不计入：UBO 列表缩短后，其余人全筛即过', async () => {
      await openLp(); await fullyScreened();
      await service.saveAssessment(LP, LP_NO, { riskTier: 'LOW', opinion: 'x' }, compliance);
      await expect(service.assertSendable(LP, LP_NO, { ...sendInput, beneficialOwners: [alice] })).resolves.toBeUndefined();
    });

    it('riskTier 空 → "Risk tier not set"（名字已全筛）', async () => {
      await openLp(); await fullyScreened();
      expect(await msg(service.assertSendable(LP, LP_NO, sendInput))).toBe('Risk tier not set');
    });

    it('requireInfosec 且无 CISO 结论 → "Waiting for CISO information-security assessment"', async () => {
      await openLp(); await fullyScreened();
      await service.saveAssessment(LP, LP_NO, { riskTier: 'LOW', opinion: 'x' }, compliance);
      expect(await msg(service.assertSendable(LP, LP_NO, { ...sendInput, requireInfosec: true })))
        .toBe('Waiting for CISO information-security assessment');
    });

    it('CISO UNACCEPTABLE → 400 含 "UNACCEPTABLE"（即便 requireInfosec 为 false 也拦）', async () => {
      await openLp(); await fullyScreened();
      await service.saveAssessment(LP, LP_NO, { riskTier: 'LOW', opinion: 'x' }, compliance);
      await service.recordInfosec(LP, LP_NO, {
        soc2: 'NONE', iso27001: 'NONE', dataLocationAcceptable: false, drPlanAcceptable: false, opinion: 'no', verdict: 'UNACCEPTABLE',
      }, ciso);
      for (const requireInfosec of [true, false]) {
        expect(await msg(service.assertSendable(LP, LP_NO, { ...sendInput, requireInfosec })))
          .toBe('CISO verdict UNACCEPTABLE — only REJECT is allowed');
      }
    });

    it('全绿（含黄）+ 定档 + 无需 infosec → 不抛；黄不拦', async () => {
      await openLp();
      await company(sendInput.companyName, 'YELLOW'); await ubo(alice); await ubo(bob);
      await service.saveAssessment(LP, LP_NO, { riskTier: 'MEDIUM', opinion: 'x' }, compliance);
      await expect(service.assertSendable(LP, LP_NO, sendInput)).resolves.toBeUndefined();
    });

    it('requireInfosec + CISO ACCEPTABLE + 其余齐备 → 不抛', async () => {
      await openLp(); await fullyScreened();
      await service.saveAssessment(LP, LP_NO, { riskTier: 'LOW', opinion: 'x' }, compliance);
      await service.recordInfosec(LP, LP_NO, {
        soc2: 'HAS', iso27001: 'HAS', dataLocationAcceptable: true, drPlanAcceptable: true, opinion: 'fine', verdict: 'ACCEPTABLE',
      }, ciso);
      await expect(service.assertSendable(LP, LP_NO, { ...sendInput, requireInfosec: true })).resolves.toBeUndefined();
    });

    it('目标无评估壳 → 404', async () => {
      await expect(service.assertSendable(LP, 'NOPE', sendInput)).rejects.toThrow(NotFoundException);
    });
  });

  // ── getView.flags ────────────────────────────────────────────────────
  describe('flags', () => {
    it('带 input：flags 给出 hasRed / missingNames / infosecBlocked；不带 input：missingNames 恒空', async () => {
      await openLp();
      await company(); await ubo(alice, 'RED');
      await service.recordInfosec(LP, LP_NO, {
        soc2: 'NONE', iso27001: 'NONE', dataLocationAcceptable: false, drPlanAcceptable: false, opinion: 'no', verdict: 'UNACCEPTABLE',
      }, ciso);
      expect((await service.getView(LP, LP_NO, sendInput))!.flags)
        .toEqual({ hasRed: true, missingNames: ['Bob Ito'], infosecBlocked: true });
      expect((await service.getView(LP, LP_NO))!.flags)
        .toEqual({ hasRed: true, missingNames: [], infosecBlocked: true });
    });
  });

  // ── assertReturnable（终审 F1：红灯 / CISO 不可接受 → 只许不通过，退回亦拒）─────────────
  describe('assertReturnable', () => {
    const unacceptable = {
      soc2: 'NONE', iso27001: 'NONE', dataLocationAcceptable: false, drPlanAcceptable: false, opinion: 'no', verdict: 'UNACCEPTABLE',
    };

    it('任一筛查记录为红 → 400 "Screening hit (RED) — only REJECT is allowed"；什么都没写（无新审计、无结论）', async () => {
      await openLp();
      await company(); await ubo(alice, 'RED');
      const auditsBefore = prisma.__events.length;
      expect(await msg(service.assertReturnable(LP, LP_NO))).toBe('Screening hit (RED) — only REJECT is allowed');
      expect(prisma.__events.length).toBe(auditsBefore);
      expect((await service.getView(LP, LP_NO))!.conclusion).toBeNull();
    });

    it('CISO 结论不可接受 → 400 "CISO verdict UNACCEPTABLE — only REJECT is allowed"', async () => {
      await openLp();
      await service.recordInfosec(LP, LP_NO, unacceptable as any, ciso);
      expect(await msg(service.assertReturnable(LP, LP_NO))).toBe('CISO verdict UNACCEPTABLE — only REJECT is allowed');
    });

    it('红灯与 CISO 不可接受并存 → 红灯文案在前（与 assertSendable 同序）', async () => {
      await openLp();
      await company(sendInput.companyName, 'RED');
      await service.recordInfosec(LP, LP_NO, unacceptable as any, ciso);
      expect(await msg(service.assertReturnable(LP, LP_NO))).toBe('Screening hit (RED) — only REJECT is allowed');
    });

    it('只有绿 / 黄 → 放行；退回不要求名字全筛、不要求定档、不要求 CISO（②③④ 只拦送审）', async () => {
      await openLp();
      await expect(service.assertReturnable(LP, LP_NO)).resolves.toBeUndefined(); // 一条记录都没有
      await company(sendInput.companyName, 'YELLOW'); await ubo(alice, 'GREEN');   // Bob 没筛、没定档
      await expect(service.assertReturnable(LP, LP_NO)).resolves.toBeUndefined();
    });

    it('CISO 可接受 → 放行', async () => {
      await openLp();
      await service.recordInfosec(LP, LP_NO, {
        soc2: 'HAS', iso27001: 'HAS', dataLocationAcceptable: true, drPlanAcceptable: true, opinion: 'fine', verdict: 'ACCEPTABLE',
      }, ciso);
      await expect(service.assertReturnable(LP, LP_NO)).resolves.toBeUndefined();
    });

    it('目标无评估壳 → 404', async () => {
      await expect(service.assertReturnable(LP, 'NOPE')).rejects.toThrow(NotFoundException);
    });
  });

  // ── conclude ─────────────────────────────────────────────────────────
  describe('conclude', () => {
    it('RETURNED / REJECTED 无 reason → 400，不落库不留审计；带 reason → 落库并审计 DD_ASSESSMENT_CONCLUDED', async () => {
      await openLp();
      await service.saveAssessment(LP, LP_NO, { riskTier: 'HIGH', opinion: 'x' }, compliance);
      const auditsBefore = prisma.__events.length;
      for (const conclusion of ['RETURNED', 'REJECTED']) {
        await expect(service.conclude(LP, LP_NO, { conclusion }, compliance)).rejects.toThrow(BadRequestException);
        await expect(service.conclude(LP, LP_NO, { conclusion, reason: '   ' }, compliance)).rejects.toThrow(BadRequestException);
      }
      expect(prisma.__events.length).toBe(auditsBefore);
      expect((await service.getView(LP, LP_NO))!.conclusion).toBeNull();

      await service.conclude(LP, LP_NO, { conclusion: 'RETURNED', reason: 'Need audited financials' }, compliance);
      const view = (await service.getView(LP, LP_NO))!;
      expect(view).toMatchObject({ conclusion: 'RETURNED', conclusionReason: 'Need audited financials' });
      expect(typeof view.concludedAt).toBe('string');
      const ev = prisma.__events.filter((e: any) => e.action === 'DD_ASSESSMENT_CONCLUDED');
      expect(ev).toHaveLength(1);
      expect(JSON.parse(ev[0].metadata)).toMatchObject({ conclusion: 'RETURNED', reason: 'Need audited financials', riskTier: 'HIGH' });
    });

    it('结论覆盖存最新一轮：先退回，再送审 → conclusion 变 SENT_FOR_APPROVAL、退回原因清空（SENT_FOR_APPROVAL 不需 reason）', async () => {
      await openLp();
      await service.conclude(LP, LP_NO, { conclusion: 'RETURNED', reason: 'missing docs' }, compliance);
      await service.conclude(LP, LP_NO, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);
      expect(await service.getView(LP, LP_NO)).toMatchObject({ conclusion: 'SENT_FOR_APPROVAL', conclusionReason: null });
      expect(actions().filter((a: string) => a === 'DD_ASSESSMENT_CONCLUDED')).toHaveLength(2);
    });

    it('conclude 自己不做送审硬规则检查（由 workflow 先调 assertSendable）：有 RED 也能落 REJECTED，不在这层拦 SENT_FOR_APPROVAL', async () => {
      await openLp();
      await company(sendInput.companyName, 'RED');
      await service.conclude(LP, LP_NO, { conclusion: 'REJECTED', reason: 'sanctions hit' }, compliance);
      expect((await service.getView(LP, LP_NO))!.conclusion).toBe('REJECTED');
    });
  });

  // ── 审计信封：四属性过闸 ─────────────────────────────────────────────
  describe('audit envelope (real AuditLogsService.assertActionSpec)', () => {
    it('走完全部写点：每条审计都过闸不抛，correlationId 恒等于 assessmentNo，primary = 评估壳、目标为 RELATED', async () => {
      const assessmentNo = await openLp();
      const { recordNo } = await company();
      await service.attachEvidence(recordNo, { originalname: 'a.pdf', mimetype: 'application/pdf', size: 1, buffer: Buffer.from('x') }, compliance);
      await service.saveAssessment(LP, LP_NO, { riskTier: 'LOW', opinion: 'x' }, compliance);
      await service.recordInfosec(LP, LP_NO, {
        soc2: 'HAS', iso27001: 'HAS', dataLocationAcceptable: true, drPlanAcceptable: true, opinion: 'ok', verdict: 'ACCEPTABLE',
      }, ciso);
      await service.conclude(LP, LP_NO, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);

      expect(actions()).toEqual([
        'DD_ASSESSMENT_OPENED', 'DD_SCREENING_RECORDED', 'DD_ASSESSMENT_SAVED', 'DD_INFOSEC_RECORDED', 'DD_ASSESSMENT_CONCLUDED',
      ]);
      for (const e of prisma.__events) {
        expect(e).toMatchObject({
          actionDomain: 'GOVERNANCE', category: 'GOVERNANCE', correlationId: assessmentNo,
          primarySubjectType: 'DUE_DILIGENCE_ASSESSMENT', primarySubjectNo: assessmentNo,
          actorNo: e.action === 'DD_INFOSEC_RECORDED' ? 'ADM-CISO' : 'ADM-COMP',
        });
        expect(e.requestId).toContain(assessmentNo);
      }
      expect(prisma.auditLogSubject.createMany).toHaveBeenCalled();
      const subjectCalls = prisma.auditLogSubject.createMany.mock.calls.map((c: any) => c[0].data);
      const openedSubjects = subjectCalls[0];
      expect(openedSubjects.map((s: any) => [s.subjectType, s.subjectNo, s.subjectRole])).toEqual(expect.arrayContaining([
        ['DUE_DILIGENCE_ASSESSMENT', assessmentNo, 'PRIMARY'],
        ['LIQUIDITY_PROVIDER', LP_NO, 'RELATED'],
      ]));
    });

    it('服务商线：目标 RELATED 主体类型是 OUTSOURCING_VENDOR', async () => {
      const { assessmentNo } = await service.open(VENDOR, 'VEN001', compliance);
      const subjects = prisma.auditLogSubject.createMany.mock.calls[0][0].data;
      expect(subjects.map((s: any) => [s.subjectType, s.subjectNo, s.subjectRole])).toEqual(expect.arrayContaining([
        ['DUE_DILIGENCE_ASSESSMENT', assessmentNo, 'PRIMARY'],
        ['OUTSOURCING_VENDOR', 'VEN001', 'RELATED'],
      ]));
    });
  });
});
