// admin-web/src/components/compliance/DocumentsCard.tsx
// 甲波六 T5：尽调文件卡——列已传文件（原名 / 类别 / 大小 / 上传人·时间 / Open）+ 缺哪几类 + 上传入口。
// LP 详情（本任务）与服务商详情（T8）共用，签名由 plan 钉死。文件内容经 GET /admin/documents/:docNo/content
// 取回，前端从不直链磁盘路径；Open 与上传都不露 UUID，只露 DOC 号 / 用户号。
import { useState } from 'react';
import { DetailCard } from './DetailPageComponents';
import { UploadButton } from './UploadButton';
import { adminButtonClass } from '../common/adminButtonStyles';
import { AdminSessionError } from '../../utils/adminFetch';
import { LP_DOC_TYPE_LABELS, VENDOR_DOC_TYPE_LABELS, labelOf } from '../../utils/partnerStatusMap';
import { DOCUMENT_ACCEPT, openStoredDocument } from '../../utils/storedDocument';

/** 后端 StoredDocumentView（零 id、零磁盘路径）。 */
export interface StoredDocumentView {
  docNo: string;
  docType: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
}

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const DocumentsCard = ({
  ownerKind,
  ownerNo,
  basePath,
  docTypes,
  documents,
  canUpload,
  onChanged,
}: {
  ownerKind: 'LP' | 'VENDOR';
  ownerNo: string;
  /** '/admin/lp-profiles' | '/admin/outsourcing-vendors' */
  basePath: string;
  docTypes: { code: string; label: string }[];
  documents: StoredDocumentView[];
  canUpload: boolean;
  onChanged: () => void;
}) => {
  const [uploadType, setUploadType] = useState(docTypes[0]?.code ?? '');
  const [openError, setOpenError] = useState('');
  const noun = ownerKind === 'LP' ? 'liquidity provider' : 'service provider';
  // `docTypes` 只是「眼下应有」的槽位；已上传文件的类别可能不在其中（如重提后不再受监管、或升档前传的），
  // 此时回落到该线的完整词表，不显示裸码。
  const fullVocabulary = ownerKind === 'LP' ? LP_DOC_TYPE_LABELS : VENDOR_DOC_TYPE_LABELS;
  const labelOfType = (code: string) => docTypes.find((t) => t.code === code)?.label ?? labelOf(fullVocabulary, code);
  const provided = new Set(documents.map((d) => d.docType));
  const missing = docTypes.filter((t) => !provided.has(t.code));

  const open = async (docNo: string) => {
    setOpenError('');
    try {
      await openStoredDocument(docNo);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setOpenError(e instanceof Error ? e.message : 'Failed to open the document');
    }
  };

  return (
    <DetailCard title={`Documents · ${documents.length} uploaded`} columns={1}>
      <div className="-m-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['Document No.', 'File', 'Category', 'Size', 'Uploaded', ''].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.docNo} className="border-b border-adm-border/60">
                <td className="px-4 py-2 font-mono text-adm-blue">{d.docNo}</td>
                <td className="max-w-[260px] truncate px-4 py-2" title={d.originalName}>{d.originalName}</td>
                <td className="px-4 py-2 text-adm-t2">{labelOfType(d.docType)}</td>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-adm-t2">{formatBytes(d.sizeBytes)}</td>
                <td className="px-4 py-2 font-mono text-[10px] text-adm-t3">
                  {d.uploadedBy} · {new Date(d.uploadedAt).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right">
                  <button type="button" onClick={() => void open(d.docNo)} className={adminButtonClass('rowLink')}>Open</button>
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-adm-t3">No documents uploaded for this {noun} yet</td>
              </tr>
            )}
          </tbody>
        </table>

        {(missing.length > 0 || openError) && (
          <div className="space-y-1 border-t border-adm-border px-4 py-2.5 font-mono text-[11px]">
            {missing.length > 0 && (
              <p className="text-adm-amber">Not yet provided: {missing.map((t) => t.label).join(' · ')}</p>
            )}
            {openError && <p className="text-adm-red">{openError}</p>}
          </div>
        )}

        {canUpload && (
          <div className="flex flex-wrap items-center gap-2 border-t border-adm-border bg-adm-card px-4 py-2.5 text-xs">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Add a document</span>
            <select
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value)}
              className="rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
            >
              {docTypes.map((t) => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </select>
            <UploadButton
              url={`${import.meta.env.VITE_API_URL}${basePath}/${encodeURIComponent(ownerNo)}/documents`}
              fields={{ docType: uploadType }}
              accept={DOCUMENT_ACCEPT}
              label="Upload file"
              onDone={() => onChanged()}
            />
            <span className="font-mono text-[10px] text-adm-t3">PDF, PNG or JPG · up to 10 MB</span>
          </div>
        )}
      </div>
    </DetailCard>
  );
};
