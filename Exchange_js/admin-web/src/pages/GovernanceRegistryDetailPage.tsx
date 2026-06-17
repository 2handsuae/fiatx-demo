import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileJson, Link2, Pencil, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import {
  DetailCard,
  InfoField,
  JsonBlock,
  StatusBadge,
} from '../components/governance/GovernanceUi';
import { formatDateTime } from '../components/governance/governanceUtils';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  getRegistryConfig,
  getRegistryEditPath,
  type RegistryType,
} from './governanceRegistryConfig';

type RegulatoryGateSummary = {
  gateId: string;
  gateNo: string;
  gateType: string;
  gateResult: string;
  filingStatus: string;
  receiptStatus: string;
  effectivenessStatus: string;
};

type RegistryDetail = {
  id: string;
  status: string;
  registryNo?: string | null;
  versionLabel?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  supersededById?: string | null;
  latestApprovalId?: string | null;
  latestApprovalStatus?: string | null;
  evidenceRef?: string | null;
  appointmentNo?: string | null;
  roleType?: string | null;
  personName?: string | null;
  regulatedFlag?: boolean | null;
  proposedEffectiveAt?: string | null;
  effectiveAt?: string | null;
  endedAt?: string | null;
  trainingNo?: string | null;
  assignee?: string | null;
  trainingType?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  waiverReason?: string | null;
  disclosureNo?: string | null;
  disclosureType?: string | null;
  disclosedByName?: string | null;
  disclosedAt?: string | null;
  reviewDueAt?: string | null;
  mitigationSummary?: string | null;
  closedAt?: string | null;
  materialNo?: string | null;
  materialType?: string | null;
  supersededAt?: string | null;
  traceId?: string | null;
  metadataJson?: Record<string, unknown>;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  subjectNo?: string | null;
  regulatoryGateSummary?: RegulatoryGateSummary | null;
  participants?: Array<Record<string, unknown>>;
};

