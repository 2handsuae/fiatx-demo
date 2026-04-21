import { useEffect, useMemo, useState } from 'react';
import { Link2, Plus, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/governance/GovernanceUi';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

type ReleaseItem = {
  businessKey: string;
  sortOrder: number;
  revisionId: string;
  revisionNo: number;
  revisionStatus: string;
  payload: Record<string, unknown>;
};

type ReleaseSummary = {
  id: string;
  subjectType: string;
  releaseNo: string;
  status: string;
  basedOnReleaseNo: string | null;
  changeTicketId: string | null;
  approvalCaseId: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  itemCount?: number;
};

type ReleaseDetail = ReleaseSummary & {
  validationSummary: Record<string, unknown>;
  items: ReleaseItem[];
  regulatoryGateSummary?: {
    gateId: string;
    gateNo: string;
    gateType: string;
    gateResult: string;
    filingStatus: string;
    receiptStatus: string;
    effectivenessStatus: string;
  } | null;
};

type DiffItem = {
  businessKey: string;
  action: 'ADDED' | 'CHANGED' | 'REMOVED' | 'UNCHANGED';
  fromRevisionNo: number | null;
  toRevisionNo: number | null;
};

type RevisionItem = {
  id: string;
  subjectType: string;
  businessKey: string;
  revisionNo: number;
  status: string;
  changeSummary: string | null;
  sourceCommitSha: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

const SUBJECT_OPTIONS = [
  '',
  'COA',
  'ACCT_EVENT',
  'JOURNAL_TEMPLATE',
  'CLEARING_TEMPLATE',
  'PRICING_POLICY',
  'ASSET_CONFIG',
];

const STATUS_OPTIONS = ['', 'ACTIVE', 'VALIDATED', 'DRAFT', 'SUPERSEDED'];

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);

const BusinessConfigReleasesPage = () => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [subjectType, setSubjectType] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [selectedReleaseNo, setSelectedReleaseNo] = useState<string | null>(null);
  const [releaseDetail, setReleaseDetail] = useState<ReleaseDetail | null>(null);
  const [releaseDiff, setReleaseDiff] = useState<DiffItem[]>([]);
  const [selectedBusinessKey, setSelectedBusinessKey] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<RevisionItem[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<RevisionItem | null>(null);

  const currentReleaseNo = useMemo(
    () => releases.find((item) => item.status === 'ACTIVE')?.releaseNo || null,
    [releases],
  );
  const canReadGate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_DETAIL_READ]);
  const canCreateGate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_CREATE]);

  const fetchReleases = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (subjectType) params.set('subjectType', subjectType);
      if (status) params.set('status', status);
      params.set('take', '100');

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load releases.'));
      }

      const payload = await response.json();
      const items = Array.isArray(payload.items) ? payload.items : [];
      setReleases(items);

      const nextReleaseNo =
        selectedReleaseNo && items.some((item: ReleaseSummary) => item.releaseNo === selectedReleaseNo)
          ? selectedReleaseNo
          : items[0]?.releaseNo || null;
      setSelectedReleaseNo(nextReleaseNo);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load releases.');
      setReleases([]);
      setSelectedReleaseNo(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchReleaseDetail = async (releaseNo: string) => {
    try {
      const [detailResponse, diffResponse] = await Promise.all([
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/business-config/releases/${releaseNo}`),
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/business-config/releases/${releaseNo}/diff`),
      ]);

      if (!detailResponse.ok) {
        throw new Error(await getApiErrorMessage(detailResponse, 'Failed to load release detail.'));
      }
      if (!diffResponse.ok) {
        throw new Error(await getApiErrorMessage(diffResponse, 'Failed to load release diff.'));
      }

      const detailPayload = (await detailResponse.json()) as ReleaseDetail;
      const diffPayload = await diffResponse.json();
      setReleaseDetail(detailPayload);
      setReleaseDiff(Array.isArray(diffPayload.items) ? diffPayload.items : []);
      const firstKey = detailPayload.items?.[0]?.businessKey || null;
      setSelectedBusinessKey(firstKey);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load release detail.');
      setReleaseDetail(null);
      setReleaseDiff([]);
      setSelectedBusinessKey(null);
    }
  };

  const fetchRevisionHistory = async (nextSubjectType: string, businessKey: string) => {
    try {
      const params = new URLSearchParams({
        subjectType: nextSubjectType,
        businessKey,
        take: '50',
      });
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/revisions?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load revision history.'));
      }
      const payload = await response.json();
      const items = Array.isArray(payload.items) ? payload.items : [];
      setRevisions(items);
      setSelectedRevision(items[0] || null);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load revision history.');
      setRevisions([]);
      setSelectedRevision(null);
    }
  };

  const fetchRevisionDetail = async (revisionId: string) => {
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/revisions/${revisionId}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load revision detail.'));
      }
      setSelectedRevision((await response.json()) as RevisionItem);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load revision detail.');
    }
  };

  useEffect(() => {
    void fetchReleases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectType, status]);

  useEffect(() => {
    if (!selectedReleaseNo) {
      setReleaseDetail(null);
      setReleaseDiff([]);
      setSelectedBusinessKey(null);
      return;
    }
    void fetchReleaseDetail(selectedReleaseNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReleaseNo]);

  useEffect(() => {
    if (!releaseDetail || !selectedBusinessKey) {
      setRevisions([]);
      setSelectedRevision(null);
      return;
    }
    void fetchRevisionHistory(releaseDetail.subjectType, selectedBusinessKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseDetail, selectedBusinessKey]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Config Releases</h1>
          <p className="mt-1 text-sm text-gray-500">
            Read-only release center for current config, as-of-release snapshot, revision detail, and diff.
          </p>
        </div>
        <button
          onClick={() => void fetchReleases()}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        This is the Phase 2 read-only governance view. Config authoring and release operations run
        through the repo and `config:release:*` commands instead of direct admin edits.
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-admin-border bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-3">
              <select
                value={subjectType}
                onChange={(e) => setSubjectType(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                {SUBJECT_OPTIONS.map((item) => (
                  <option key={item || 'ALL'} value={item}>
                    {item || 'All Subjects'}
                  </option>
                ))}
              </select>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                {STATUS_OPTIONS.map((item) => (
                  <option key={item || 'ALL'} value={item}>
                    {item || 'All Statuses'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-admin-border bg-white shadow-sm overflow-hidden">
            <div className="border-b border-admin-border px-4 py-3">
              <div className="text-sm font-semibold text-gray-900">Release List</div>
              <div className="mt-1 text-xs text-gray-500">
                Current active release: {currentReleaseNo || '-'}
              </div>
            </div>
            <div className="max-h-[720px] overflow-auto">
              {releases.length === 0 ? (
                <div className="px-4 py-8 text-sm text-gray-500">No releases found.</div>
              ) : (
                releases.map((release) => {
                  const selected = selectedReleaseNo === release.releaseNo;
                  return (
                    <button
                      key={release.releaseNo}
                      onClick={() => setSelectedReleaseNo(release.releaseNo)}
                      className={`w-full border-b border-admin-border px-4 py-3 text-left hover:bg-gray-50 ${
                        selected ? 'bg-brand-primary/5' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-mono text-xs text-brand-primary">
                          {release.releaseNo}
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            release.status === 'ACTIVE'
                              ? 'bg-green-100 text-green-700'
                              : release.status === 'VALIDATED'
                                ? 'bg-blue-100 text-blue-700'
                                : release.status === 'SUPERSEDED'
                                  ? 'bg-gray-100 text-gray-700'
                                  : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {release.status}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-medium text-gray-900">
                        {release.subjectType}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        based on {release.basedOnReleaseNo || '-'} · items {release.itemCount ?? '-'}
                      </div>
                      <div className="mt-1 text-xs text-gray-400">
                        {formatDateTime(release.publishedAt || release.createdAt)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {!releaseDetail ? (
            <div className="rounded-xl border border-admin-border bg-white px-4 py-8 text-sm text-gray-500 shadow-sm">
              Select a release to inspect current snapshot, diff, and revision history.
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-admin-border bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-mono text-xs text-brand-primary">{releaseDetail.releaseNo}</div>
                    <h2 className="text-lg font-semibold text-gray-900">{releaseDetail.subjectType}</h2>
                  </div>
                  <div className="text-sm text-gray-500">
                    {releaseDetail.status} · published {formatDateTime(releaseDetail.publishedAt)}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-sm">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Based On</div>
                    <div className="mt-1 font-mono text-xs text-gray-800">
                      {releaseDetail.basedOnReleaseNo || '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-sm">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Change Ticket</div>
                    <div className="mt-1 font-mono text-xs text-gray-800">
                      {releaseDetail.changeTicketId || '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-sm">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Approval</div>
                    <div className="mt-1 font-mono text-xs text-gray-800">
                      {releaseDetail.approvalCaseId || '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-sm">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Validation</div>
                    <div className="mt-1 text-xs text-gray-800">
                      {String((releaseDetail.validationSummary?.ok as boolean | undefined) ?? false)
                        .toUpperCase()}
                    </div>
                  </div>
                </div>
                {releaseDetail.regulatoryGateSummary ? (
                  <div className="mt-4 rounded-xl border border-admin-border bg-gray-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-1">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Regulatory Gate</div>
                        <div className="font-mono text-xs text-brand-primary">
                          {releaseDetail.regulatoryGateSummary.gateNo}
                        </div>
                        <div className="text-sm text-gray-700">
                          {releaseDetail.regulatoryGateSummary.gateType}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={releaseDetail.regulatoryGateSummary.gateResult} />
                        {canReadGate ? (
                          <button
                            onClick={() =>
                              navigate(
                                `/dashboard/governance/regulatory-gates/${releaseDetail.regulatoryGateSummary?.gateId}`,
                              )
                            }
                            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-brand-primary hover:bg-gray-50"
                          >
                            <Link2 size={16} />
                            View Gate
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : canCreateGate ? (
                  <div className="mt-4 rounded-xl border border-dashed border-admin-border bg-gray-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          No regulatory gate linked
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Create a `LICENSE_SCOPE_CHANGE` gate before publish/activation when required.
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const params = new URLSearchParams({
                            gateType: 'LICENSE_SCOPE_CHANGE',
                            subjectType: 'BUSINESS_CONFIG_RELEASE',
                            subjectId: releaseDetail.id,
                            subjectNo: releaseDetail.releaseNo,
                          });
                          navigate(
                            `/dashboard/governance/regulatory-gates/create?${params.toString()}`,
                          );
                        }}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90"
                      >
                        <Plus size={16} />
                        Create Regulatory Gate
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                  <div className="rounded-xl border border-admin-border bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-admin-border px-4 py-3 text-sm font-semibold text-gray-900">
                      As-Of-Release Snapshot
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-admin-content-bg border-b border-admin-border">
                          <tr>
                            <th className="px-4 py-3 text-xs uppercase text-gray-500">Business Key</th>
                            <th className="px-4 py-3 text-xs uppercase text-gray-500">Revision</th>
                            <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-admin-border">
                          {releaseDetail.items.map((item) => (
                            <tr
                              key={`${item.businessKey}-${item.revisionNo}`}
                              className={`cursor-pointer hover:bg-gray-50 ${
                                selectedBusinessKey === item.businessKey ? 'bg-brand-primary/5' : ''
                              }`}
                              onClick={() => setSelectedBusinessKey(item.businessKey)}
                            >
                              <td className="px-4 py-3 font-mono text-xs text-brand-primary">
                                {item.businessKey}
                              </td>
                              <td className="px-4 py-3 text-gray-700">r{item.revisionNo}</td>
                              <td className="px-4 py-3 text-gray-700">{item.revisionStatus}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-xl border border-admin-border bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-admin-border px-4 py-3 text-sm font-semibold text-gray-900">
                      Release Diff
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-admin-content-bg border-b border-admin-border">
                          <tr>
                            <th className="px-4 py-3 text-xs uppercase text-gray-500">Business Key</th>
                            <th className="px-4 py-3 text-xs uppercase text-gray-500">Action</th>
                            <th className="px-4 py-3 text-xs uppercase text-gray-500">From</th>
                            <th className="px-4 py-3 text-xs uppercase text-gray-500">To</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-admin-border">
                          {releaseDiff.map((item) => (
                            <tr key={`diff-${item.businessKey}`}>
                              <td className="px-4 py-3 font-mono text-xs text-gray-700">{item.businessKey}</td>
                              <td className="px-4 py-3 text-gray-700">{item.action}</td>
                              <td className="px-4 py-3 text-gray-700">
                                {item.fromRevisionNo === null ? '-' : `r${item.fromRevisionNo}`}
                              </td>
                              <td className="px-4 py-3 text-gray-700">
                                {item.toRevisionNo === null ? '-' : `r${item.toRevisionNo}`}
                              </td>
                            </tr>
                          ))}
                          {releaseDiff.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                                No diff available.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-admin-border bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-admin-border px-4 py-3 text-sm font-semibold text-gray-900">
                      Revision History
                      {selectedBusinessKey ? ` · ${selectedBusinessKey}` : ''}
                    </div>
                    <div className="max-h-[320px] overflow-auto">
                      {revisions.length === 0 ? (
                        <div className="px-4 py-6 text-sm text-gray-500">No revision history.</div>
                      ) : (
                        revisions.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => void fetchRevisionDetail(item.id)}
                            className={`w-full border-b border-admin-border px-4 py-3 text-left hover:bg-gray-50 ${
                              selectedRevision?.id === item.id ? 'bg-brand-primary/5' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-mono text-xs text-brand-primary">r{item.revisionNo}</div>
                              <div className="text-[10px] text-gray-500">{item.status}</div>
                            </div>
                            <div className="mt-1 text-xs text-gray-600">
                              {item.changeSummary || 'No change summary'}
                            </div>
                            <div className="mt-1 text-[10px] text-gray-400">
                              {formatDateTime(item.createdAt)}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-admin-border bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-admin-border px-4 py-3 text-sm font-semibold text-gray-900">
                      Revision Detail
                    </div>
                    <div className="space-y-3 p-4">
                      {!selectedRevision ? (
                        <div className="text-sm text-gray-500">Select a revision to inspect payload.</div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 gap-3">
                            <div className="rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-sm">
                              <div className="text-xs uppercase tracking-wide text-gray-500">Revision</div>
                              <div className="mt-1 font-mono text-xs text-gray-800">
                                {selectedRevision.businessKey} · r{selectedRevision.revisionNo}
                              </div>
                            </div>
                            <div className="rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-sm">
                              <div className="text-xs uppercase tracking-wide text-gray-500">Source Commit</div>
                              <div className="mt-1 font-mono text-xs text-gray-800">
                                {selectedRevision.sourceCommitSha || '-'}
                              </div>
                            </div>
                          </div>
                          <pre className="max-h-[360px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
                            {prettyJson(selectedRevision.payload)}
                          </pre>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusinessConfigReleasesPage;
