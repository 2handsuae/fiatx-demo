// admin-web/src/pages/LpProfileApplyPage.tsx
// 甲波六 T5：LP 尽调申请页——金库填 spec §4.1 的完整申请表 + 六份文件。两条路由共用本页：
//   /admin/lp-profiles/new            新申请（LP_PROFILE_CREATE）
//   /admin/lp-profiles/:lpNo/resubmit 被退回后改申请、补文件重提（LP_PROFILE_RESUBMIT，仅「已退回」态）
// 文件在档案建好前没有可传的地址，所以先在页面里暂存选中的文件；提交成功拿到 lpNo 后逐槽上传，
// 全部传完才跳详情；有槽传失败时留在本页说明（档案已建，缺的文件可在详情页补）。
// 实际控制人（UBO）序号 seq 的规矩（重提时绝不重排，R4）与材料槽位的暂存 / 上传，两张申请页共用
// BeneficialOwnersField / StagedDocumentSlots（components/compliance/），本页只管自己的字段分组。
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { DetailCard } from '../components/compliance/DetailPageComponents';
import {
  BeneficialOwnersField,
  hasNamelessOwner,
  ownersPayload,
  useBeneficialOwners,
} from '../components/compliance/BeneficialOwnersField';
import { ResubmitGuard } from '../components/compliance/ResubmitGuard';
import { StagedDocumentSlots, uploadStagedFiles, type SlotState } from '../components/compliance/StagedDocumentSlots';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { LP_DOC_TYPE_LABELS, LP_TRADING_TYPE_LABELS } from '../utils/partnerStatusMap';
import type { StoredDocumentView } from '../components/compliance/DocumentsCard';

interface ProfileView {
  lpNo: string;
  name: string;
  registeredIn: string;
  registrationNo: string;
  licensingAuthority: string;
  licenceNo: string;
  beneficialOwners: { seq: number; name: string; nationality?: string }[];
  tradingTypes: string[];
  expectedMonthlyVolume: string;
  volumeCurrency: string;
  applicationReason: string;
  agreementRef: string;
  agreementStart: string | null;
  contactName: string;
  contactEmail: string;
  status: string;
}

const fi = 'mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs';
const API = import.meta.env.VITE_API_URL;

