import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { inlineContentDisposition } from './documents.controller';
import { DOCUMENT_LIMITS, DOCUMENT_OWNER_TYPES } from './documents.constants';
import { AuditLogsService } from '../../modules/audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../../modules/governance/approvals/constants/approval.constants';

const ops: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPERATIONS'] };

const pdfFile = (overrides: Partial<{ originalname: string; mimetype: string; size: number; buffer: Buffer }> = {}) => {
  const buffer = overrides.buffer ?? Buffer.from('%PDF-1.4\n%placeholder\n');
  return { originalname: 'Contract.pdf', mimetype: 'application/pdf', size: buffer.length, buffer, ...overrides };
};

/** 行为化内存行 mock：findMany / findUnique 真按 where 过滤（不是无脑 resolve 全表）。 */
function makePrisma() {
  const rows: any[] = [];
  const matches = (row: any, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    storedDocument: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), uploadedAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
        const hit = rows.filter((r) => matches(r, where));
        if (orderBy?.uploadedAt === 'asc') hit.sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime());
        return hit;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
    },
  };
}

describe('DocumentsService', () => {
  let dir: string;
  let prevEnv: string | undefined;
  let prisma: ReturnType<typeof makePrisma>;
  let audits: any[];
  let auditLogs: { recordByActor: jest.Mock };
  let service: DocumentsService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-spec-'));
    prevEnv = process.env.FILE_STORAGE_DIR;
    process.env.FILE_STORAGE_DIR = dir;
    prisma = makePrisma();
    audits = [];
    // 生产那道词表校验亲自跑一遍每条信封（缺必填 / 域不符当场抛，同生产）
    const realSpec = new AuditLogsService(null as any);
    auditLogs = {
      recordByActor: jest.fn(async (input: any, actor: any) => {
        (realSpec as any).assertActionSpec(input);
        audits.push({ input, actor });
      }),
    };
    service = new DocumentsService(prisma as any, auditLogs as any);
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = prevEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('store：PDF 落到 <dir>/<ownerType>/<ownerNo>/<docNo>.pdf，返回 DOC 开头单号，写 DOCUMENT_UPLOADED 审计', async () => {
    const file = pdfFile();
    const { docNo } = await service.store(
      { ownerType: DOCUMENT_OWNER_TYPES.OUTSOURCING_VENDOR, ownerNo: 'VEN261029000001', docType: 'CONTRACT', file },
      ops,
    );

    expect(docNo).toMatch(/^DOC\d{12}$/);
    const onDisk = path.join(dir, 'OUTSOURCING_VENDOR', 'VEN261029000001', `${docNo}.pdf`);
    expect(fs.readFileSync(onDisk).equals(file.buffer)).toBe(true);

    // 元数据行：上传人存 userNo（管理台零 UUID），路径即落盘路径
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toMatchObject({
      docNo, ownerType: 'OUTSOURCING_VENDOR', ownerNo: 'VEN261029000001', docType: 'CONTRACT',
      originalName: 'Contract.pdf', mimeType: 'application/pdf', sizeBytes: file.size,
      storagePath: onDisk, uploadedByUserId: 'ADM-OPS',
    });

    // 审计：过了真 assertActionSpec（域 GOVERNANCE、必填 docType 顶层）
    expect(audits).toHaveLength(1);
    const { input, actor } = audits[0];
    expect(input).toMatchObject({
      action: 'DOCUMENT_UPLOADED', actionDomain: 'GOVERNANCE',
      primarySubjectType: 'STORED_DOCUMENT', primarySubjectNo: docNo,
      docType: 'CONTRACT',
      metadata: { ownerType: 'OUTSOURCING_VENDOR', ownerNo: 'VEN261029000001', docType: 'CONTRACT', originalName: 'Contract.pdf', sizeBytes: file.size },
    });
    expect(input.subjects).toEqual([
      { subjectType: 'STORED_DOCUMENT', subjectNo: docNo, subjectRole: 'PRIMARY' },
      { subjectType: 'OUTSOURCING_VENDOR', subjectNo: 'VEN261029000001', subjectRole: 'RELATED' },
    ]);
    expect(input.requestId).toContain(docNo);
    expect(actor).toMatchObject({ actorType: 'ADMIN', actorNo: 'ADM-OPS' });
  });

  it('store：PNG / JPEG 也放行，扩展名跟 MIME 走', async () => {
    const png = await service.store({ ownerType: 'LIQUIDITY_PROVIDER', ownerNo: 'LPP261029000001', docType: 'UBO_REGISTER', file: pdfFile({ originalname: 'ubo.png', mimetype: 'image/png' }) }, ops);
    const jpg = await service.store({ ownerType: 'LIQUIDITY_PROVIDER', ownerNo: 'LPP261029000001', docType: 'FINANCIALS', file: pdfFile({ originalname: 'fin.jpeg', mimetype: 'image/jpeg' }) }, ops);
    expect(fs.existsSync(path.join(dir, 'LIQUIDITY_PROVIDER', 'LPP261029000001', `${png.docNo}.png`))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'LIQUIDITY_PROVIDER', 'LPP261029000001', `${jpg.docNo}.jpg`))).toBe(true);
  });

  it('store：> 10 MB 抛 400，目录为空，审计零调用', async () => {
    const big = Buffer.alloc(DOCUMENT_LIMITS.maxBytes + 1);
    await expect(
      service.store({ ownerType: 'OUTSOURCING_VENDOR', ownerNo: 'VEN261029000001', docType: 'CONTRACT', file: pdfFile({ buffer: big, size: big.length }) }, ops),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    expect(prisma.storedDocument.create).not.toHaveBeenCalled();
  });

  it('store：恰好 10 MB 放行（边界值）', async () => {
    const exact = Buffer.alloc(DOCUMENT_LIMITS.maxBytes);
    const { docNo } = await service.store(
      { ownerType: 'OUTSOURCING_VENDOR', ownerNo: 'VEN261029000001', docType: 'CONTRACT', file: pdfFile({ buffer: exact, size: exact.length }) },
      ops,
    );
    expect(fs.statSync(path.join(dir, 'OUTSOURCING_VENDOR', 'VEN261029000001', `${docNo}.pdf`)).size).toBe(DOCUMENT_LIMITS.maxBytes);
  });

  it('store：mimetype text/plain 抛 400，目录为空', async () => {
    await expect(
      service.store({ ownerType: 'OUTSOURCING_VENDOR', ownerNo: 'VEN261029000001', docType: 'CONTRACT', file: pdfFile({ originalname: 'notes.txt', mimetype: 'text/plain' }) }, ops),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    expect(prisma.storedDocument.create).not.toHaveBeenCalled();
  });

  it('listByOwner 只返回该 owner 的文件且不含 storagePath / id', async () => {
    const a1 = await service.store({ ownerType: 'OUTSOURCING_VENDOR', ownerNo: 'VEN-A', docType: 'CONTRACT', file: pdfFile({ originalname: 'a1.pdf' }) }, ops);
    const a2 = await service.store({ ownerType: 'OUTSOURCING_VENDOR', ownerNo: 'VEN-A', docType: 'DR_PLAN', file: pdfFile({ originalname: 'a2.pdf' }) }, ops);
    await service.store({ ownerType: 'OUTSOURCING_VENDOR', ownerNo: 'VEN-B', docType: 'CONTRACT', file: pdfFile({ originalname: 'b1.pdf' }) }, ops);
    // 同号不同类型也要隔开（where 同时按 ownerType + ownerNo）
    await service.store({ ownerType: 'LIQUIDITY_PROVIDER', ownerNo: 'VEN-A', docType: 'AML_POLICY', file: pdfFile({ originalname: 'lp.pdf' }) }, ops);

    const list = await service.listByOwner('OUTSOURCING_VENDOR', 'VEN-A');
    expect(list.map((d) => d.docNo).sort()).toEqual([a1.docNo, a2.docNo].sort());
    for (const d of list) {
      expect(Object.keys(d).sort()).toEqual(['docNo', 'docType', 'mimeType', 'originalName', 'sizeBytes', 'uploadedAt', 'uploadedBy']);
    }
    expect(list.find((d) => d.docNo === a1.docNo)).toMatchObject({ docType: 'CONTRACT', originalName: 'a1.pdf', mimeType: 'application/pdf', uploadedBy: 'ADM-OPS' });
    expect(typeof list[0].uploadedAt).toBe('string');
    expect(await service.listByOwner('OUTSOURCING_VENDOR', 'VEN-NONE')).toEqual([]);
  });

  it('openStream：流出落盘的原字节，附 MIME 与原文件名；未知单号 404', async () => {
    const file = pdfFile({ originalname: '营业执照.pdf', buffer: Buffer.from('%PDF-1.4\nhello\n') });
    const { docNo } = await service.store({ ownerType: 'LIQUIDITY_PROVIDER', ownerNo: 'LPP-1', docType: 'INCORPORATION_CERT', file }, ops);

    const opened = await service.openStream(docNo);
    const chunks: Buffer[] = [];
    for await (const c of opened.stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).equals(file.buffer)).toBe(true);
    expect(opened.mimeType).toBe('application/pdf');
    expect(opened.originalName).toBe('营业执照.pdf');

    await expect(service.openStream('DOC000000000000')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('storageDir：缺 FILE_STORAGE_DIR 抛错；有则原样返回', () => {
    expect(service.storageDir()).toBe(dir);
    delete process.env.FILE_STORAGE_DIR;
    expect(() => service.storageDir()).toThrow(/FILE_STORAGE_DIR/);
  });
});

describe('inlineContentDisposition', () => {
  it('ASCII 文件名：inline + 引号包裹的原名', () => {
    expect(inlineContentDisposition('Contract.pdf')).toBe(`inline; filename="Contract.pdf"; filename*=UTF-8''Contract.pdf`);
  });

  it('非 ASCII 文件名：filename 退化成安全占位，filename* 带 UTF-8 百分号编码（不会让响应头抛 ERR_INVALID_CHAR）', () => {
    const header = inlineContentDisposition('营业执照 v2.pdf');
    expect(header).toBe(`inline; filename="____ v2.pdf"; filename*=UTF-8''${encodeURIComponent('营业执照 v2.pdf')}`);
    expect(/^[\x20-\x7e]*$/.test(header)).toBe(true);
  });

  it('引号 / 反斜杠 / 换行不能撕开头部', () => {
    const header = inlineContentDisposition('a"b\\c\r\nd.pdf');
    expect(header.startsWith('inline; filename="a_b_c__d.pdf"')).toBe(true);
    expect(header).not.toMatch(/[\r\n]/);
  });
});
