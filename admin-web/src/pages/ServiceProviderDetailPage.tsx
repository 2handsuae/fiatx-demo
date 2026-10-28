// admin-web/src/pages/ServiceProviderDetailPage.tsx
// 甲波六 T8：服务商详情——申请资料、重大性、材料、合规评估（+ 重大档的 CISO 评估）、审批、VARA 报备单、终止。
// 与 LP 详情（LpProfileDetail.tsx）同一副骨架：材料卡 DocumentsCard 与评估面板 DueDiligencePanel 两条线共用。
// 「评估」可写窗口 = 服务商在待评估 / 已退回（R9：已退回时表单可写但不提供结论按钮，面板自己处理）。
// 重大性只升不降：详情页没有任何降档入口；合规官在窗口内可「Upgrade to MATERIAL」（必填理由）。
// 重大服务商批后落「待报备」，横幅提示并链到自动开出的告知单；报送台标记已报送后自动转生效。
// 铁律⑥：后端投影零 UUID；状态 / 重大性 / 回答一律经词表，员工看不到内部枚举（R11）。
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { DetailCard, DetailPageHeader, InfoField, InfoSlot } from '../components/compliance/DetailPageComponents';
import { DocumentsCard, type StoredDocumentView } from '../components/compliance/DocumentsCard';
import { DueDiligencePanel, ReasonDialog, type DueDiligenceView } from '../components/compliance/DueDiligencePanel';
import { MaterialityPill, PartnerStatusPill } from '../components/ui/PartnerStatusPill';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { ViewAuditTrailButton } from '../components/common/ViewAuditTrailButton';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  RISK_TIER_LABELS,
  SERVICE_PROVIDERS_PATH,
  VENDOR_CRITICALITY_META,
  VENDOR_DOC_TYPE_LABELS,
  VENDOR_IMPACT_QUESTIONS,
  VENDOR_REPLACEABILITY_LABELS,
  expectedVendorDocTypes,
  labelOf,
} from '../utils/partnerStatusMap';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

/** 后端 VendorView（零 id、零 UUID）。 */
interface Detail {
  vendorNo: string;
  name: string;
  registeredIn: string;
  registrationNo: string;
  deliveryLocations: string[];
  contactName: string;
  contactEmail: string;
  beneficialOwners: { seq: number; name: string; nationality?: string }[];
  licensingAuthority: string | null;
  licenceNo: string | null;
  serviceDescription: string;
  regulatedFunction: boolean;
  involvesPersonalData: boolean;
  involvesConfidentialInfo: boolean;
  contractStart: string;
  contractEnd: string | null;
  annualFee: string | null;
  feeCurrency: string | null;
  subcontracts: boolean;
  subcontractorNames: string | null;
  applicationReason: string;
  impactLicence: boolean;
  impactLegal: boolean;
  impactFinancial: boolean;
  impactContinuity: boolean;
  replaceability: string;
  criticality: string;
  criticalityReason: string | null;
  status: string;
  approvalNo: string | null;
  notificationFilingNo: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

const API = import.meta.env.VITE_API_URL;

const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');
/** 合同日在库里是 UTC 零点；截前 10 位原样显示，不让本地时区把日期推一天。 */
const dateOnly = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);

