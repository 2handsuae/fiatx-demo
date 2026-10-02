import { BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AgreementsClientController } from './agreements.client.controller';
import { AgreementsReadService } from './agreements-read.service';
import { AGREEMENT_BODIES } from './agreement-versions.constant';

// 战役丙波三 T6：控制器是薄壳，故这里用【真的】AgreementsReadService 配行为化的内存 prisma
// ——"在途版 DECLINED → 400"必须是 T2 真校验抛出来的，而不是 mock 事先编好的异常。
// 响应形状一律 Object.keys 全等（白名单封条：版本行的 status / publishedAt / id 等内部列不许漏出去）。

type VersionRow = {
  id: string;
  versionKey: string;
  status: string;
  summary: string;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  pendingApprovalNo: string | null;
};
type ConsentRow = { id: string; customerId: string; customerNo: string; versionKey: string; action: string; actedAt: Date };

const DAY = 24 * 60 * 60 * 1000;
const PAST = new Date(Date.now() - 60 * DAY);
const FUTURE = new Date(Date.now() + 30 * DAY);

function fieldMatches(actual: any, cond: any): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('lte' in cond) return actual != null && actual.getTime() <= cond.lte.getTime();
    throw new Error(`mock: unsupported where operator ${JSON.stringify(cond)}`);
  }
  return actual === cond;
}
const rowMatches = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => fieldMatches(row[k], v));

function makeRealReadService(opts: { versions: VersionRow[]; consents?: ConsentRow[] }) {
  const versions = opts.versions;
  const consents: ConsentRow[] = [...(opts.consents ?? [])];
  let seq = 0;
  const prisma: any = {
    customerAgreementVersion: {
      findFirst: jest.fn(async ({ where }: any = {}) => versions.find((r) => rowMatches(r, where)) ?? null),
      findUnique: jest.fn(async ({ where }: any) => versions.find((r) => rowMatches(r, where)) ?? null),
    },
    customerAgreementConsent: {
      findMany: jest.fn(async ({ where }: any = {}) =>
        consents.filter((r) => rowMatches(r, where)).sort((a, b) => b.actedAt.getTime() - a.actedAt.getTime()),
      ),
      create: jest.fn(async ({ data }: any) => {
        seq += 1;
        const row: ConsentRow = { id: `consent-${seq}`, actedAt: new Date(), ...data };
        consents.push(row);
        return row;
      }),
    },
  };
  const auditLogs: any = { recordSystem: jest.fn(async () => ({})), recordByActor: jest.fn(async () => ({})) };
  return { service: new AgreementsReadService(prisma, auditLogs), consents, auditLogs };
}

const v1Effective = (): VersionRow => ({
  id: 'id-v1', versionKey: 'v1', status: 'EFFECTIVE', summary: 'summary of v1',
  effectiveAt: PAST, publishedAt: PAST, pendingApprovalNo: null,
});
const v2Published = (): VersionRow => ({
  id: 'id-v2', versionKey: 'v2', status: 'PUBLISHED', summary: 'summary of v2',
  effectiveAt: FUTURE, publishedAt: new Date(), pendingApprovalNo: 'APR-1',
});

const v1Superseded = (): VersionRow => ({ ...v1Effective(), status: 'SUPERSEDED' });
const v2Effective = (): VersionRow => ({ ...v2Published(), status: 'EFFECTIVE', effectiveAt: PAST, pendingApprovalNo: null });

const VIEW_KEYS = ['effectiveAt', 'sections', 'summary', 'versionKey'];
const CONSENT_KEYS = ['acceptedAt', 'acceptedCurrent', 'acceptedPending', 'acceptedVersionKey', 'declinedCurrentAt'];
const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-uuid-1', userNo: 'CU250907001' } };

async function buildController(read: AgreementsReadService) {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [AgreementsClientController],
    providers: [{ provide: AgreementsReadService, useValue: read }],
  }).compile();
  return module.get(AgreementsClientController);
}