const LpProfileApplyPage = () => {
  const { lpNo: resubmitLpNo } = useParams<{ lpNo: string }>();
  const isResubmit = Boolean(resubmitLpNo);
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [registeredIn, setRegisteredIn] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [licensingAuthority, setLicensingAuthority] = useState('');
  const [licenceNo, setLicenceNo] = useState('');
  const { owners, load: loadOwners, addOwner, removeOwner, patchOwner } = useBeneficialOwners(isResubmit);
  const [tradingTypes, setTradingTypes] = useState<string[]>([]);
  const [volume, setVolume] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [reason, setReason] = useState('');
  const [agreementRef, setAgreementRef] = useState('');
  const [agreementStart, setAgreementStart] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [slotState, setSlotState] = useState<Record<string, SlotState>>({});
  const [existingDocs, setExistingDocs] = useState<StoredDocumentView[]>([]);

  const [loading, setLoading] = useState(isResubmit);
  const [loadedStatus, setLoadedStatus] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedLpNo, setSubmittedLpNo] = useState<string | null>(null);

  // 重提：预填档案 + 现有文件 + 退回原因。
  useEffect(() => {
    if (!resubmitLpNo) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const enc = encodeURIComponent(resubmitLpNo);
        const [detailRes, docsRes, assessRes] = await Promise.all([
          adminFetch(`${API}/admin/lp-profiles/${enc}`),
          adminFetch(`${API}/admin/lp-profiles/${enc}/documents`),
          adminFetch(`${API}/admin/lp-profiles/${enc}/assessment`),
        ]);
        if (!detailRes.ok) { setError(await getApiErrorMessage(detailRes, 'Failed to load the application')); return; }
        const d = (await detailRes.json()) as ProfileView;
        if (cancelled) return;
        setLoadedStatus(d.status);
        setName(d.name);
        setRegisteredIn(d.registeredIn);
        setRegistrationNo(d.registrationNo);
        setLicensingAuthority(d.licensingAuthority);
        setLicenceNo(d.licenceNo);
        loadOwners(d.beneficialOwners);
        setTradingTypes(d.tradingTypes);
        setVolume(d.expectedMonthlyVolume);
        setCurrency(d.volumeCurrency);
        setReason(d.applicationReason);
        setAgreementRef(d.agreementRef);
        // 后端把日期存成 DateTime：YYYY-MM-DD 回来是当日 UTC 零点，截前 10 位避免时区把日期推一天。
        setAgreementStart(d.agreementStart ? d.agreementStart.slice(0, 10) : '');
        setContactName(d.contactName);
        setContactEmail(d.contactEmail);
        if (docsRes.ok) setExistingDocs((await docsRes.json()) as StoredDocumentView[]);
        if (assessRes.ok) {
          const a = (await assessRes.json()) as { conclusion: string | null; conclusionReason: string | null };
          if (a.conclusion === 'RETURNED') setReturnReason(a.conclusionReason);
        }
      } catch (e) {
        if (e instanceof AdminSessionError) return;
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [resubmitLpNo]);

  const toggleTradingType = (code: string) =>
    setTradingTypes((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  const validate = (): string => {
    if (!name.trim()) return 'Legal name is required';
    if (!registeredIn.trim()) return 'Country / jurisdiction of registration is required';
    if (!registrationNo.trim()) return 'Registration number is required';
    if (!licensingAuthority.trim()) return 'Licensing authority is required';
    if (!licenceNo.trim()) return 'Licence number is required';
    if (hasNamelessOwner(owners)) return 'Every beneficial owner row needs a name';
    if (tradingTypes.length === 0) return 'Choose at least one trading type';
    if (!volume.trim() || Number.isNaN(Number(volume))) return 'Expected monthly volume must be a number';
    if (!currency.trim()) return 'Volume currency is required';
    if (!reason.trim()) return 'The reason for the application is required';
    if (!agreementRef.trim()) return 'Agreement reference is required';
    if (!contactName.trim()) return 'Contact name is required';
    if (!contactEmail.trim()) return 'Contact email is required';
    return '';
  };

  const submit = async () => {
    setError('');
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        registeredIn: registeredIn.trim(),
        registrationNo: registrationNo.trim(),
        licensingAuthority: licensingAuthority.trim(),
        licenceNo: licenceNo.trim(),
        beneficialOwners: ownersPayload(owners),
        tradingTypes,
        expectedMonthlyVolume: volume.trim(),
        volumeCurrency: currency.trim().toUpperCase(),
        applicationReason: reason.trim(),
        agreementRef: agreementRef.trim(),
        ...(agreementStart ? { agreementStart } : {}),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
      };
      const url = isResubmit
        ? `${API}/admin/lp-profiles/${encodeURIComponent(resubmitLpNo as string)}/resubmit`
        : `${API}/admin/lp-profiles`;
      const res = await adminFetch(url, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) { setError(await getApiErrorMessage(res, isResubmit ? 'Failed to resubmit the application' : 'Failed to submit the application')); return; }
      const { lpNo } = (await res.json()) as { lpNo: string };
      setSubmittedLpNo(lpNo);

      // 档案已建好：逐槽上传选中的文件。
      const failed = await uploadStagedFiles({
        url: `${API}/admin/lp-profiles/${encodeURIComponent(lpNo)}/documents`,
        docTypes: Object.keys(files),
        files,
        onSlotState: (docType, state) => setSlotState((cur) => ({ ...cur, [docType]: state })),
      });
      if (failed === 0) navigate(`/admin/lp-profiles/${encodeURIComponent(lpNo)}`);
      else setError(`${lpNo} was ${isResubmit ? 'resubmitted' : 'submitted'}, but ${failed} document(s) could not be uploaded. Open the LP to add them.`);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to submit the application');
    } finally {
      setSubmitting(false);
    }
  };

  const backTo = isResubmit ? `/admin/lp-profiles/${encodeURIComponent(resubmitLpNo as string)}` : '/admin/lp-profiles';

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading application...</p>
      </div>
    );
  }

  // 重提只对「已退回」开放（后端同样拒）；其他状态给一句说明和回路。
  if (isResubmit && loadedStatus !== 'RETURNED') {
    return <ResubmitGuard title="Resubmit LP application" subtitle={resubmitLpNo} status={loadedStatus} error={error} onBack={() => navigate(backTo)} />;
  }

  const docSlots = Object.entries(LP_DOC_TYPE_LABELS).map(([code, label]) => ({ code, label }));

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title={isResubmit ? 'Resubmit LP application' : 'Register LP'}
        subtitle={
          isResubmit
            ? `${resubmitLpNo} — edit the application, add documents, then resubmit it to compliance`
            : 'Liquidity provider application — compliance assesses it before any approval is raised'
        }
      >
        <button type="button" onClick={() => navigate(backTo)} className={adminButtonClass('listSecondary')}>Cancel</button>
      </PageTitleBar>

      {isResubmit && (
        <div className="border-b border-adm-border bg-adm-amber/10 px-5 py-2 font-mono text-[11px] text-adm-amber">
          Returned for documents{returnReason ? `: ${returnReason}` : ''}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[960px] space-y-4">
          <DetailCard title="Who is this" columns={2}>
            <label className="block text-xs md:col-span-2">Legal name *
              <input value={name} onChange={(e) => setName(e.target.value)} className={fi} placeholder="e.g. Oryx Digital Markets Ltd" />
            </label>
            <label className="block text-xs">Country / jurisdiction of registration *
              <input value={registeredIn} onChange={(e) => setRegisteredIn(e.target.value)} className={fi} placeholder="e.g. United Arab Emirates (DIFC)" />
            </label>
            <label className="block text-xs">Registration number *
              <input value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} className={`${fi} font-mono`} />
            </label>
            <label className="block text-xs">Licensing authority *
              <input value={licensingAuthority} onChange={(e) => setLicensingAuthority(e.target.value)} className={fi} placeholder="e.g. Dubai Financial Services Authority" />
            </label>
            <label className="block text-xs">Licence number *
              <input value={licenceNo} onChange={(e) => setLicenceNo(e.target.value)} className={`${fi} font-mono`} />
            </label>

            <BeneficialOwnersField
              owners={owners}
              hint="each one is screened by name during the assessment"
              onAdd={addOwner}
              onRemove={removeOwner}
              onPatch={patchOwner}
            />
          </DetailCard>

          <DetailCard title="What they will do with us" columns={2}>
            <div className="md:col-span-2">
              <p className="mb-1 text-xs">Trading types *</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {Object.entries(LP_TRADING_TYPE_LABELS).map(([code, label]) => (
                  <label key={code} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={tradingTypes.includes(code)} onChange={() => toggleTradingType(code)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <label className="block text-xs">Expected monthly volume *
              <input type="number" min="0" step="any" value={volume} onChange={(e) => setVolume(e.target.value)} className={`${fi} font-mono`} placeholder="e.g. 5000000" />
            </label>
            <label className="block text-xs">Volume currency *
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${fi} font-mono uppercase`} placeholder="e.g. USD" />
            </label>
            <label className="block text-xs md:col-span-2">Reason for the application *
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={fi} placeholder="Why do we want this liquidity provider?" />
            </label>
          </DetailCard>

          <DetailCard title="Agreement and contact" columns={2}>
            <label className="block text-xs">Agreement reference *
              <input value={agreementRef} onChange={(e) => setAgreementRef(e.target.value)} className={`${fi} font-mono`} placeholder="e.g. LPA-2026-014" />
            </label>
            <label className="block text-xs">Agreement start date
              <input type="date" value={agreementStart} onChange={(e) => setAgreementStart(e.target.value)} className={fi} />
            </label>
            <label className="block text-xs">Contact name *
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={fi} />
            </label>
            <label className="block text-xs">Contact email *
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={fi} />
            </label>
          </DetailCard>

          <DetailCard
            title="Documents"
            columns={1}
            description="All optional — anything missing can be added later, and compliance can return the application for what is still missing. PDF, PNG or JPG, up to 10 MB each."
          >
            <StagedDocumentSlots
              slots={docSlots}
              files={files}
              slotState={slotState}
              existingDocs={existingDocs}
              disabled={submitting || submittedLpNo !== null}
              onPick={(docType, f) => setFiles((cur) => ({ ...cur, [docType]: f }))}
            />
          </DetailCard>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-adm-border bg-adm-panel px-6 py-3">
        <div className="min-w-0 text-xs">
          {error && <p className="text-adm-red">{error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {submittedLpNo ? (
            <button
              type="button"
              onClick={() => navigate(`/admin/lp-profiles/${encodeURIComponent(submittedLpNo)}`)}
              className={adminButtonClass('modalConfirm')}
            >
              Open {submittedLpNo}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => navigate(backTo)} className={adminButtonClass('modalCancel')}>Cancel</button>
              <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
                {submitting ? 'Submitting…' : isResubmit ? 'Resubmit application' : 'Submit application'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LpProfileApplyPage;