const GovernanceRegistryDetailPage = ({ registryType }: { registryType: RegistryType }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const config = useMemo(() => getRegistryConfig(registryType), [registryType]);
  const [detail, setDetail] = useState<RegistryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) {
      setError(`${config.numberLabel} id is required.`);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/registries/${config.endpoint}/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to load ${config.detailTitle}.`));
      }

      const result = (await response.json()) as RegistryDetail;
      setDetail(result);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : `Failed to load ${config.detailTitle}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, registryType]);

  const canEdit = hasAnyPermission([config.updatePermission]);
  const canReadGate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_DETAIL_READ]);
  const canCreateGate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_CREATE]);

  const buildGateCreatePath = () => {
    if (!detail || !config.gateType) return '';
    const params = new URLSearchParams({
      gateType: config.gateType,
      subjectType: String(detail.subjectType || ''),
      subjectId: String(detail.subjectId || ''),
      subjectNo: String(detail.subjectNo || ''),
    });
    return `/admin/registries/regulatory-gates/create?${params.toString()}`;
  };

  const renderPrimaryFields = () => {
    if (!detail) return null;

    switch (registryType) {
      case 'shareholding-versions':
        return (
          <>
            <InfoField label="Registry No" value={detail.registryNo} mono />
            <InfoField label="Version Label" value={detail.versionLabel} />
            <InfoField label="Status" value={<StatusBadge value={String(detail.status || '')} />} />
            <InfoField label="Effective From" value={formatDateTime(detail.effectiveFrom as string | null)} />
            <InfoField label="Effective To" value={formatDateTime(detail.effectiveTo as string | null)} />
            <InfoField label="Superseded By" value={detail.supersededById} mono />
            <InfoField label="Latest Approval Id" value={detail.latestApprovalId} mono />
            <InfoField label="Latest Approval Status" value={detail.latestApprovalStatus} />
            <InfoField label="Evidence Ref" value={detail.evidenceRef} />
          </>
        );
      case 'appointments':
        return (
          <>
            <InfoField label="Appointment No" value={detail.appointmentNo} mono />
            <InfoField label="Role Type" value={detail.roleType} />
            <InfoField label="Person Name" value={detail.personName} />
            <InfoField label="Regulated" value={detail.regulatedFlag} />
            <InfoField label="Status" value={<StatusBadge value={String(detail.status || '')} />} />
            <InfoField
              label="Proposed Effective At"
              value={formatDateTime(detail.proposedEffectiveAt as string | null)}
            />
            <InfoField label="Effective At" value={formatDateTime(detail.effectiveAt as string | null)} />
            <InfoField label="Ended At" value={formatDateTime(detail.endedAt as string | null)} />
            <InfoField label="Latest Approval Id" value={detail.latestApprovalId} mono />
            <InfoField label="Latest Approval Status" value={detail.latestApprovalStatus} />
            <InfoField label="Evidence Ref" value={detail.evidenceRef} />
          </>
        );
      case 'trainings':
        return (
          <>
            <InfoField label="Training No" value={detail.trainingNo} mono />
            <InfoField label="Assignee" value={detail.assignee} />
            <InfoField label="Training Type" value={detail.trainingType} />
            <InfoField label="Status" value={<StatusBadge value={String(detail.status || '')} />} />
            <InfoField label="Due At" value={formatDateTime(detail.dueAt as string | null)} />
            <InfoField label="Completed At" value={formatDateTime(detail.completedAt as string | null)} />
            <InfoField label="Evidence Ref" value={detail.evidenceRef} />
            <InfoField label="Waiver Reason" value={detail.waiverReason} />
          </>
        );
      case 'conflicts':
        return (
          <>
            <InfoField label="Disclosure No" value={detail.disclosureNo} mono />
            <InfoField label="Disclosure Type" value={detail.disclosureType} />
            <InfoField label="Disclosed By" value={detail.disclosedByName} />
            <InfoField label="Status" value={<StatusBadge value={String(detail.status || '')} />} />
            <InfoField label="Disclosed At" value={formatDateTime(detail.disclosedAt as string | null)} />
            <InfoField label="Review Due At" value={formatDateTime(detail.reviewDueAt as string | null)} />
            <InfoField label="Mitigation Summary" value={detail.mitigationSummary} />
            <InfoField label="Closed At" value={formatDateTime(detail.closedAt as string | null)} />
            <InfoField label="Evidence Ref" value={detail.evidenceRef} />
          </>
        );
      case 'wind-down-materials':
        return (
          <>
            <InfoField label="Material No" value={detail.materialNo} mono />
            <InfoField label="Material Type" value={detail.materialType} />
            <InfoField label="Version Label" value={detail.versionLabel} />
            <InfoField label="Status" value={<StatusBadge value={String(detail.status || '')} />} />
            <InfoField label="Effective At" value={formatDateTime(detail.effectiveAt as string | null)} />
            <InfoField label="Review Due At" value={formatDateTime(detail.reviewDueAt as string | null)} />
            <InfoField label="Superseded At" value={formatDateTime(detail.supersededAt as string | null)} />
            <InfoField label="Superseded By" value={detail.supersededById} mono />
            <InfoField label="Evidence Ref" value={detail.evidenceRef} />
          </>
        );
      default:
        return null;
    }
  };

  const renderParticipantsCard = () => {
    if (registryType !== 'shareholding-versions' || !detail) return null;
    const participants = Array.isArray(detail.participants) ? detail.participants : [];
    return (
      <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="text-brand-primary">
            <Users size={18} />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Participants</h2>
        </div>
        {participants.length === 0 ? (
          <div className="rounded-lg border border-dashed border-admin-border px-4 py-8 text-center text-sm text-gray-500">
            No participants recorded.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-admin-border bg-admin-content-bg">
                <tr>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Type</th>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Name</th>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Ownership</th>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Control Summary</th>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Evidence Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border">
                {participants.map((participant, index) => (
                  <tr key={String(participant.id || index)} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-700">{String(participant.participantType || '-')}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{String(participant.participantName || '-')}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{String(participant.ownershipPercent || '-')}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{String(participant.controlSummary || '-')}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{String(participant.evidenceRef || '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderGateSummaryCard = () => {
    if (!detail?.regulatoryGateSummary) return null;
    const gate = detail.regulatoryGateSummary;
    return (
      <DetailCard title="Linked Regulatory Gate" icon={<ShieldCheck size={18} />} columns={3}>
        <InfoField label="Gate No" value={gate.gateNo} mono />
        <InfoField label="Gate Type" value={gate.gateType} />
        <InfoField label="Gate Result" value={<StatusBadge value={gate.gateResult} />} />
        <InfoField label="Filing Status" value={<StatusBadge value={gate.filingStatus} />} />
        <InfoField label="Receipt Status" value={<StatusBadge value={gate.receiptStatus} />} />
        <InfoField
          label="Effectiveness Status"
          value={<StatusBadge value={gate.effectivenessStatus} />}
        />
        <div className="md:col-span-2 xl:col-span-3">
          {canReadGate ? (
            <button
              onClick={() => navigate(`/admin/registries/regulatory-gates/${gate.gateId}`)}
              className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-brand-primary hover:bg-gray-50"
            >
              <Link2 size={16} />
              Open Linked Gate
            </button>
          ) : null}
        </div>
      </DetailCard>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <RefreshCw size={28} className="animate-spin text-brand-primary" />
        <p className="text-sm text-gray-500">Loading registry detail...</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/admin/registries/${config.endpoint}`)}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back to List
          </button>
          <button
            onClick={() => void fetchDetail()}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate(`/admin/registries/${config.endpoint}`)}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft size={16} />
          Back to List
        </button>
        <div className="rounded-xl border border-admin-border bg-white px-6 py-10 text-center text-sm text-gray-500 shadow-sm">
          Registry detail not found.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 rounded-xl border border-admin-border bg-white p-6 shadow-sm md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate(`/admin/registries/${config.endpoint}`)}
            className="mt-1 inline-flex items-center justify-center rounded-lg border border-admin-border p-2 text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{config.detailTitle}</h1>
              <StatusBadge value={String(detail.status || '')} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
              <span className="font-mono text-brand-primary">
                {String(detail[config.numberField as keyof RegistryDetail] || '-')}
              </span>
              <span>{String(detail.subjectType || '-')}</span>
              <span>{String(detail.subjectNo || '-')}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canEdit && id ? (
            <button
              onClick={() => navigate(getRegistryEditPath(registryType, id))}
              className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Pencil size={16} />
              Edit
            </button>
          ) : null}
          {!detail.regulatoryGateSummary &&
          config.gateType &&
          canCreateGate &&
          ((registryType === 'shareholding-versions') ||
            (registryType === 'appointments' && detail.regulatedFlag)) ? (
            <button
              onClick={() => navigate(buildGateCreatePath())}
              className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-brand-primary hover:bg-gray-50"
            >
              <Plus size={16} />
              Create Regulatory Gate
            </button>
          ) : null}
          {detail.regulatoryGateSummary && canReadGate ? (
            <button
              onClick={() =>
                navigate(`/admin/registries/regulatory-gates/${detail.regulatoryGateSummary?.gateId}`)
              }
              className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-brand-primary hover:bg-gray-50"
            >
              <Link2 size={16} />
              View Gate
            </button>
          ) : null}
          <button
            onClick={() => void fetchDetail()}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <DetailCard title="Registry Snapshot" icon={<ShieldCheck size={18} />} columns={3}>
        {renderPrimaryFields()}
        <InfoField label="Trace ID" value={detail.traceId} mono />
        <InfoField label="Created By" value={detail.createdByUserId} mono />
        <InfoField label="Updated By" value={detail.updatedByUserId} mono />
        <InfoField label="Created At" value={formatDateTime(detail.createdAt as string | null)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt as string | null)} />
      </DetailCard>

      {renderGateSummaryCard()}
      {renderParticipantsCard()}

      <DetailCard title="Metadata JSON" icon={<FileJson size={18} />} columns={1}>
        <JsonBlock title="metadataJson" value={detail.metadataJson || {}} />
      </DetailCard>
    </div>
  );
};

export default GovernanceRegistryDetailPage;
