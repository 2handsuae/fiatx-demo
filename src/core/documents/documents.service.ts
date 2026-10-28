// 甲波六 T2（2026-10-29）：系统首个文件存储。本服务是 stored_documents 表的唯一写者（铁律③）；
// LP / 服务商 / 筛查记录三类 owner 的上传端点只调 store()，下载端点见 documents.controller.ts。
// 二进制只落 FILE_STORAGE_DIR，仓库不进任何文件；校验（大小 / MIME）在落盘与写审计之前。
import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fsp, ReadStream } from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateReferenceNo } from '../../common/utils/no-generator.util';
import { AuditLogsService } from '../../modules/audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../modules/audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole, CreateAuditLogEventDto } from '../../modules/audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../modules/governance/approvals/constants/approval.constants';
import { DOCUMENT_EXT_BY_MIME, DOCUMENT_LIMITS, DocumentOwnerType } from './documents.constants';

/** multer（内存存储）给出的上传文件的结构子集——服务不依赖 Express 类型。 */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoreDocumentInput {
  ownerType: DocumentOwnerType;
  ownerNo: string;
  docType: string;
  file: UploadedFileLike;
}

/** 对外视图：零 id、零磁盘路径（铁律⑥）。 */
export interface StoredDocumentView {
  docNo: string;
  docType: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** 缺 FILE_STORAGE_DIR 直接抛——与 DATABASE_URL 缺失 fail-fast 同哲学，不猜默认目录。 */
  storageDir(): string {
    const dir = process.env.FILE_STORAGE_DIR;
    if (!dir) {
      throw new Error('FILE_STORAGE_DIR is not set — run through scripts/on-stack.sh (or stack.sh up) so the stack provides it.');
    }
    return dir;
  }

  async store(input: StoreDocumentInput, actor: ApprovalActorContext): Promise<{ docNo: string }> {
    const { ownerType, ownerNo, docType, file } = input;
    if (file.size > DOCUMENT_LIMITS.maxBytes) {
      throw new BadRequestException(`File too large: ${file.size} bytes (max ${DOCUMENT_LIMITS.maxBytes / 1024 / 1024} MB).`);
    }
    if (!DOCUMENT_LIMITS.mimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type ${file.mimetype} — only PDF, PNG or JPG are accepted.`);
    }

    const docNo = generateReferenceNo('DOC');
    const storagePath = path.join(this.storageDir(), ownerType, ownerNo, `${docNo}${DOCUMENT_EXT_BY_MIME[file.mimetype]}`);
    await fsp.mkdir(path.dirname(storagePath), { recursive: true });
    await fsp.writeFile(storagePath, file.buffer);

    const uploadedBy = actor.userNo ?? actor.userId;
    await this.prisma.storedDocument.create({
      data: {
        docNo, ownerType, ownerNo, docType,
        originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size,
        storagePath, uploadedByUserId: uploadedBy,
      },
    });
    await this.recordUploaded(docNo, input, actor);
    return { docNo };
  }

  async listByOwner(ownerType: DocumentOwnerType, ownerNo: string): Promise<StoredDocumentView[]> {
    const rows = await this.prisma.storedDocument.findMany({
      where: { ownerType, ownerNo },
      orderBy: { uploadedAt: 'asc' },
    });
    return rows.map((r) => ({
      docNo: r.docNo, docType: r.docType, originalName: r.originalName, mimeType: r.mimeType,
      sizeBytes: r.sizeBytes, uploadedBy: r.uploadedByUserId, uploadedAt: r.uploadedAt.toISOString(),
    }));
  }

  async openStream(docNo: string): Promise<{ stream: ReadStream; mimeType: string; originalName: string }> {
    const row = await this.prisma.storedDocument.findUnique({ where: { docNo } });
    if (!row) throw new NotFoundException(`Document not found: ${docNo}`);
    return { stream: createReadStream(row.storagePath), mimeType: row.mimeType, originalName: row.originalName };
  }

  // ── 审计（DOCUMENT_UPLOADED：单步操作，correlationMode N；primary = 文件自己，owner 为 RELATED 子主体；
  //     docType 顶层展开满足 requiredFields，metadata 镜像归属与文件信息；requestId 显式带 docNo——漏了会被静默去重）──

  private async recordUploaded(docNo: string, upload: StoreDocumentInput, actor: ApprovalActorContext): Promise<void> {
    const { ownerType, ownerNo, docType, file } = upload;
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.STORED_DOCUMENT, subjectNo: docNo, subjectRole: AuditSubjectRole.PRIMARY },
      { subjectType: AuditEntityTypes[ownerType], subjectNo: ownerNo, subjectRole: AuditSubjectRole.RELATED },
    ];
    // docType / workflowType 不在 DTO 声明里（requiredFields 顶层展开 + 同 sibling 服务的信封惯例），用交叉类型承载，不走 any。
    const envelope: CreateAuditLogEventDto & { docType: string; workflowType: string } = {
      action: AuditActions.DOCUMENT_UPLOADED, actionDomain: 'GOVERNANCE', category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.DUE_DILIGENCE,
      primarySubjectType: AuditEntityTypes.STORED_DOCUMENT, primarySubjectNo: docNo,
      subjects,
      docType,
      requestId: `${AuditActions.DOCUMENT_UPLOADED}_${docNo}_${randomUUID()}`,
      metadata: { ownerType, ownerNo, docType, originalName: file.originalname, sizeBytes: file.size },
      sourcePlatform: 'ADMIN',
    };
    const display = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(envelope, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.roleCodes ?? [] });
  }
}
