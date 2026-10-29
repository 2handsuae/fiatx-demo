// admin-web/src/components/compliance/StagedDocumentSlots.tsx
// 甲波六 T8：LP 申请页与服务商申请页共用的「材料槽位」——申请建好之前没有可传的地址，所以先在页面里暂存选中的文件，
// 提交成功拿到单号后由 uploadStagedFiles 逐槽上传（每槽各自 Uploading / Uploaded / 报错，互不拖累）。
// 组件只画槽位那一块（放进页面自己的 DetailCard 里，说明文字各页自己写）；重提时已传过的文件列在槽里、点名字新窗口打开。
import { useState } from 'react';
import { FilePickButton } from './UploadButton';
import type { StoredDocumentView } from './DocumentsCard';
import { AdminSessionError } from '../../utils/adminFetch';
import { openStoredDocument, uploadStoredDocument } from '../../utils/storedDocument';

export type SlotState = { phase: 'idle' | 'uploading' | 'done' } | { phase: 'error'; message: string };

/** 申请已建好后，按 `docTypes` 的顺序逐槽上传 `files` 里选中的文件；返回失败的槽数。
 *  AdminSessionError 原样抛出——调用方的提交流程本就静默处理会话失效（全局会跳登录）。 */
export const uploadStagedFiles = async ({
  url,
  docTypes,
  files,
  onSlotState,
}: {
  /** 完整上传地址（含 API 主机），形如 `${API}/admin/lp-profiles/<no>/documents`。 */
  url: string;
  docTypes: string[];
  files: Record<string, File | null>;
  onSlotState: (docType: string, state: SlotState) => void;
}): Promise<number> => {
  let failed = 0;
  for (const docType of docTypes) {
    const file = files[docType];
    if (!file) continue;
    onSlotState(docType, { phase: 'uploading' });
    try {
      await uploadStoredDocument(url, { docType }, file);
      onSlotState(docType, { phase: 'done' });
    } catch (e) {
      if (e instanceof AdminSessionError) throw e;
      failed += 1;
      onSlotState(docType, { phase: 'error', message: e instanceof Error ? e.message : 'Upload failed' });
    }
  }
  return failed;
};

export const StagedDocumentSlots = ({
  slots,
  files,
  slotState,
  existingDocs,
  disabled,
  onPick,
}: {
  slots: { code: string; label: string }[];
  files: Record<string, File | null>;
  slotState: Record<string, SlotState>;
  /** 重提时库里已有的文件。 */
  existingDocs: StoredDocumentView[];
  disabled: boolean;
  onPick: (docType: string, file: File | null) => void;
}) => {
  const [openError, setOpenError] = useState('');
  const openExisting = async (docNo: string) => {
    setOpenError('');
    try {
      await openStoredDocument(docNo);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setOpenError(e instanceof Error ? e.message : 'Failed to open the document');
    }
  };

  return (
    <>
      <div className="-mx-4 -mb-4 divide-y divide-adm-border border-t border-adm-border">
        {slots.map(({ code, label }) => {
          const state = slotState[code];
          const already = existingDocs.filter((d) => d.docType === code);
          return (
            <div key={code} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs">
              <span className="w-60 shrink-0 text-adm-t1">{label}</span>
              <FilePickButton
                file={files[code] ?? null}
                onPick={(f) => onPick(code, f)}
                label={already.length ? 'Add another' : 'Choose file'}
                disabled={disabled}
              />
              {already.map((d) => (
                <button
                  key={d.docNo}
                  type="button"
                  onClick={() => void openExisting(d.docNo)}
                  className="max-w-[240px] truncate font-mono text-[11px] text-adm-blue underline hover:opacity-75"
                  title={`${d.docNo} · ${d.originalName}`}
                >
                  {d.originalName}
                </button>
              ))}
              {state?.phase === 'uploading' && <span className="font-mono text-[11px] text-adm-amber">Uploading…</span>}
              {state?.phase === 'done' && <span className="font-mono text-[11px] text-adm-green">Uploaded</span>}
              {state?.phase === 'error' && <span className="font-mono text-[11px] text-adm-red">{state.message}</span>}
            </div>
          );
        })}
      </div>
      {openError && <p className="text-xs text-adm-red">{openError}</p>}
    </>
  );
};
