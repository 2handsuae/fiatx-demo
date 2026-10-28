// 甲波六 T2（2026-10-29）：文件下载——唯一的文件端点。上传端点各归各 owner 的控制器（T3 / T4 / T6，
// 各自 @UseInterceptors(FileInterceptor('file')) 后调 DocumentsService.store）；前端不直链磁盘路径，
// 经本接口按权限流式取回。下载是读、不留痕。
// 路由 groups = ['LP_READ','VENDOR_READ']（OR）：能看 LP 详情或服务商详情的人，才拿得到它们的文件。
import { Controller, Get, Param, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../modules/identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../modules/identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../modules/identity/access-control/permission-code.util';
import { DocumentsService } from './documents.service';

/**
 * Content-Disposition: inline。filename 退化成纯 ASCII 占位（引号 / 反斜杠 / 控制字符 / 非 ASCII 一律换成 _，
 * 否则 Node 对非 latin1 字符的响应头直接抛 ERR_INVALID_CHAR——中文文件名在演示里很常见），
 * filename* 带 RFC 5987 的 UTF-8 百分号编码，浏览器取它显示真名。
 */
export function inlineContentDisposition(originalName: string): string {
  const ascii = originalName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(originalName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

@ApiTags('Admin - Documents')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('admin/documents/:docNo/content')
  @ApiOperation({ summary: 'Download a stored document (inline) — gated by the owner-kind read permission' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/documents/:docNo/content'))
  async download(@Param('docNo') docNo: string): Promise<StreamableFile> {
    const { stream, mimeType, originalName } = await this.documents.openStream(docNo);
    return new StreamableFile(stream, { type: mimeType, disposition: inlineContentDisposition(originalName) });
  }
}
