// admin-web/src/pages/ServiceProviderApplyPage.tsx
// 甲波六 T8：服务商申请页——运营填 spec §5.1 的完整申请表 + 材料。两条路由共用本页：
//   .../service-providers/new                  新申请（VENDOR_APPLY）
//   .../service-providers/:vendorNo/resubmit   被退回后改申请、补材料重提（VENDOR_APPLY，仅「已退回」态）
// 重大性自判四问 + 换人难度必答、没有默认答案；四问任一答「会」系统判重大（页面只预告，判定在后端，运营改不了）。
// 「是否受监管职能」答是 → 发牌机构 + 牌照号必填。材料槽位随答案增减：一般档 2 份，受监管加牌照副本，重大档再加 6 份。
// 文件在服务商建好前没有可传的地址，所以先在页面里暂存选中的文件；提交成功拿到 vendorNo 后逐槽上传，
// 全部传完才跳详情；有槽传失败时留在本页说明（申请已建，缺的文件可在详情页补）。
// 实际控制人（UBO）序号 seq 的规矩（重提时绝不重排，R4）与材料槽位的暂存 / 上传，与 LP 申请页共用
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
import { MaterialityPill } from '../components/ui/PartnerStatusPill';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  SERVICE_PROVIDERS_PATH,
  VENDOR_DOC_TYPE_LABELS,
  VENDOR_IMPACT_QUESTIONS,
  VENDOR_REPLACEABILITY_LABELS,
  expectedVendorDocTypes,
  labelOf,
} from '../utils/partnerStatusMap';
import type { VendorView } from '../utils/vendorTypes';
import type { StoredDocumentView } from '../components/compliance/DocumentsCard';

type Answer = boolean | null;
type ImpactField = (typeof VENDOR_IMPACT_QUESTIONS)[number]['field'];

const fi = 'mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs';
const API = import.meta.env.VITE_API_URL;

