import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface EvidenceExportItem {
  id: string;
  packageNo: string;
  approvalCaseId?: string | null;
  status: string;
  exportMode: string;
  fileName?: string | null;
  itemCount: number;
  digest?: string | null;
  exportedByType: string;
  exportedById: string;
  exportedByRole?: string | null;
  approvalCase?: {
    id: string;
    status: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface EvidenceExportListResponse {
  total: number;
  skip: number;
  take: number;
  items: EvidenceExportItem[];
}

interface DownloadResponse {
  id: string;
  packageNo: string;
  fileName: string;
  digest: string;
  content: unknown;
}

const PAGE_SIZE = 20;

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const EvidenceExportsPage = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<EvidenceExportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchExports = async (page: number) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/audit-logs/evidence-packages?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load evidence exports.'));
      }

      const data = (await response.json()) as EvidenceExportListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load evidence exports.');
    } finally {
      setLoading(false);
    }
  };

  const downloadPackage = async (id: string) => {
    setDownloading(id);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/audit-logs/evidence-packages/${id}/download`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to download evidence package.'));
      }

      const data = (await response.json()) as DownloadResponse;
      const content = JSON.stringify(data.content, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = data.fileName || `${data.packageNo}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);

      setMessage(`Downloaded ${data.packageNo}. Digest: ${data.digest}`);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to download evidence package.');
    } finally {
      setDownloading(null);
    }
  };

  useEffect(() => {
    void fetchExports(1);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Center - Evidence Export</h1>
          <p className="mt-1 text-sm text-gray-500">
            Download persisted evidence packages generated from the Audit Log selection flow.
          </p>
        </div>
        <button
          onClick={() => void fetchExports(currentPage)}
          className="p-2 text-gray-500 hover:text-brand-primary"
          title="Refresh"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-admin-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Package No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Mode</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Created At</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Exporter</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Items</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Digest</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Operation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No evidence exports found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/dashboard/audit/evidence-exports/${item.id}`)}
                        className="font-mono text-xs text-brand-primary hover:underline"
                      >
                        {item.packageNo}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{item.status}</div>
                      {item.approvalCase && (
                        <div className="text-xs text-gray-500">
                          Approval {item.approvalCase.status}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.exportMode}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDateTime(item.createdAt)}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="font-medium text-gray-900">{item.exportedById}</div>
                      <div className="text-xs text-gray-500">{item.exportedByRole || item.exportedByType}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.itemCount}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {item.digest || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => navigate(`/dashboard/audit/evidence-exports/${item.id}`)}
                          className="text-sm font-medium text-brand-primary hover:underline"
                        >
                          View
                        </button>
                        <button
                          onClick={() => void downloadPackage(item.id)}
                          disabled={item.status !== 'READY' || downloading === item.id}
                          className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
                        >
                          <Download size={14} />
                          {downloading === item.id
                            ? 'Downloading...'
                            : item.status === 'READY'
                              ? 'Download'
                              : 'Waiting Approval'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-admin-border px-4 py-4">
          <Pagination
            currentPage={currentPage}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={(page) => void fetchExports(page)}
          />
        </div>
      </div>
    </div>
  );
};

export default EvidenceExportsPage;
