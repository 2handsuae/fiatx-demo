import React, { useEffect, useState } from 'react';
import { 
  RefreshCw, 
  Plus, 
  Edit2, 
  Trash2, 
  ArrowLeft
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

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
      const token = localStorage.getItem('admin_token');
      // The backend findOne returns header + lines
      const response = await fetch(`${import.meta.env.VITE_API_URL}/clearing-templates/${templateId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
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

  const handleDelete = async (id: string) => {
      if (!window.confirm('Are you sure you want to delete this line?')) return;
      alert('Delete logic not implemented in backend yet');
  };

  if (!templateId) {
      return (
          <div className="p-8 text-center">
              <p className="text-gray-500 mb-4">Please select a Clearing Header Template first.</p>
              <button 
                onClick={() => navigate('/dashboard/system/clearing-header-templates')}
                className="px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors"
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
            onClick={() => alert('Create functionality coming next...')} 
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors"
        >
            <Plus size={20} />
            <span>Add Line Rule</span>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex justify-end">
            <button onClick={fetchItems} className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white">
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
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
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
                      <div className="flex justify-end gap-2 items-center">
                        <button 
                            className="p-1.5 text-gray-500 hover:text-brand-primary rounded hover:bg-gray-100 transition-colors"
                            onClick={() => alert('Edit coming soon')}
                            title="Edit"
                        >
                            <Edit2 size={16} />
                        </button>
                        <button 
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-gray-100 transition-colors"
                            onClick={() => handleDelete(item.id)}
                            title="Delete"
                        >
                            <Trash2 size={16} />
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
