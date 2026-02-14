import { useEffect, useState } from 'react';
import { Search, Filter, MoreVertical, RefreshCw } from 'lucide-react';

interface Member {
  id: string;
  userNo: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
}

const PlatformMembers = () => {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/users`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setMembers(data);
      }
    } catch (error) {
      console.error('Failed to fetch members', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Platform Members</h1>
        <button onClick={fetchMembers} className="p-2 text-gray-500 hover:text-brand-primary transition-colors">
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
            <input 
              type="text" 
              placeholder="Search by email..." 
              className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 border border-admin-border rounded-lg hover:bg-admin-content-bg text-gray-600 text-sm font-medium transition-colors duration-200">
            <Filter size={18} /> Filter
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Last Login</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">Loading members...</td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">No members found</td>
                </tr>
              ) : (
                members.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{member.email}</div>
                        <div className="flex gap-2 text-[10px] font-mono">
                            <span className="text-brand-primary font-bold">No: {member.userNo || '-'}</span>
                            <span className="text-gray-400">ID: {member.id.substring(0, 8)}...</span>
                        </div>
                    </td>
                    <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        member.role === 'SUPER_ADMIN' ? 'bg-purple-100 text-purple-800' : 
                        member.role === 'ADMIN' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                        {member.role.replace('_', ' ')}
                        </span>
                    </td>
                    <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        member.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                        {member.status}
                        </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                        {new Date(member.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                        {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : '-'}
                    </td>
                    <td className="px-6 py-4 text-right">
                        <button className="text-gray-400 hover:text-gray-600">
                        <MoreVertical size={18} />
                        </button>
                    </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        <div className="p-4 border-t border-admin-border bg-admin-content-bg text-xs text-gray-500 flex justify-between items-center">
            <span>Showing {members.length} records</span>
            <div className="flex gap-2">
                <button className="px-3 py-1 border border-admin-border rounded bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors" disabled>Previous</button>
                <button className="px-3 py-1 border border-admin-border rounded bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors" disabled>Next</button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default PlatformMembers;