const ServiceProviderDetailPage = () => {
  const { vendorNo } = useParams<{ vendorNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  // 申请 / 重提 / 上传材料同属 VENDOR_APPLY 一组（运营独占）。
  const canApply = hasPermission(PERMISSIONS.VENDOR_APPLY);
  const canTerminate = hasPermission(PERMISSIONS.VENDOR_TERMINATE);
  const canWriteAssessment = hasPermission(PERMISSIONS.DUE_DILIGENCE_WRITE);
  const canWriteInfosec = hasPermission(PERMISSIONS.INFOSEC_ASSESSMENT_WRITE);
  // 跨域回链持码门控：没有读权限的人看文本，不给点了落空的链接。
  const canViewFiling = hasPermission(PERMISSIONS.REG_FILING_DETAIL_READ);
  const canViewApproval = hasPermission(PERMISSIONS.GOV_APPROVAL_DETAIL_READ);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [assessment, setAssessment] = useState<DueDiligenceView | null>(null);
  const [documents, setDocuments] = useState<StoredDocumentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<'UPGRADE' | 'TERMINATE' | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!vendorNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${API}/admin/outsourcing-vendors/${encodeURIComponent(vendorNo)}`);
      if (res.ok) setDetail((await res.json()) as Detail);
      else {
        alert(await getApiErrorMessage(res, 'Failed to load the service provider'));
        navigate(SERVICE_PROVIDERS_PATH);
      }
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 评估壳：存量服务商（尚未按新流程重铺）没有 → 后端 404，面板显示「无评估」而不是报错。
  const fetchAssessment = async () => {
    if (!vendorNo) return;
    try {
      const res = await adminFetch(`${API}/admin/outsourcing-vendors/${encodeURIComponent(vendorNo)}/assessment`);
      setAssessment(res.ok ? ((await res.json()) as DueDiligenceView) : null);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    }
  };

  const fetchDocuments = async () => {
    if (!vendorNo) return;
    try {
      const res = await adminFetch(`${API}/admin/outsourcing-vendors/${encodeURIComponent(vendorNo)}/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    }
  };

  const refreshAll = async () => {
    await Promise.all([fetchDetail(), fetchAssessment(), fetchDocuments()]);
  };

  useEffect(() => {
    if (vendorNo) void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorNo]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 8000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const closeDialog = () => {
    setDialog(null);
    setDialogError('');
  };

  /** 升档 / 终止共用：POST 一个只带原因（终止是备注）的动作，成功后刷新整页。 */
  const submitDialog = async (reason: string) => {
    if (!detail || !dialog) return;
    setDialogError('');
    setDialogBusy(true);
    try {
      const base = `${API}/admin/outsourcing-vendors/${encodeURIComponent(detail.vendorNo)}`;
      const res =
        dialog === 'UPGRADE'
          ? await adminFetch(`${base}/assessment/upgrade-materiality`, { method: 'POST', body: JSON.stringify({ reason }) })
          : await adminFetch(`${base}/terminate`, { method: 'POST', body: JSON.stringify(reason ? { notes: reason } : {}) });
      if (!res.ok) {
        setDialogError(await getApiErrorMessage(res, dialog === 'UPGRADE' ? 'Failed to upgrade the materiality' : 'Failed to terminate the service provider'));
        return;
      }
      setNotice(dialog === 'UPGRADE' ? 'Raised to Material — a CISO assessment is now required before it can be sent for approval' : 'Service provider terminated');
      closeDialog();
      await refreshAll();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setDialogError(e instanceof Error ? e.message : 'The action failed');
    } finally {
      setDialogBusy(false);
    }
  };

  if (loading && !detail)
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading service provider...</p>
      </div>
    );
  if (!detail) return null;

  const isMaterial = detail.criticality === 'MATERIAL';
  const assessable = detail.status === 'PENDING_ASSESSMENT' || detail.status === 'RETURNED';
  const expectedDocs = expectedVendorDocTypes({ regulated: detail.regulatedFunction, material: isMaterial });
  const filingLink = (filingNo: string) =>
    canViewFiling ? (
      <Link to={`/admin/governance/regulatory-filings/${encodeURIComponent(filingNo)}`} className="font-mono text-adm-amber underline hover:opacity-75">
        {filingNo}
      </Link>
    ) : (
      <span className="font-mono">{filingNo}</span>
    );

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="Service Provider"
        subtitle={detail.vendorNo}
        onBack={() => navigate(SERVICE_PROVIDERS_PATH)}
        onRefresh={() => void refreshAll()}
        refreshing={loading}
        backLabel="Service Providers"
      >
        <PartnerStatusPill status={detail.status} size="md" />
        <MaterialityPill criticality={detail.criticality} size="md" />
        <ViewAuditTrailButton params={{ subjectNo: detail.vendorNo }} />
        {detail.status === 'RETURNED' && canApply && (
          <button
            type="button"
            onClick={() => navigate(`${SERVICE_PROVIDERS_PATH}/${encodeURIComponent(detail.vendorNo)}/resubmit`)}
            className={adminButtonClass('workflowPrimary')}
          >
            Edit &amp; resubmit
          </button>
        )}
        {detail.status === 'ACTIVE' && canTerminate && (
          <button type="button" onClick={() => { setDialogError(''); setDialog('TERMINATE'); }} className={adminButtonClass('workflowNegative')}>
            Terminate
          </button>
        )}
      </DetailPageHeader>

      {notice && (
        <div className="border-b border-adm-border bg-adm-green/10 px-5 py-2 font-mono text-[11px] text-adm-green">{notice}</div>
      )}

      {detail.status === 'RETURNED' && (
        <div className="border-b border-adm-border bg-adm-amber/10 px-5 py-2 font-mono text-[11px] text-adm-amber">
          Returned for documents.
          {assessment?.conclusion === 'RETURNED' && assessment.conclusionReason ? ` Reason: ${assessment.conclusionReason}` : ''}
          {' '}Operations can edit the application, add the missing documents and resubmit it.
        </div>
      )}

      {detail.status === 'PENDING_APPROVAL' && (
        <div className="border-b border-adm-border bg-adm-amber/10 px-5 py-2 font-mono text-[11px] text-adm-amber">
          Pending approval ({isMaterial ? 'CFO, then senior management' : 'CFO'}) — the application, documents and assessment are read-only until it is decided.
        </div>
      )}

      {detail.status === 'PENDING_NOTIFICATION' && (
        <div className="border-b border-adm-border bg-adm-blue/10 px-5 py-2 font-mono text-[11px] text-adm-blue">
          Waiting for VARA notification to be submitted
          {detail.notificationFilingNo && <> — notification filing {filingLink(detail.notificationFilingNo)}</>}
          . Approved, but not active yet: payments to this provider stay blocked until the notification is submitted.
        </div>
      )}

      {detail.status === 'REJECTED' && (
        <div className="border-b border-adm-border bg-adm-red/10 px-5 py-2 font-mono text-[11px] text-adm-red">
          {assessment?.conclusion === 'REJECTED' && assessment.conclusionReason
            ? `Rejected by compliance: ${assessment.conclusionReason}`
            : 'Rejected in the approval step.'}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <DetailCard title="Service Provider" columns={3}>
            <InfoField label="Name" value={detail.name} />
            <InfoField label="Registered In" value={detail.registeredIn} />
            <InfoField label="Registration No." value={detail.registrationNo} mono />
            <InfoField label="Delivery / Data Locations" value={detail.deliveryLocations.join(' · ')} />
            <InfoField label="Contact" value={detail.contactName} />
            <InfoField label="Contact Email" value={detail.contactEmail} mono />
            <InfoField label="Licensing Authority" value={detail.licensingAuthority} />
            <InfoField label="Licence No." value={detail.licenceNo} mono />
          </DetailCard>

          <DetailCard title="Application" columns={3}>
            <div className="md:col-span-2 xl:col-span-3">
              <InfoSlot label="Service Description"><span className="whitespace-pre-wrap">{detail.serviceDescription}</span></InfoSlot>
            </div>
            <InfoField label="Regulated Function" value={yesNo(detail.regulatedFunction)} />
            <InfoField label="Personal Data Involved" value={yesNo(detail.involvesPersonalData)} />
            <InfoField label="Confidential Information Involved" value={yesNo(detail.involvesConfidentialInfo)} />
            <InfoField label="Contract Start" value={dateOnly(detail.contractStart)} mono />
            <InfoField label="Contract End" value={dateOnly(detail.contractEnd)} mono />
            <InfoField
              label="Annual Fee"
              value={detail.annualFee ? `${Number(detail.annualFee).toLocaleString('en-US', { maximumFractionDigits: 8 })}${detail.feeCurrency ? ` ${detail.feeCurrency}` : ''}` : null}
              mono
            />
            <InfoField label="Subcontracts" value={yesNo(detail.subcontracts)} />
            {detail.subcontracts && (
              <div className="md:col-span-1 xl:col-span-2">
                <InfoSlot label="Subcontractors"><span className="whitespace-pre-wrap">{detail.subcontractorNames ?? '—'}</span></InfoSlot>
              </div>
            )}
            <div className="md:col-span-2 xl:col-span-3">
              <InfoSlot label="Reason for the Application"><span className="whitespace-pre-wrap">{detail.applicationReason}</span></InfoSlot>
            </div>
          </DetailCard>

          <DetailCard title="Materiality" columns={1}>
            <div className="space-y-1.5">
              {VENDOR_IMPACT_QUESTIONS.map((q) => (
                <div key={q.field} className="flex items-baseline gap-3 text-xs">
                  <span className={`w-14 shrink-0 font-mono ${detail[q.field] ? 'font-semibold text-adm-amber' : 'text-adm-t3'}`}>
                    {detail[q.field] ? '✓ Yes' : '✗ No'}
                  </span>
                  <span className="text-adm-t2">{q.question}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 border-t border-adm-border pt-4 md:grid-cols-3">
              <InfoSlot label="System Judgement"><MaterialityPill criticality={detail.criticality} size="md" /></InfoSlot>
              <InfoField label="Replaceability (reference only)" value={labelOf(VENDOR_REPLACEABILITY_LABELS, detail.replaceability)} />
              {detail.criticalityReason && (
                <InfoSlot label="Raised to Material by Compliance"><span className="whitespace-pre-wrap">{detail.criticalityReason}</span></InfoSlot>
              )}
            </div>
            {canWriteAssessment && assessable && !isMaterial && (
              <div className="flex flex-wrap items-center gap-3 border-t border-adm-border pt-3">
                <button type="button" onClick={() => { setDialogError(''); setDialog('UPGRADE'); }} className={adminButtonClass('workflowSecondary')}>
                  Upgrade to MATERIAL
                </button>
                <span className="font-mono text-[11px] text-adm-t3">Materiality can only be raised, never lowered.</span>
              </div>
            )}
          </DetailCard>

          <DetailCard title={`Beneficial Owners · ${detail.beneficialOwners.length}`} columns={1}>
            <div className="-m-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-adm-border text-left text-adm-t3">
                    {['#', 'Name', 'Nationality'].map((h) => (
                      <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.beneficialOwners.map((o) => (
                    <tr key={o.seq} className="border-b border-adm-border/60">
                      <td className="px-4 py-2 font-mono text-adm-t3">#{o.seq}</td>
                      <td className="px-4 py-2">{o.name}</td>
                      <td className="px-4 py-2 text-adm-t2">{o.nationality ?? '—'}</td>
                    </tr>
                  ))}
                  {detail.beneficialOwners.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-5 text-center text-adm-t3">No beneficial owners listed on the application</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </DetailCard>

          <DocumentsCard
            ownerKind="VENDOR"
            ownerNo={detail.vendorNo}
            basePath="/admin/outsourcing-vendors"
            docTypes={expectedDocs.map((code) => ({ code, label: labelOf(VENDOR_DOC_TYPE_LABELS, code) }))}
            documents={documents}
            canUpload={canApply && assessable}
            onChanged={() => void fetchDocuments()}
          />

          <DueDiligencePanel
            kind="VENDOR"
            targetNo={detail.vendorNo}
            basePath="/admin/outsourcing-vendors"
            assessment={assessment}
            locked={!assessable}
            canWrite={canWriteAssessment}
            canWriteInfosec={canWriteInfosec}
            requireInfosec={isMaterial}
            onChanged={() => void refreshAll()}
          />

          {detail.approvalNo && (
            <DetailCard title="Approval" columns={3}>
              <InfoSlot label="Approval">
                {canViewApproval ? (
                  <Link to={`/admin/governance/approvals/${encodeURIComponent(detail.approvalNo)}`} className="font-mono text-[11px] text-adm-amber underline hover:opacity-75">
                    {detail.approvalNo}
                  </Link>
                ) : (
                  <span className="font-mono text-[11px]">{detail.approvalNo}</span>
                )}
              </InfoSlot>
              <InfoSlot label="Route">
                {isMaterial ? 'CFO, then senior management' : 'CFO'}
                {assessment?.riskTier && (
                  <span className="font-mono text-[10px] text-adm-t3">({labelOf(RISK_TIER_LABELS, assessment.riskTier)} risk)</span>
                )}
              </InfoSlot>
            </DetailCard>
          )}

          {detail.notificationFilingNo && (
            <DetailCard title="VARA Notification" columns={3}>
              <InfoSlot label="Notification Filing">{filingLink(detail.notificationFilingNo)}</InfoSlot>
              <div className="md:col-span-2">
                <InfoSlot label="What It Is">
                  <span>
                    A material service provider must be notified to VARA before it goes live. The filing was opened automatically when the approval passed;
                    {detail.status === 'PENDING_NOTIFICATION'
                      ? ' the provider becomes active once compliance marks it as submitted.'
                      : ' it was submitted, which is what made the provider active.'}
                  </span>
                </InfoSlot>
              </div>
            </DetailCard>
          )}
        </div>

        <aside className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Summary">
            <SidebarKV label="Materiality" value={VENDOR_CRITICALITY_META[detail.criticality]?.label} />
            <SidebarKV label="Regulated function" value={yesNo(detail.regulatedFunction)} />
            <SidebarKV label="Locations" value={detail.deliveryLocations.join(', ')} mono />
            <SidebarKV label="Risk tier" value={assessment?.riskTier ? labelOf(RISK_TIER_LABELS, assessment.riskTier) : null} />
          </SidebarGroup>
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={`${detail.createdBy} · ${new Date(detail.createdAt).toLocaleString()}`} />
            <SidebarKV label="Contract start" value={dateOnly(detail.contractStart)} mono />
            <SidebarKV label="Contract end" value={dateOnly(detail.contractEnd)} mono />
          </SidebarGroup>
        </aside>
      </div>

      {dialog === 'UPGRADE' && (
        <ReasonDialog
          title="Upgrade to MATERIAL"
          hint="Materiality can only be raised, never lowered. A material provider then needs a CISO assessment, goes through CFO and senior-management approval, and must be notified to VARA before it goes live."
          confirmLabel="Upgrade"
          busy={dialogBusy}
          error={dialogError}
          onCancel={closeDialog}
          onConfirm={(reason) => void submitDialog(reason)}
        />
      )}
      {dialog === 'TERMINATE' && (
        <ReasonDialog
          title="Terminate service provider"
          hint={`${detail.vendorNo} · ${detail.name} — termination is final, there is no path back to Active.${isMaterial ? ' Terminating a material provider also opens a VARA notification in Regulatory Filings; it does not hold up the termination.' : ''}`}
          confirmLabel="Confirm termination"
          danger
          optional
          busy={dialogBusy}
          error={dialogError}
          onCancel={closeDialog}
          onConfirm={(notes) => void submitDialog(notes)}
        />
      )}
    </div>
  );
};

export default ServiceProviderDetailPage;