/** 必答的是/否：没有默认答案（null = 还没答）。 */
const YesNoField = ({
  label,
  value,
  onChange,
  yesLabel = 'Yes',
  noLabel = 'No',
}: {
  label: string;
  value: Answer;
  onChange: (next: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
}) => (
  <div className="text-xs">
    <p>{label}</p>
    <div className="mt-1 flex gap-1.5">
      {([[true, yesLabel], [false, noLabel]] as const).map(([option, text]) => (
        <button
          key={text}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={`rounded border px-3 py-1 text-xs ${
            value === option ? 'border-adm-amber bg-adm-amber/10 text-adm-t1' : 'border-adm-border text-adm-t2 hover:bg-adm-hover'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  </div>
);

const ServiceProviderApplyPage = () => {
  const { vendorNo: resubmitVendorNo } = useParams<{ vendorNo: string }>();
  const isResubmit = Boolean(resubmitVendorNo);
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [registeredIn, setRegisteredIn] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [deliveryLocations, setDeliveryLocations] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const { owners, load: loadOwners, addOwner, removeOwner, patchOwner } = useBeneficialOwners(isResubmit);
  const [licensingAuthority, setLicensingAuthority] = useState('');
  const [licenceNo, setLicenceNo] = useState('');

  const [serviceDescription, setServiceDescription] = useState('');
  const [regulatedFunction, setRegulatedFunction] = useState<Answer>(null);
  const [contractStart, setContractStart] = useState('');
  const [contractEnd, setContractEnd] = useState('');
  const [involvesPersonalData, setInvolvesPersonalData] = useState<Answer>(null);
  const [involvesConfidentialInfo, setInvolvesConfidentialInfo] = useState<Answer>(null);
  const [annualFee, setAnnualFee] = useState('');
  const [feeCurrency, setFeeCurrency] = useState('');
  const [subcontracts, setSubcontracts] = useState(false);
  const [subcontractorNames, setSubcontractorNames] = useState('');
  const [applicationReason, setApplicationReason] = useState('');

  const [impacts, setImpacts] = useState<Record<ImpactField, Answer>>({
    impactLicence: null,
    impactLegal: null,
    impactFinancial: null,
    impactContinuity: null,
  });
  const [replaceability, setReplaceability] = useState('');
  /** 重提时库里已有的判定：原 MATERIAL（自判或合规升档）重提后仍 MATERIAL，后端不降档。 */
  const [loadedCriticality, setLoadedCriticality] = useState<string | null>(null);
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);

  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [slotState, setSlotState] = useState<Record<string, SlotState>>({});
  const [existingDocs, setExistingDocs] = useState<StoredDocumentView[]>([]);

  const [loading, setLoading] = useState(isResubmit);
  const [loadedStatus, setLoadedStatus] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedVendorNo, setSubmittedVendorNo] = useState<string | null>(null);

  // 重提：预填申请 + 现有文件 + 退回原因。
  useEffect(() => {
    if (!resubmitVendorNo) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const enc = encodeURIComponent(resubmitVendorNo);
        const [detailRes, docsRes, assessRes] = await Promise.all([
          adminFetch(`${API}/admin/outsourcing-vendors/${enc}`),
          adminFetch(`${API}/admin/outsourcing-vendors/${enc}/documents`),
          adminFetch(`${API}/admin/outsourcing-vendors/${enc}/assessment`),
        ]);
        if (!detailRes.ok) { setError(await getApiErrorMessage(detailRes, 'Failed to load the application')); return; }
        const d = (await detailRes.json()) as VendorView;
        if (cancelled) return;
        setLoadedStatus(d.status);
        setName(d.name);
        setRegisteredIn(d.registeredIn);
        setRegistrationNo(d.registrationNo);
        setDeliveryLocations(d.deliveryLocations.join(', '));
        setContactName(d.contactName);
        setContactEmail(d.contactEmail);
        loadOwners(d.beneficialOwners);
        setLicensingAuthority(d.licensingAuthority ?? '');
        setLicenceNo(d.licenceNo ?? '');
        setServiceDescription(d.serviceDescription);
        setRegulatedFunction(d.regulatedFunction);
        // 后端把日期存成 DateTime：YYYY-MM-DD 回来是当日 UTC 零点，截前 10 位避免时区把日期推一天。
        setContractStart(d.contractStart.slice(0, 10));
        setContractEnd(d.contractEnd ? d.contractEnd.slice(0, 10) : '');
        setInvolvesPersonalData(d.involvesPersonalData);
        setInvolvesConfidentialInfo(d.involvesConfidentialInfo);
        setAnnualFee(d.annualFee ?? '');
        setFeeCurrency(d.feeCurrency ?? '');
        setSubcontracts(d.subcontracts);
        setSubcontractorNames(d.subcontractorNames ?? '');
        setApplicationReason(d.applicationReason);
        setImpacts({
          impactLicence: d.impactLicence,
          impactLegal: d.impactLegal,
          impactFinancial: d.impactFinancial,
          impactContinuity: d.impactContinuity,
        });
        setReplaceability(d.replaceability);
        setLoadedCriticality(d.criticality);
        setUpgradeReason(d.criticalityReason);
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
  }, [resubmitVendorNo]);

  const anyImpact = VENDOR_IMPACT_QUESTIONS.some((q) => impacts[q.field] === true);
  const allImpactsAnswered = VENDOR_IMPACT_QUESTIONS.every((q) => impacts[q.field] !== null);
  const material = anyImpact || loadedCriticality === 'MATERIAL';

  const parsedLocations = deliveryLocations.split(',').map((l) => l.trim()).filter(Boolean);

  const validate = (): string => {
    if (!name.trim()) return 'Legal name is required';
    if (!registeredIn.trim()) return 'Country / jurisdiction of registration is required';
    if (!registrationNo.trim()) return 'Registration number is required';
    if (parsedLocations.length === 0) return 'Enter at least one service delivery / data storage location';
    if (!contactName.trim()) return 'Contact name is required';
    if (!contactEmail.trim()) return 'Contact email is required';
    if (hasNamelessOwner(owners)) return 'Every beneficial owner row needs a name';
    if (!serviceDescription.trim()) return 'Service description is required';
    if (regulatedFunction === null) return 'Say whether this is a regulated function';
    if (regulatedFunction && (!licensingAuthority.trim() || !licenceNo.trim())) {
      return 'A regulated function requires both the licensing authority and the licence number';
    }
    if (!contractStart) return 'Contract start date is required';
    if (involvesPersonalData === null) return 'Say whether personal data is involved';
    if (involvesConfidentialInfo === null) return 'Say whether confidential information is involved';
    if (annualFee.trim() && Number.isNaN(Number(annualFee))) return 'Annual fee must be a number';
    if (!applicationReason.trim()) return 'The reason for the application is required';
    if (!allImpactsAnswered) return 'Answer all four materiality questions';
    if (!replaceability) return 'Say how hard this provider would be to replace';
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
        deliveryLocations: parsedLocations,
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        beneficialOwners: ownersPayload(owners),
        ...(licensingAuthority.trim() ? { licensingAuthority: licensingAuthority.trim() } : {}),
        ...(licenceNo.trim() ? { licenceNo: licenceNo.trim() } : {}),
        serviceDescription: serviceDescription.trim(),
        regulatedFunction,
        contractStart,
        ...(contractEnd ? { contractEnd } : {}),
        involvesPersonalData,
        involvesConfidentialInfo,
        ...(annualFee.trim() ? { annualFee: annualFee.trim() } : {}),
        ...(feeCurrency.trim() ? { feeCurrency: feeCurrency.trim().toUpperCase() } : {}),
        subcontracts,
        ...(subcontracts && subcontractorNames.trim() ? { subcontractorNames: subcontractorNames.trim() } : {}),
        applicationReason: applicationReason.trim(),
        impactLicence: impacts.impactLicence,
        impactLegal: impacts.impactLegal,
        impactFinancial: impacts.impactFinancial,
        impactContinuity: impacts.impactContinuity,
        replaceability,
      };
      const url = isResubmit
        ? `${API}/admin/outsourcing-vendors/${encodeURIComponent(resubmitVendorNo as string)}/resubmit`
        : `${API}/admin/outsourcing-vendors`;
      const res = await adminFetch(url, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) { setError(await getApiErrorMessage(res, isResubmit ? 'Failed to resubmit the application' : 'Failed to submit the application')); return; }
      const { vendorNo } = (await res.json()) as { vendorNo: string };
      setSubmittedVendorNo(vendorNo);

      // 申请已建好：只传当前槽位里选中的文件（答案改回去、槽位消失的文件不传）。
      const failed = await uploadStagedFiles({
        url: `${API}/admin/outsourcing-vendors/${encodeURIComponent(vendorNo)}/documents`,
        docTypes: slotTypes,
        files,
        onSlotState: (docType, state) => setSlotState((cur) => ({ ...cur, [docType]: state })),
      });
      if (failed === 0) navigate(`${SERVICE_PROVIDERS_PATH}/${encodeURIComponent(vendorNo)}`);
      else setError(`${vendorNo} was ${isResubmit ? 'resubmitted' : 'submitted'}, but ${failed} document(s) could not be uploaded. Open the provider to add them.`);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to submit the application');
    } finally {
      setSubmitting(false);
    }
  };

  const backTo = isResubmit ? `${SERVICE_PROVIDERS_PATH}/${encodeURIComponent(resubmitVendorNo as string)}` : SERVICE_PROVIDERS_PATH;

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
    return (
      <ResubmitGuard
        title="Resubmit service provider application"
        subtitle={resubmitVendorNo}
        status={loadedStatus}
        error={error}
        onBack={() => navigate(backTo)}
      />
    );
  }

  // 槽位 = 眼下应有的类别 ∪ 已传过文件的类别（不让已传的文件因答案改动而藏起来），按词表键序。
  const expected = expectedVendorDocTypes({ regulated: regulatedFunction === true, material });
  const slotTypes = Object.keys(VENDOR_DOC_TYPE_LABELS).filter(
    (code) => expected.includes(code) || existingDocs.some((d) => d.docType === code),
  );

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title={isResubmit ? 'Resubmit service provider application' : 'Apply for a service provider'}
        subtitle={
          isResubmit
            ? `${resubmitVendorNo} — edit the application, add documents, then resubmit it to compliance`
            : 'Compliance assesses the application before any approval is raised'
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
              <input value={name} onChange={(e) => setName(e.target.value)} className={fi} placeholder="e.g. Nimbus Cloud Hosting LLC" />
            </label>
            <label className="block text-xs">Country / jurisdiction of registration *
              <input value={registeredIn} onChange={(e) => setRegisteredIn(e.target.value)} className={fi} placeholder="e.g. United Arab Emirates (Dubai)" />
            </label>
            <label className="block text-xs">Registration number *
              <input value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} className={`${fi} font-mono`} />
            </label>
            <label className="block text-xs md:col-span-2">Service delivery / data storage locations * <span className="text-adm-t3">(countries, comma-separated)</span>
              <input value={deliveryLocations} onChange={(e) => setDeliveryLocations(e.target.value)} className={fi} placeholder="e.g. AE, IE" />
            </label>
            <label className="block text-xs">Contact name *
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={fi} />
            </label>
            <label className="block text-xs">Contact email *
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={fi} />
            </label>
            <label className="block text-xs">Licensing authority {regulatedFunction ? '*' : <span className="text-adm-t3">(optional)</span>}
              <input value={licensingAuthority} onChange={(e) => setLicensingAuthority(e.target.value)} className={fi} placeholder="e.g. Dubai Financial Services Authority" />
            </label>
            <label className="block text-xs">Licence number {regulatedFunction ? '*' : <span className="text-adm-t3">(optional)</span>}
              <input value={licenceNo} onChange={(e) => setLicenceNo(e.target.value)} className={`${fi} font-mono`} />
            </label>

            <BeneficialOwnersField
              owners={owners}
              hint="optional — each one is screened by name during the assessment"
              onAdd={addOwner}
              onRemove={removeOwner}
              onPatch={patchOwner}
            />
          </DetailCard>

          <DetailCard title="What they will do for us" columns={2}>
            <label className="block text-xs md:col-span-2">Service description *
              <textarea value={serviceDescription} onChange={(e) => setServiceDescription(e.target.value)} rows={2} className={fi} placeholder="e.g. Cloud hosting of the trading platform and its databases" />
            </label>
            <YesNoField
              label="Is this a regulated function (MLRO / CISO / DPO … — VARA IV.A.3)? *"
              value={regulatedFunction}
              onChange={setRegulatedFunction}
            />
            <div className="hidden md:block" />
            <label className="block text-xs">Contract start date *
              <input type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} className={fi} />
            </label>
            <label className="block text-xs">Contract end date <span className="text-adm-t3">(optional)</span>
              <input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} className={fi} />
            </label>
            <YesNoField label="Does the service involve personal data? *" value={involvesPersonalData} onChange={setInvolvesPersonalData} />
            <YesNoField label="Does the service involve confidential information? *" value={involvesConfidentialInfo} onChange={setInvolvesConfidentialInfo} />
            <label className="block text-xs">Annual fee <span className="text-adm-t3">(optional)</span>
              <input type="number" min="0" step="any" value={annualFee} onChange={(e) => setAnnualFee(e.target.value)} className={`${fi} font-mono`} placeholder="e.g. 120000" />
            </label>
            <label className="block text-xs">Fee currency <span className="text-adm-t3">(optional)</span>
              <input value={feeCurrency} onChange={(e) => setFeeCurrency(e.target.value)} className={`${fi} font-mono uppercase`} placeholder="e.g. USD" />
            </label>
            <div className="md:col-span-2">
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={subcontracts} onChange={(e) => setSubcontracts(e.target.checked)} />
                The provider subcontracts part of the service
              </label>
              {subcontracts && (
                <label className="mt-2 block text-xs">Subcontractors
                  <textarea value={subcontractorNames} onChange={(e) => setSubcontractorNames(e.target.value)} rows={2} className={fi} placeholder="Names of the subcontractors" />
                </label>
              )}
            </div>
            <label className="block text-xs md:col-span-2">Reason for the application *
              <textarea value={applicationReason} onChange={(e) => setApplicationReason(e.target.value)} rows={3} className={fi} placeholder="Why do we need this service provider?" />
            </label>
          </DetailCard>

          <DetailCard
            title="How critical is this service"
            columns={1}
            description="Your own answers decide the materiality: if any of the four is Yes, the system treats the provider as material. You cannot override it, and compliance can only raise it later, never lower it."
          >
            <div className="space-y-3">
              {VENDOR_IMPACT_QUESTIONS.map((q) => (
                <YesNoField
                  key={q.field}
                  label={`${q.question} *`}
                  value={impacts[q.field]}
                  onChange={(next) => setImpacts((cur) => ({ ...cur, [q.field]: next }))}
                />
              ))}
              <YesNoField
                label="How hard would it be to replace this provider? * (for compliance's reference — it does not change the judgement)"
                value={replaceability === '' ? null : replaceability === 'EASY'}
                onChange={(easy) => setReplaceability(easy ? 'EASY' : 'HARD')}
                yesLabel={VENDOR_REPLACEABILITY_LABELS.EASY}
                noLabel={VENDOR_REPLACEABILITY_LABELS.HARD}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-adm-border pt-3 text-xs">
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">System judgement</span>
              {material ? (
                <>
                  <MaterialityPill criticality="MATERIAL" size="md" />
                  <span className="text-adm-t3">
                    {anyImpact
                      ? 'Material providers also need a CISO assessment, CFO and senior-management approval, and a VARA notification before they go live.'
                      : `Already treated as material${upgradeReason ? ` (raised by compliance: ${upgradeReason})` : ''} — it stays material when resubmitted.`}
                  </span>
                </>
              ) : allImpactsAnswered ? (
                <>
                  <MaterialityPill criticality="NON_MATERIAL" size="md" />
                  <span className="text-adm-t3">Compliance may still raise it to material during the assessment.</span>
                </>
              ) : (
                <span className="text-adm-t3">Answer the four questions to see it</span>
              )}
            </div>
          </DetailCard>

          <DetailCard
            title="Documents"
            columns={1}
            description="All optional — anything missing can be added later, and compliance can return the application for what is still missing. PDF, PNG or JPG, up to 10 MB each. The list follows your answers above."
          >
            <StagedDocumentSlots
              slots={slotTypes.map((code) => ({ code, label: labelOf(VENDOR_DOC_TYPE_LABELS, code) }))}
              files={files}
              slotState={slotState}
              existingDocs={existingDocs}
              disabled={submitting || submittedVendorNo !== null}
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
          {submittedVendorNo ? (
            <button
              type="button"
              onClick={() => navigate(`${SERVICE_PROVIDERS_PATH}/${encodeURIComponent(submittedVendorNo)}`)}
              className={adminButtonClass('modalConfirm')}
            >
              Open {submittedVendorNo}
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

export default ServiceProviderApplyPage;
