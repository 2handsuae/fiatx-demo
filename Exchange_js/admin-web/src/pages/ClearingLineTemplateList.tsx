import { useEffect, useState } from 'react';
import { RefreshCw, Plus, ArrowLeft } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BUSINESS_CONFIG_RELEASES_PATH,
  showBusinessConfigReadOnlyAlert,
} from '../utils/businessConfigReadOnly';
import { adminFetch } from '../utils/adminFetch';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';

interface ClearingLineTemplateItem {
  id: string;
  clearingTemplateId: string;
  lineNo: number;
  lineType: string;
  partyType: string;
  partyIdSource: string | null;
  assetSource: string;
  amountSource: string;
  memoTemplate: string | null;
  isEnabled: boolean;
}

const ClearingLineTemplateList = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('templateId');

  const [items, setItems] = useState<ClearingLineTemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  
  const fetchItems = async () => {
    if (!templateId) return;
    setLoading(true);
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/clearing-templates/${templateId}`);
      if (response.ok) {
        const result = await response.json();
        setItems(result.lineTemplates || []);
      }
    } catch (error) {
      console.error('Failed to fetch clearing line templates', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [templateId]);

  if (!templateId) {
      return (
          <div className="p-8 text-center">
              <p className="text-gray-500 mb-4">Please select a Clearing Header Template first.</p>
              <button 
                onClick={() => navigate('/dashboard/system/clearing-header-templates')}
                className={adminButtonClass('listPrimary')}
              >
                  Go to Header Templates
              </button>
          </div>
      );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button onClick={() => navigate('/dashboard/system/clearing-header-templates')} className="p-1 hover:bg-gray-100 rounded-full">
                <ArrowLeft size={20} className="text-gray-500" />
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Clearing Line Templates</h1>
          </div>
          <p className="text-sm text-gray-500 ml-8">Configure clearing distribution lines for template ID: {templateId}</p>
        </div>
        <button 
            onClick={() => navigate(BUSINESS_CONFIG_RELEASES_PATH)}
            className={adminButtonClass('listSecondary')}
        >
            <Plus size={20} />
            <span>Open Release Center</span>
        </button>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Clearing line templates are bundled into release-managed header revisions. This page is read-only for line inspection.
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex justify-end">
            <button onClick={fetchItems} className={adminIconButtonClass()}>
                <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider w-16">No.</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Line Type</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Party</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Amount Source</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset Source</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Memo Template</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading lines...
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    No lines found for this template
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4 font-mono text-gray-500">{item.lineNo}</td>
                    <td className="px-4 py-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold 
                            ${item.lineType === 'FEE' ? 'bg-orange-100 text-orange-700' : 
                              item.lineType === 'INCOMING' ? 'bg-green-100 text-green-700' : 
                              item.lineType === 'OUTGOING' ? 'bg-blue-100 text-blue-700' : 
                              'bg-gray-100 text-gray-700'}`}>
                            {item.lineType}
                        </span>
                    </td>
                    <td className="px-4 py-4">
                        <div className="font-bold text-gray-800">{item.partyType}</div>
                        <div className="text-[10px] text-gray-400 font-mono">{item.partyIdSource || '-'}</div>
                    </td>
                    <td className="px-4 py-4 text-xs font-mono text-blue-600">{item.amountSource}</td>
                    <td className="px-4 py-4 text-xs font-mono text-gray-600">{item.assetSource}</td>
                    <td className="px-4 py-4 text-xs text-gray-500">{item.memoTemplate || '-'}</td>
                    <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${item.isEnabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.isEnabled ? 'ENABLED' : 'DISABLED'}
                        </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-3 items-center">
                        <button 
                            className={adminButtonClass('rowSecondaryUtility')}
                            onClick={() => showBusinessConfigReadOnlyAlert('Clearing templates')}
                        >
                            Read-only
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ClearingLineTemplateList;
