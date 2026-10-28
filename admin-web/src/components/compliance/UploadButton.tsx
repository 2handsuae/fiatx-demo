// admin-web/src/components/compliance/UploadButton.tsx
// 甲波六 T5：选一个文件 → 立刻以 multipart 上传到 `url`（字段 `file` + 调用方给的文本字段）。
// 两条线（LP / 服务商）的文件卡与筛查证据共用，签名由 plan 钉死，T8 原样复用。
// 同文件另导出 FilePickButton：申请页在档案建好之前没有可传的 url，只能先「暂存选中的文件」，
// 提交成功拿到单号后再由页面逐个调 uploadStoredDocument。
import { useRef, useState } from 'react';
import { Paperclip, Upload } from 'lucide-react';
import { adminButtonClass } from '../common/adminButtonStyles';
import { AdminSessionError } from '../../utils/adminFetch';
import { DOCUMENT_ACCEPT, uploadStoredDocument } from '../../utils/storedDocument';

export const UploadButton = ({
  url,
  fields,
  accept,
  label,
  onDone,
}: {
  /** 完整上传地址（含 API 主机）。 */
  url: string;
  /** 随文件一起提交的文本字段，如 `{ docType: 'LICENCE_COPY' }`。 */
  fields: Record<string, string>;
  accept: string;
  label: string;
  /** 上传成功后回调，参数是新文件的 DOC 号。 */
  onDone: (docNo: string) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const docNo = await uploadStoredDocument(url, fields, file);
      onDone(docNo);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      // 清掉 input，选同一个文件第二次也能触发 change。
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={adminButtonClass('detailUtility')}>
        <Upload size={13} /> {busy ? 'Uploading…' : label}
      </button>
      {error && <span className="text-[11px] text-adm-red">{error}</span>}
    </span>
  );
};

/** 只暂存、不上传：选中的文件交给调用方（`file` 受控），清除时回调 `onPick(null)`。 */
export const FilePickButton = ({
  file,
  onPick,
  label = 'Choose file',
  accept = DOCUMENT_ACCEPT,
  disabled = false,
}: {
  file: File | null;
  onPick: (file: File | null) => void;
  label?: string;
  accept?: string;
  disabled?: boolean;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className={adminButtonClass('detailUtility')}>
        <Paperclip size={13} /> {file ? 'Change' : label}
      </button>
      {file && (
        <>
          <span className="min-w-0 truncate font-mono text-[11px] text-adm-t2" title={file.name}>{file.name}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(null)}
            className="shrink-0 font-mono text-[11px] text-adm-t3 hover:text-adm-red disabled:opacity-40"
            title="Remove the chosen file"
          >
            Remove
          </button>
        </>
      )}
    </span>
  );
};
