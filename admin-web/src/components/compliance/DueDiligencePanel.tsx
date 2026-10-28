// admin-web/src/components/compliance/DueDiligencePanel.tsx
// 甲波六 T5：合规评估区块——LP 详情（本任务）与服务商详情（T8）共用，签名由 plan 钉死、T8 原样复用。
// 渲染：筛查记录表 + 「Add screening record」表单 + 评估表单（风险档 / 意见 / 附加条件）+ CISO 区（仅 requireInfosec）
// + 三个结论按钮（Return / Reject / Send for approval）。硬规则与后端同口径（后端同样拒，这里只是不让人点）：
//   · 任一筛查记录为 Red 或 CISO 结论不可接受 → Send for approval 整个不渲染；
//   · 缺名 / 未定档 / 要 CISO 却没填 / 表单有未保存改动 → Send 置灰并在 title 说明缺什么；
//   · locked（对象不在待评估 / 已退回）→ 全部只读；对象在「已退回」时表单仍可写，但三个结论按钮不提供（R9：
//     结论只在待评估态被接受），改显提示——要等申请方重新提交。
// 为了不扩签名，面板自己读一次 `${basePath}/${targetNo}`（LP / 服务商详情都带 name、status、beneficialOwners）：
// 取公司名与实际控制人（seq + 姓名）预填筛查表单，取 status 判断「已退回」。只有可写态才取。
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DetailCard, InfoField, InfoSlot } from './DetailPageComponents';
import { UploadButton, FilePickButton } from './UploadButton';
import { adminButtonClass } from '../common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../../utils/adminFetch';
import {
  DD_CONCLUSION_LABELS,
  INFOSEC_CERT_LABELS,
  INFOSEC_VERDICT_LABELS,
  RISK_TIER_LABELS,
  SCREENING_LIST_LABELS,
  SCREENING_RESULT_META,
  SCREENING_SUBJECT_KIND_LABELS,
  humanizeCode,
  labelOf,
} from '../../utils/partnerStatusMap';
import { DOCUMENT_ACCEPT, openStoredDocument, uploadStoredDocument } from '../../utils/storedDocument';

export interface ScreeningRecordView {
  recordNo: string;
  subjectKind: string;
  subjectName: string;
  uboSeq: number | null;
  listsChecked: string[];
  result: string;
  screenedAt: string;
  evidenceDocNo: string | null;
  recordedBy: string;
}

export interface DueDiligenceView {
  assessmentNo: string;
  targetType: string;
  targetNo: string;
  riskTier: string | null;
  opinion: string | null;
  conditions: string | null;
  conclusion: string | null;
  conclusionReason: string | null;
  concludedAt: string | null;
  infosec: {
    soc2: string | null;
    iso27001: string | null;
    dataLocationAcceptable: boolean | null;
    drPlanAcceptable: boolean | null;
    opinion: string | null;
    verdict: string | null;
    recordedBy: string | null;
    recordedAt: string | null;
  } | null;
  screeningRecords: ScreeningRecordView[];
  flags: { hasRed: boolean; missingNames: string[]; infosecBlocked: boolean };
}

interface Target {
  name: string;
  status: string;
  beneficialOwners: { seq: number; name: string }[];
}

const fi = 'mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs';

const SubHeading = ({ children }: { children: string }) => (
  <p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">{children}</p>
);

const yesNo = (v: boolean | null | undefined): string => (v === null || v === undefined ? '—' : v ? 'Yes' : 'No');

