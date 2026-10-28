// admin-web/src/utils/storedDocument.ts
// 甲波六 T5：系统首个文件上传 / 取回的前端出入口（后端 DocumentsService 的另一头）。
// 上传走 FormData + adminFetch（adminFetch 已为 FormData 让路，不强塞 JSON Content-Type）；
// 取回走带 token 的 fetch → blob → 新窗口——浏览器直开 URL 带不上 Authorization 头，也不能直链磁盘路径。
import { adminFetch, getApiErrorMessage } from './adminFetch';

/** 文件类别可接受的扩展 / MIME（与后端 DOCUMENT_LIMITS 一致：PDF / PNG / JPG，单文件 ≤ 10 MB）。 */
export const DOCUMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

/** 上传一个文件，返回 docNo。`fields` 是一并带上的文本字段（如 docType）；失败抛带后端文案的 Error。 */
export const uploadStoredDocument = async (
  url: string,
  fields: Record<string, string>,
  file: File,
): Promise<string> => {
  const body = new FormData();
  Object.entries(fields).forEach(([key, value]) => body.append(key, value));
  body.append('file', file);
  const res = await adminFetch(url, { method: 'POST', body });
  if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Upload failed'));
  const data = (await res.json()) as { docNo: string };
  return data.docNo;
};

/** 新窗口打开一份已存文件（GET /admin/documents/:docNo/content）。窗口要在点击的同步段里先开，
 *  否则 await 之后再 window.open 会被弹窗拦截器吃掉；取到内容后把这个窗口指向 blob 地址。 */
export const openStoredDocument = async (docNo: string): Promise<void> => {
  const win = window.open('', '_blank');
  try {
    const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/documents/${encodeURIComponent(docNo)}/content`);
    if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to open the document'));
    const blobUrl = URL.createObjectURL(await res.blob());
    if (win) win.location.href = blobUrl;
    else window.open(blobUrl, '_blank');
  } catch (e) {
    win?.close();
    throw e;
  }
};