describe('AgreementsClientController', () => {
  describe('GET /client/agreements/current（公开）', () => {
    it('响应键恰为 {versionKey, effectiveAt, summary, sections}——版本行的 status/publishedAt 等不外漏', async () => {
      const { service } = makeRealReadService({ versions: [v1Effective(), v2Published()] });
      const controller = await buildController(service);

      const out = await controller.current();

      expect(Object.keys(out).sort()).toEqual(VIEW_KEYS);
      expect(out.versionKey).toBe('v1');
      expect(out.effectiveAt).toEqual(PAST);
      expect(out.summary).toBe('summary of v1');
      expect(out.sections).toBe(AGREEMENT_BODIES.v1);
    });

    it('取的是生效版而非在途版（有在途 v2 时仍返回 v1）', async () => {
      const { service } = makeRealReadService({ versions: [v1Effective(), v2Published()] });
      const controller = await buildController(service);

      expect((await controller.current()).versionKey).toBe('v1');
    });
  });

  describe('GET /client/agreements/me（登录）', () => {
    it('有在途版：current / pending 各自键恰为四键（都带 sections），previous 为 null，consent 恰为五键', async () => {
      const { service } = makeRealReadService({
        versions: [v1Effective(), v2Published()],
        consents: [
          { id: 'x1', customerId: 'cust-uuid-1', customerNo: 'CU250907001', versionKey: 'v1', action: 'ACCEPTED', actedAt: PAST },
        ],
      });
      const controller = await buildController(service);

      const out = await controller.me(customerReq);

      expect(Object.keys(out).sort()).toEqual(['consent', 'current', 'pending', 'previous']);
      expect(Object.keys(out.current).sort()).toEqual(VIEW_KEYS);
      expect(Object.keys(out.pending!).sort()).toEqual(VIEW_KEYS);
      expect(out.previous).toBeNull();
      expect(Object.keys(out.consent).sort()).toEqual(CONSENT_KEYS);
      expect(out.current.versionKey).toBe('v1');
      expect(out.current.sections).toBe(AGREEMENT_BODIES.v1);
      expect(out.pending!.versionKey).toBe('v2');
      expect(out.pending!.sections).toBe(AGREEMENT_BODIES.v2);
      expect(out.consent).toMatchObject({ acceptedVersionKey: 'v1', acceptedCurrent: true, acceptedPending: false });
    });

    it('无在途版：pending 恒为 null（键仍在）', async () => {
      const { service } = makeRealReadService({ versions: [v1Effective()] });
      const controller = await buildController(service);

      const out = await controller.me(customerReq);

      expect(Object.keys(out).sort()).toEqual(['consent', 'current', 'pending', 'previous']);
      expect(out.pending).toBeNull();
      expect(out.consent.acceptedCurrent).toBe(false);
    });

    it('v1 SUPERSEDED + v2 EFFECTIVE（⚡快进后）：previous=v1 且带 sections、键恰为四键；current=v2；pending=null', async () => {
      const { service } = makeRealReadService({ versions: [v1Superseded(), v2Effective()] });
      const controller = await buildController(service);

      const out = await controller.me(customerReq);

      expect(out.current.versionKey).toBe('v2');
      expect(out.pending).toBeNull();
      expect(Object.keys(out.previous!).sort()).toEqual(VIEW_KEYS);
      expect(out.previous!.versionKey).toBe('v1');
      expect(out.previous!.summary).toBe('summary of v1');
      expect(out.previous!.sections).toBe(AGREEMENT_BODIES.v1);
    });

    it('无 SUPERSEDED 版：previous 为 null（键仍在）', async () => {
      const { service } = makeRealReadService({ versions: [v1Effective()] });
      const controller = await buildController(service);

      const out = await controller.me(customerReq);

      expect('previous' in out).toBe(true);
      expect(out.previous).toBeNull();
    });

    it('consent 只看本人：别的客户的同意行不算数（按 customerId 取）', async () => {
      const { service } = makeRealReadService({
        versions: [v1Effective()],
        consents: [
          { id: 'o1', customerId: 'someone-else', customerNo: 'CU999', versionKey: 'v1', action: 'ACCEPTED', actedAt: PAST },
        ],
      });
      const controller = await buildController(service);

      expect((await controller.me(customerReq)).consent.acceptedCurrent).toBe(false);
    });

    it('非客户 token → 403', async () => {
      const { service } = makeRealReadService({ versions: [v1Effective()] });
      const controller = await buildController(service);

      await expect(controller.me({ user: { type: 'ADMIN', userId: 'a1' } })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('POST /client/agreements/:versionKey/consent（登录）', () => {
    it('对生效版 ACCEPTED：落一行台账（customerId=JWT 内部 id、customerNo=JWT 业务号）+ source=PAGE 的审计，返回空体', async () => {
      const { service, consents, auditLogs } = makeRealReadService({ versions: [v1Effective(), v2Published()] });
      const controller = await buildController(service);

      const out = await controller.consent(customerReq, 'v1', { action: 'ACCEPTED' });

      expect(out).toBeUndefined();
      expect(consents).toHaveLength(1);
      expect(consents[0]).toMatchObject({ customerId: 'cust-uuid-1', customerNo: 'CU250907001', versionKey: 'v1', action: 'ACCEPTED' });
      expect(auditLogs.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'PAGE', versionKey: 'v1', ownerCustomerNo: 'CU250907001' }),
        expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CU250907001' }),
      );
    });

    it('body.source：弹窗传 MODAL 落 MODAL；缺省与 PAGE 落 PAGE；冒充 REGISTER 一律按 PAGE（注册口只由注册链路写）', async () => {
      const { service, auditLogs } = makeRealReadService({ versions: [v1Effective(), v2Published()] });
      const controller = await buildController(service);
      const sourceOfLastAudit = () => (auditLogs.recordByActor.mock.calls.at(-1)![0] as any).source;

      await controller.consent(customerReq, 'v1', { action: 'ACCEPTED', source: 'MODAL' });
      expect(sourceOfLastAudit()).toBe('MODAL');
      await controller.consent(customerReq, 'v1', { action: 'ACCEPTED' });
      expect(sourceOfLastAudit()).toBe('PAGE');
      await controller.consent(customerReq, 'v1', { action: 'ACCEPTED', source: 'REGISTER' as any });
      expect(sourceOfLastAudit()).toBe('PAGE');
    });

    it('对在途版 ACCEPTED 可落（提前同意）', async () => {
      const { service, consents } = makeRealReadService({ versions: [v1Effective(), v2Published()] });
      const controller = await buildController(service);

      await controller.consent(customerReq, 'v2', { action: 'ACCEPTED' });

      expect(consents.map((c) => `${c.versionKey}/${c.action}`)).toEqual(['v2/ACCEPTED']);
    });

    it('对在途版 DECLINED → 400（T2 的校验原样透传），台账不落行', async () => {
      const { service, consents, auditLogs } = makeRealReadService({ versions: [v1Effective(), v2Published()] });
      const controller = await buildController(service);

      await expect(controller.consent(customerReq, 'v2', { action: 'DECLINED' })).rejects.toBeInstanceOf(BadRequestException);
      expect(consents).toHaveLength(0);
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });

    it('不在 {生效版, 在途版} 内的版本号 → 400（透传）', async () => {
      const { service, consents } = makeRealReadService({ versions: [v1Effective(), v2Published()] });
      const controller = await buildController(service);

      await expect(controller.consent(customerReq, 'v9', { action: 'ACCEPTED' })).rejects.toBeInstanceOf(BadRequestException);
      expect(consents).toHaveLength(0);
    });

    it('非客户 token → 403，且不触台账', async () => {
      const { service, consents } = makeRealReadService({ versions: [v1Effective()] });
      const controller = await buildController(service);

      await expect(
        controller.consent({ user: { type: 'ADMIN', userId: 'a1', userNo: 'A1' } }, 'v1', { action: 'ACCEPTED' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(consents).toHaveLength(0);
    });
  });

  describe('路由登记（元数据，运行时读回——不是扫源码文本）', () => {
    const proto = AgreementsClientController.prototype;

    it('current 公开：方法与类上都没有 guard；me / consent 各挂一个 guard', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, AgreementsClientController)).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, proto.current)).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, proto.me)).toHaveLength(1);
      expect(Reflect.getMetadata(GUARDS_METADATA, proto.consent)).toHaveLength(1);
    });

    it('路径与方法：GET current / GET me / POST :versionKey/consent，前缀 client/agreements；consent 返回 204', () => {
      expect(Reflect.getMetadata(PATH_METADATA, AgreementsClientController)).toBe('client/agreements');
      expect(Reflect.getMetadata(PATH_METADATA, proto.current)).toBe('current');
      expect(Reflect.getMetadata(METHOD_METADATA, proto.current)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(PATH_METADATA, proto.me)).toBe('me');
      expect(Reflect.getMetadata(METHOD_METADATA, proto.me)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(PATH_METADATA, proto.consent)).toBe(':versionKey/consent');
      expect(Reflect.getMetadata(METHOD_METADATA, proto.consent)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.consent)).toBe(HttpStatus.NO_CONTENT);
    });
  });
});