/** 退回 / 不通过共用的「原因」弹层（默认必填；`optional` 时可留空，如终止服务商的备注）。服务商详情页的升档 / 终止复用它。 */
export const ReasonDialog = ({
  title,
  hint,
  confirmLabel,
  danger = false,
  optional = false,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  hint: string;
  confirmLabel: string;
  danger?: boolean;
  optional?: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) => {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="w-[480px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">{title}</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">{hint}</p>
        <label className="block text-xs">{optional ? 'Notes (optional)' : 'Reason (required)'}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={fi} autoFocus />
        </label>
        {error && <p className="mt-2 text-xs text-adm-red">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button
            type="button"
            disabled={busy || (!optional && !reason.trim())}
            onClick={() => onConfirm(reason.trim())}
            className={adminButtonClass(danger ? 'workflowNegative' : 'modalConfirm')}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const DueDiligencePanel = ({
  kind,
  targetNo,
  basePath,
  assessment,
  locked,
  canWrite,
  canWriteInfosec,
  requireInfosec,
  onChanged,
}: {
  kind: 'LP' | 'VENDOR';
  targetNo: string;
  /** '/admin/lp-profiles' | '/admin/outsourcing-vendors' */
  basePath: string;
  /** 后端无评估壳（404）时由页面传 null。 */
  assessment: DueDiligenceView | null;
  /** 对象不在「待评估 / 已退回」→ 全部只读。 */
  locked: boolean;
  /** 持 DUE_DILIGENCE_WRITE。 */
  canWrite: boolean;
  /** 持 INFOSEC_ASSESSMENT_WRITE。 */
  canWriteInfosec: boolean;
  /** 重大服务商才有 CISO 评估区（LP 恒 false）。 */
  requireInfosec: boolean;
  /** 任何写动作成功后调用——页面据此重取档案 / 评估 / 文件。 */
  onChanged: () => void;
}) => {
  const base = `${import.meta.env.VITE_API_URL}${basePath}/${encodeURIComponent(targetNo)}`;
  const applicant = kind === 'LP' ? 'Treasury' : 'Operations';
  const writable = canWrite && !locked && assessment !== null;

  // ── 对象（公司名 / 实控人 / 状态）──────────────────────────────────
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => {
    if (!writable) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch(base);
        if (!res.ok) return;
        const d = await res.json();
        if (!cancelled) {
          setTarget({
            name: d.name,
            status: d.status,
            beneficialOwners: Array.isArray(d.beneficialOwners) ? d.beneficialOwners : [],
          });
        }
      } catch (e) {
        if (e instanceof AdminSessionError) return;
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, [base, writable, assessment]);

  // ── 筛查表单 ──────────────────────────────────────────────────────
  const [subjectKind, setSubjectKind] = useState('COMPANY');
  const [uboSeq, setUboSeq] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [lists, setLists] = useState<string[]>([]);
  const [result, setResult] = useState('');
  const [screenedAt, setScreenedAt] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [screeningBusy, setScreeningBusy] = useState(false);
  const [screeningError, setScreeningError] = useState('');

  useEffect(() => {
    if (target && subjectKind === 'COMPANY' && !subjectName) setSubjectName(target.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const changeSubjectKind = (next: string) => {
    setSubjectKind(next);
    setUboSeq('');
    setSubjectName(next === 'COMPANY' ? target?.name ?? '' : '');
  };
  const changeUbo = (seq: string) => {
    setUboSeq(seq);
    setSubjectName(target?.beneficialOwners.find((o) => String(o.seq) === seq)?.name ?? '');
  };
  const toggleList = (code: string) =>
    setLists((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  const submitScreening = async () => {
    setScreeningError('');
    if (subjectKind === 'BENEFICIAL_OWNER' && !uboSeq) { setScreeningError('Choose which beneficial owner was screened'); return; }
    if (!subjectName.trim()) { setScreeningError('Subject name is required'); return; }
    if (lists.length === 0) { setScreeningError('Tick at least one list that was checked'); return; }
    if (!result) { setScreeningError('Choose the screening result'); return; }
    setScreeningBusy(true);
    try {
      const res = await adminFetch(`${base}/assessment/screening-records`, {
        method: 'POST',
        body: JSON.stringify({
          subjectKind,
          subjectName: subjectName.trim(),
          ...(subjectKind === 'BENEFICIAL_OWNER' ? { uboSeq: Number(uboSeq) } : {}),
          listsChecked: lists,
          result,
          ...(screenedAt ? { screenedAt: new Date(screenedAt).toISOString() } : {}),
        }),
      });
      if (!res.ok) { setScreeningError(await getApiErrorMessage(res, 'Failed to record the screening result')); return; }
      const { recordNo } = (await res.json()) as { recordNo: string };
      let evidenceError = '';
      if (evidenceFile) {
        try {
          await uploadStoredDocument(`${base}/assessment/screening-records/${encodeURIComponent(recordNo)}/evidence`, {}, evidenceFile);
        } catch (e) {
          if (e instanceof AdminSessionError) return;
          evidenceError = e instanceof Error ? e.message : 'Upload failed';
        }
      }
      setSubjectKind('COMPANY');
      setUboSeq('');
      setSubjectName(target?.name ?? '');
      setLists([]);
      setResult('');
      setScreenedAt('');
      setEvidenceFile(null);
      if (evidenceError) setScreeningError(`${recordNo} was recorded, but the evidence file could not be uploaded: ${evidenceError}`);
      onChanged();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setScreeningError(e instanceof Error ? e.message : 'Failed to record the screening result');
    } finally {
      setScreeningBusy(false);
    }
  };

  // ── 评估表单（风险档 / 意见 / 附加条件）──────────────────────────────
  const [tier, setTier] = useState('');
  const [opinion, setOpinion] = useState('');
  const [conditions, setConditions] = useState('');
  const [assessBusy, setAssessBusy] = useState(false);
  const [assessError, setAssessError] = useState('');
  const [assessSaved, setAssessSaved] = useState(false);

  useEffect(() => {
    setTier(assessment?.riskTier ?? '');
    setOpinion(assessment?.opinion ?? '');
    setConditions(assessment?.conditions ?? '');
  }, [assessment?.assessmentNo, assessment?.riskTier, assessment?.opinion, assessment?.conditions]);

  const assessDirty =
    tier !== (assessment?.riskTier ?? '') || opinion !== (assessment?.opinion ?? '') || conditions !== (assessment?.conditions ?? '');

  const saveAssessment = async () => {
    setAssessError('');
    setAssessSaved(false);
    if (!tier) { setAssessError('Choose a risk tier'); return; }
    if (!opinion.trim()) { setAssessError('The assessment opinion is required'); return; }
    setAssessBusy(true);
    try {
      const res = await adminFetch(`${base}/assessment`, {
        method: 'PATCH',
        body: JSON.stringify({ riskTier: tier, opinion: opinion.trim(), ...(conditions.trim() ? { conditions: conditions.trim() } : {}) }),
      });
      if (!res.ok) { setAssessError(await getApiErrorMessage(res, 'Failed to save the assessment')); return; }
      setAssessSaved(true);
      onChanged();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setAssessError(e instanceof Error ? e.message : 'Failed to save the assessment');
    } finally {
      setAssessBusy(false);
    }
  };

  // ── CISO 评估 ─────────────────────────────────────────────────────
  const [soc2, setSoc2] = useState('');
  const [iso, setIso] = useState('');
  const [dataLoc, setDataLoc] = useState('');
  const [drPlan, setDrPlan] = useState('');
  const [infosecOpinion, setInfosecOpinion] = useState('');
  const [verdict, setVerdict] = useState('');
  const [infosecBusy, setInfosecBusy] = useState(false);
  const [infosecError, setInfosecError] = useState('');

  const infosec = assessment?.infosec ?? null;
  useEffect(() => {
    setSoc2(infosec?.soc2 ?? '');
    setIso(infosec?.iso27001 ?? '');
    setDataLoc(infosec?.dataLocationAcceptable == null ? '' : infosec.dataLocationAcceptable ? 'yes' : 'no');
    setDrPlan(infosec?.drPlanAcceptable == null ? '' : infosec.drPlanAcceptable ? 'yes' : 'no');
    setInfosecOpinion(infosec?.opinion ?? '');
    setVerdict(infosec?.verdict ?? '');
  }, [infosec?.recordedAt]);

  const saveInfosec = async () => {
    setInfosecError('');
    if (!soc2 || !iso || !dataLoc || !drPlan || !verdict) { setInfosecError('Answer every item of the CISO assessment'); return; }
    if (!infosecOpinion.trim()) { setInfosecError('The CISO opinion is required'); return; }
    setInfosecBusy(true);
    try {
      const res = await adminFetch(`${base}/assessment/infosec`, {
        method: 'POST',
        body: JSON.stringify({
          soc2,
          iso27001: iso,
          dataLocationAcceptable: dataLoc === 'yes',
          drPlanAcceptable: drPlan === 'yes',
          opinion: infosecOpinion.trim(),
          verdict,
        }),
      });
      if (!res.ok) { setInfosecError(await getApiErrorMessage(res, 'Failed to record the CISO assessment')); return; }
      onChanged();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setInfosecError(e instanceof Error ? e.message : 'Failed to record the CISO assessment');
    } finally {
      setInfosecBusy(false);
    }
  };

  // ── 三个结论按钮 ───────────────────────────────────────────────────
  const [reasonFor, setReasonFor] = useState<'RETURNED' | 'REJECTED' | null>(null);
  const [concluding, setConcluding] = useState(false);
  const [concludeError, setConcludeError] = useState('');
  const [notice, setNotice] = useState<{ text: string; approvalNo?: string } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const conclude = async (conclusion: 'RETURNED' | 'REJECTED' | 'SENT_FOR_APPROVAL', reason?: string) => {
    setConcludeError('');
    setConcluding(true);
    try {
      const res = await adminFetch(`${base}/assessment/conclude`, {
        method: 'POST',
        body: JSON.stringify({ conclusion, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) { setConcludeError(await getApiErrorMessage(res, 'Failed to record the conclusion')); return; }
      const data = (await res.json()) as { approvalNo?: string };
      setReasonFor(null);
      setNotice(
        conclusion === 'SENT_FOR_APPROVAL'
          ? { text: 'Sent for approval', approvalNo: data.approvalNo }
          : { text: conclusion === 'RETURNED' ? `Returned to ${applicant} for documents` : 'Rejected' },
      );
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 10000);
      onChanged();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setConcludeError(e instanceof Error ? e.message : 'Failed to record the conclusion');
    } finally {
      setConcluding(false);
    }
  };

  const [evidenceError, setEvidenceError] = useState('');
  const openEvidence = async (docNo: string) => {
    setEvidenceError('');
    try {
      await openStoredDocument(docNo);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setEvidenceError(e instanceof Error ? e.message : 'Failed to open the evidence');
    }
  };

  // ── 渲染 ──────────────────────────────────────────────────────────
  if (!assessment) {
    return (
      <DetailCard title="Due Diligence" columns={1}>
        <p className="font-mono text-[11px] text-adm-t3">No due-diligence assessment on file</p>
      </DetailCard>
    );
  }

  const { flags } = assessment;
  const returned = target?.status === 'RETURNED';
  const sendBlockedReason = (() => {
    if (assessDirty) return 'Save the assessment first — the unsaved changes are not what will be sent';
    if (flags.missingNames.length > 0) return `Screening missing for: ${flags.missingNames.join(', ')}`;
    if (!assessment.riskTier) return 'Save a risk tier and opinion first';
    if (requireInfosec && !assessment.infosec) return 'Waiting for the CISO assessment';
    return '';
  })();
  const canSendAtAll = !flags.hasRed && !flags.infosecBlocked;
  const owners = target?.beneficialOwners ?? [];

  return (
    <DetailCard title="Due Diligence" columns={1}>
      <div className="space-y-5">
        {notice && (
          <div className="rounded border border-adm-green/40 bg-adm-green/10 px-3 py-2 font-mono text-[11px] text-adm-green">
            {notice.text}
            {notice.approvalNo && (
              <>
                {' '}— {notice.approvalNo}{' '}
                <Link to={`/admin/governance/approvals/${encodeURIComponent(notice.approvalNo)}`} className="underline hover:opacity-75">
                  View approval
                </Link>
              </>
            )}
          </div>
        )}

        {/* 摘要 */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <InfoField label="Assessment No." value={assessment.assessmentNo} mono />
          <InfoField label="Risk Tier" value={assessment.riskTier ? labelOf(RISK_TIER_LABELS, assessment.riskTier) : null} emptyLabel="Not assessed yet" />
          <InfoSlot label="Last Conclusion">
            {assessment.conclusion ? (
              <span>
                {labelOf(DD_CONCLUSION_LABELS, assessment.conclusion)}
                {assessment.concludedAt && (
                  <span className="ml-2 font-mono text-[10px] text-adm-t3">{new Date(assessment.concludedAt).toLocaleString()}</span>
                )}
              </span>
            ) : (
              <span className="text-adm-t3">—</span>
            )}
          </InfoSlot>
          {assessment.conclusionReason && (
            <div className="md:col-span-3">
              <InfoSlot label="Conclusion Reason"><span className="whitespace-pre-wrap">{assessment.conclusionReason}</span></InfoSlot>
            </div>
          )}
        </div>

        {/* 可写态下的旗标 */}
        {!locked && (flags.hasRed || flags.infosecBlocked || flags.missingNames.length > 0) && (
          <div className="space-y-1 font-mono text-[11px]">
            {flags.hasRed && (
              <p className="rounded border border-adm-red/40 bg-adm-red/10 px-3 py-2 text-adm-red">
                {returned
                  ? `A screening result is Red — once ${applicant} resubmits the application, it cannot be sent for approval and can only be rejected.`
                  : 'A screening result is Red — this application cannot be sent for approval; it can only be rejected.'}
              </p>
            )}
            {flags.infosecBlocked && (
              <p className="rounded border border-adm-red/40 bg-adm-red/10 px-3 py-2 text-adm-red">
                {returned
                  ? `The CISO judged the information-security assessment not acceptable — once ${applicant} resubmits the application, it cannot be sent for approval and can only be rejected.`
                  : 'The CISO judged the information-security assessment not acceptable — it cannot be sent for approval; it can only be rejected.'}
              </p>
            )}
            {flags.missingNames.length > 0 && (
              <p className="rounded border border-adm-amber/40 bg-adm-amber/10 px-3 py-2 text-adm-amber">
                Not screened yet: {flags.missingNames.join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* 筛查记录 */}
        <div>
          <SubHeading>Screening records</SubHeading>
          <div className="overflow-hidden rounded border border-adm-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-adm-border bg-adm-card text-left text-adm-t3">
                  {['Subject', 'Lists', 'Result', 'Evidence', 'Screened at'].map((h) => (
                    <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assessment.screeningRecords.map((r) => {
                  const res = SCREENING_RESULT_META[r.result];
                  return (
                    <tr key={r.recordNo} className="border-b border-adm-border/60 align-top">
                      <td className="px-3 py-2">
                        <div className="text-adm-t1">{r.subjectName}</div>
                        <div className="font-mono text-[10px] text-adm-t3">
                          {labelOf(SCREENING_SUBJECT_KIND_LABELS, r.subjectKind)}
                          {r.uboSeq !== null && ` #${r.uboSeq}`} · {r.recordNo}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.listsChecked.map((l) => (
                            <span key={l} className="rounded bg-adm-bg px-1.5 py-0.5 font-mono text-[10px] text-adm-t2">
                              {labelOf(SCREENING_LIST_LABELS, l)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${res?.dotClass ?? 'bg-adm-t3'}`} />
                          {res?.label ?? humanizeCode(r.result)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {r.evidenceDocNo ? (
                          <button type="button" onClick={() => void openEvidence(r.evidenceDocNo as string)} className="font-mono text-[11px] text-adm-blue underline hover:opacity-75">
                            {r.evidenceDocNo}
                          </button>
                        ) : writable ? (
                          <UploadButton
                            url={`${base}/assessment/screening-records/${encodeURIComponent(r.recordNo)}/evidence`}
                            fields={{}}
                            accept={DOCUMENT_ACCEPT}
                            label="Attach"
                            onDone={() => onChanged()}
                          />
                        ) : (
                          <span className="text-adm-t3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                        <div>{new Date(r.screenedAt).toLocaleString()}</div>
                        <div className="text-adm-t3">by {r.recordedBy}</div>
                      </td>
                    </tr>
                  );
                })}
                {assessment.screeningRecords.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-center text-adm-t3">No screening records yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {evidenceError && <p className="mt-1 text-xs text-adm-red">{evidenceError}</p>}
        </div>

        {/* 登记筛查 */}
        {writable && (
          <div className="rounded border border-adm-border bg-adm-bg p-3">
            <SubHeading>Add screening record</SubHeading>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block text-xs">Subject
                <select value={subjectKind} onChange={(e) => changeSubjectKind(e.target.value)} className={fi}>
                  {Object.entries(SCREENING_SUBJECT_KIND_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </label>
              {subjectKind === 'BENEFICIAL_OWNER' && (
                <label className="block text-xs">Beneficial owner
                  <select value={uboSeq} onChange={(e) => changeUbo(e.target.value)} className={fi}>
                    <option value="">{owners.length ? 'Select…' : 'No beneficial owners on the application'}</option>
                    {owners.map((o) => (
                      <option key={o.seq} value={String(o.seq)}>#{o.seq} · {o.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className={`block text-xs ${subjectKind === 'BENEFICIAL_OWNER' ? '' : 'md:col-span-2'}`}>Name screened
                <input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} className={fi} />
              </label>
            </div>

            <div className="mt-3">
              <p className="mb-1 text-xs">Lists checked</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(SCREENING_LIST_LABELS).map(([code, label]) => (
                  <label key={code} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={lists.includes(code)} onChange={() => toggleList(code)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <p className="mb-1 text-xs">Result</p>
                <div className="flex gap-1.5">
                  {Object.entries(SCREENING_RESULT_META).map(([code, meta]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setResult(code)}
                      className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${
                        result === code ? 'border-adm-amber bg-adm-amber/10 text-adm-t1' : 'border-adm-border text-adm-t2 hover:bg-adm-hover'
                      }`}
                    >
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
                      {meta.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-xs">Screened at (default: now)
                <input type="datetime-local" value={screenedAt} onChange={(e) => setScreenedAt(e.target.value)} className={fi} />
              </label>
              <div>
                <p className="mb-1 text-xs">Evidence screenshot (optional)</p>
                <FilePickButton file={evidenceFile} onPick={setEvidenceFile} label="Choose file" disabled={screeningBusy} />
              </div>
            </div>

            {screeningError && <p className="mt-2 text-xs text-adm-red">{screeningError}</p>}
            <div className="mt-3 flex justify-end">
              <button type="button" disabled={screeningBusy} onClick={() => void submitScreening()} className={adminButtonClass('workflowSecondary')}>
                {screeningBusy ? 'Recording…' : 'Add screening record'}
              </button>
            </div>
          </div>
        )}

        {/* 评估 */}
        <div>
          <SubHeading>Assessment</SubHeading>
          {writable ? (
            <div className="rounded border border-adm-border bg-adm-bg p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block text-xs">Risk tier
                  <select value={tier} onChange={(e) => { setTier(e.target.value); setAssessSaved(false); }} className={fi}>
                    <option value="">Select…</option>
                    {Object.entries(RISK_TIER_LABELS).map(([code, label]) => (
                      <option key={code} value={code}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs md:col-span-2">Conditions (optional)
                  <input value={conditions} onChange={(e) => { setConditions(e.target.value); setAssessSaved(false); }} className={fi} placeholder="e.g. Limited to USDT/AED spot" />
                </label>
              </div>
              <label className="mt-3 block text-xs">Assessment opinion
                <textarea value={opinion} onChange={(e) => { setOpinion(e.target.value); setAssessSaved(false); }} rows={3} className={fi} placeholder="Why this tier, and what the approver should know" />
              </label>
              {assessError && <p className="mt-2 text-xs text-adm-red">{assessError}</p>}
              <div className="mt-3 flex items-center justify-end gap-3">
                {assessSaved && !assessDirty && <span className="font-mono text-[11px] text-adm-green">Saved</span>}
                {assessDirty && <span className="font-mono text-[11px] text-adm-amber">Unsaved changes</span>}
                <button type="button" disabled={assessBusy} onClick={() => void saveAssessment()} className={adminButtonClass('workflowSecondary')}>
                  {assessBusy ? 'Saving…' : 'Save assessment'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <InfoField label="Risk Tier" value={assessment.riskTier ? labelOf(RISK_TIER_LABELS, assessment.riskTier) : null} emptyLabel="Not assessed yet" />
              <div className="md:col-span-2">
                <InfoSlot label="Conditions">
                  {assessment.conditions ? <span className="whitespace-pre-wrap">{assessment.conditions}</span> : <span className="text-adm-t3">None</span>}
                </InfoSlot>
              </div>
              <div className="md:col-span-3">
                <InfoSlot label="Assessment Opinion">
                  {assessment.opinion ? <span className="whitespace-pre-wrap">{assessment.opinion}</span> : <span className="text-adm-t3">Not written yet</span>}
                </InfoSlot>
              </div>
            </div>
          )}
        </div>

        {/* CISO */}
        {requireInfosec && (
          <div>
            <SubHeading>CISO information-security assessment</SubHeading>
            {canWriteInfosec && !locked ? (
              <div className="rounded border border-adm-border bg-adm-bg p-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <label className="block text-xs">SOC 2
                    <select value={soc2} onChange={(e) => setSoc2(e.target.value)} className={fi}>
                      <option value="">Select…</option>
                      {Object.entries(INFOSEC_CERT_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs">ISO 27001
                    <select value={iso} onChange={(e) => setIso(e.target.value)} className={fi}>
                      <option value="">Select…</option>
                      {Object.entries(INFOSEC_CERT_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs">Data location acceptable
                    <select value={dataLoc} onChange={(e) => setDataLoc(e.target.value)} className={fi}>
                      <option value="">Select…</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <label className="block text-xs">Disaster recovery plan acceptable
                    <select value={drPlan} onChange={(e) => setDrPlan(e.target.value)} className={fi}>
                      <option value="">Select…</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                  <label className="block text-xs">Verdict
                    <select value={verdict} onChange={(e) => setVerdict(e.target.value)} className={fi}>
                      <option value="">Select…</option>
                      {Object.entries(INFOSEC_VERDICT_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs md:col-span-3">Opinion
                    <textarea value={infosecOpinion} onChange={(e) => setInfosecOpinion(e.target.value)} rows={2} className={fi} />
                  </label>
                </div>
                {infosecError && <p className="mt-2 text-xs text-adm-red">{infosecError}</p>}
                <div className="mt-3 flex justify-end">
                  <button type="button" disabled={infosecBusy} onClick={() => void saveInfosec()} className={adminButtonClass('workflowSecondary')}>
                    {infosecBusy ? 'Saving…' : infosec ? 'Update CISO assessment' : 'Record CISO assessment'}
                  </button>
                </div>
              </div>
            ) : infosec ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <InfoField label="SOC 2" value={labelOf(INFOSEC_CERT_LABELS, infosec.soc2)} />
                <InfoField label="ISO 27001" value={labelOf(INFOSEC_CERT_LABELS, infosec.iso27001)} />
                <InfoField label="Data Location Acceptable" value={yesNo(infosec.dataLocationAcceptable)} />
                <InfoField label="Disaster Recovery Plan Acceptable" value={yesNo(infosec.drPlanAcceptable)} />
                <InfoField label="Verdict" value={labelOf(INFOSEC_VERDICT_LABELS, infosec.verdict)} />
                <div className="md:col-span-2">
                  <InfoSlot label="Opinion"><span className="whitespace-pre-wrap">{infosec.opinion}</span></InfoSlot>
                </div>
                <InfoField
                  label="Recorded"
                  value={infosec.recordedBy ? `${infosec.recordedBy}${infosec.recordedAt ? ` · ${new Date(infosec.recordedAt).toLocaleString()}` : ''}` : null}
                  mono
                />
              </div>
            ) : (
              <p className="font-mono text-[11px] text-adm-t3">Not recorded yet — waiting for the CISO</p>
            )}
          </div>
        )}

        {/* 结论按钮 */}
        {writable && (
          <div className="border-t border-adm-border pt-4">
            <SubHeading>Conclusion</SubHeading>
            {returned ? (
              <p className="font-mono text-[11px] text-adm-t3">
                The application is back with {applicant} for resubmission — screening and assessment can still be recorded, but no conclusion can be recorded until it is resubmitted.
              </p>
            ) : target ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={concluding} onClick={() => { setConcludeError(''); setReasonFor('RETURNED'); }} className={adminButtonClass('workflowSecondary')}>
                    Return for documents
                  </button>
                  <button type="button" disabled={concluding} onClick={() => { setConcludeError(''); setReasonFor('REJECTED'); }} className={adminButtonClass('workflowNegative')}>
                    Reject
                  </button>
                  {canSendAtAll && (
                    <button
                      type="button"
                      disabled={concluding || sendBlockedReason !== ''}
                      title={sendBlockedReason || undefined}
                      onClick={() => void conclude('SENT_FOR_APPROVAL')}
                      className={adminButtonClass('workflowPrimary')}
                    >
                      Send for approval
                    </button>
                  )}
                </div>
                {canSendAtAll && sendBlockedReason && <p className="mt-2 font-mono text-[11px] text-adm-t3">{sendBlockedReason}</p>}
                {concludeError && !reasonFor && <p className="mt-2 text-xs text-adm-red">{concludeError}</p>}
              </>
            ) : null}
          </div>
        )}
      </div>

      {reasonFor && (
        <ReasonDialog
          title={reasonFor === 'RETURNED' ? 'Return for documents' : 'Reject application'}
          hint={
            reasonFor === 'RETURNED'
              ? `${applicant} will see the reason, can edit the application and add documents, then resubmit.`
              : 'Rejected is final — the application ends here and a new one has to be filed.'
          }
          confirmLabel={reasonFor === 'RETURNED' ? 'Return' : 'Reject'}
          danger={reasonFor === 'REJECTED'}
          busy={concluding}
          error={concludeError}
          onCancel={() => setReasonFor(null)}
          onConfirm={(reason) => void conclude(reasonFor, reason)}
        />
      )}
    </DetailCard>
  );
};
