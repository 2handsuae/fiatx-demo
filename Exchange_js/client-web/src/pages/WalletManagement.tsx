import { useState, useEffect } from 'react';
import { Plus, Wallet, Building2, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface WalletItem {
  id: string;
  type: string;
  asset: { code: string; type: string };
  address?: string;
  memo?: string;
  bankName?: string;
  bankAccount?: string;
  iban?: string;
  accountName?: string;
  status: string;
}

interface Asset {
  id: string;
  code: string;
  type: string;
  network: string | null;
}

const WalletManagement = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'crypto' | 'fiat'>('crypto');
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Create Form State
  const [assets, setAssets] = useState<Asset[]>([]);
  const [formData, setFormData] = useState({
    assetId: '',
    // Crypto
    beneficiaryName: '',
    counterpartyVasp: '',
    address: '',
    memo: '',
    // Fiat
    accountName: '',
    bankName: '',
    bankAccount: '',
    iban: '',
    bankCode: '',
  });
  const [creating, setCreating] = useState(false);

  const fetchWallets = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('customer_token');
      // Fetch wallets and filter by direction='OUTBOUND'
      const response = await fetch(`${import.meta.env.VITE_API_URL}/wallets?ownerType=CUSTOMER&ownerId=${user?.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        // Filter strictly for OUTBOUND wallets
        const outboundWallets = (data.items || []).filter((w: any) => w.direction === 'OUTBOUND');
        setWallets(outboundWallets);
      }
    } catch (error) {
      console.error('Failed to fetch wallets', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAssets = async () => {
    try {
      const token = localStorage.getItem('customer_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAssets(data.items || []);
      }
    } catch (error) {
      console.error('Failed to fetch assets', error);
    }
  };

  useEffect(() => {
    if (user) {
      fetchWallets();
      fetchAssets();
    }
  }, [user]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const token = localStorage.getItem('customer_token');
      const payload = {
        ownerType: 'CUSTOMER',
        ownerId: user?.id,
        direction: 'OUTBOUND', // As per requirements for withdrawal wallets
        type: activeTab === 'crypto' ? 'CRYPTO_ADDRESS' : 'FIAT_BANK',
        assetId: formData.assetId,
        ...(activeTab === 'crypto' ? {
            address: formData.address,
            memo: formData.memo,
            beneficiaryName: formData.beneficiaryName,
            counterpartyVasp: formData.counterpartyVasp,
        } : {
            accountName: formData.accountName,
            bankName: formData.bankName,
            bankAccount: formData.bankAccount,
            iban: formData.iban,
            bankCode: formData.bankCode,
        })
      };

      const response = await fetch(`${import.meta.env.VITE_API_URL}/wallets`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        setShowCreateModal(false);
        setFormData({
            assetId: '', beneficiaryName: '', counterpartyVasp: '', address: '', memo: '',
            accountName: '', bankName: '', bankAccount: '', iban: '', bankCode: ''
        });
        fetchWallets();
      } else {
        const err = await response.json();
        alert(err.message || 'Failed to create wallet');
      }
    } catch (error) {
      console.error('Failed to create wallet', error);
      alert('An unexpected error occurred');
    } finally {
      setCreating(false);
    }
  };

  const filteredWallets = wallets.filter(w => 
    activeTab === 'crypto' ? w.asset.type === 'CRYPTO' : w.asset.type === 'FIAT'
  );

  const filteredAssets = assets.filter(a => 
    activeTab === 'crypto' ? a.type === 'CRYPTO' : a.type === 'FIAT'
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Wallets & Accounts</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage your withdrawal addresses and bank accounts</p>
        </div>
        <button 
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors"
        >
          <Plus size={20} />
          {activeTab === 'crypto' ? 'Add Wallet Address' : 'Add Bank Account'}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="border-b border-gray-100 dark:border-gray-700">
          <div className="flex">
            <button
              onClick={() => setActiveTab('crypto')}
              className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 ${
                activeTab === 'crypto' 
                  ? 'border-brand-primary text-brand-primary' 
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Wallet size={18} />
                Crypto Wallets
              </div>
            </button>
            <button
              onClick={() => setActiveTab('fiat')}
              className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 ${
                activeTab === 'fiat' 
                  ? 'border-brand-primary text-brand-primary' 
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Building2 size={18} />
                Bank Accounts
              </div>
            </button>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
                Loading...
            </div>
          ) : filteredWallets.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
              <p>No {activeTab === 'crypto' ? 'wallet addresses' : 'bank accounts'} found for withdrawal.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredWallets.map(wallet => (
                <div key={wallet.id} className="p-4 border border-gray-100 dark:border-gray-700 rounded-lg hover:shadow-md dark:hover:bg-gray-700/50 transition-all">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-gray-900 dark:text-white">{wallet.asset.code}</span>
                        <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400">{wallet.type}</span>
                      </div>
                      
                      {activeTab === 'crypto' ? (
                        <div className="space-y-1">
                          <div className="text-sm text-gray-600 dark:text-gray-300 font-mono break-all">{wallet.address}</div>
                          {wallet.memo && <div className="text-xs text-gray-500 dark:text-gray-400">Memo: {wallet.memo}</div>}
                          <div className="text-xs text-gray-400 dark:text-gray-500 mt-2">Beneficiary: {
                            // Ideally these fields should be in the wallet object if we updated the backend DTO return
                            // Assuming backend returns all fields
                            (wallet as any).beneficiaryName || '-'
                          }</div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{(wallet as any).bankName}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-300">{(wallet as any).accountName}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400 font-mono">{(wallet as any).iban || (wallet as any).bankAccount}</div>
                        </div>
                      )}
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      wallet.status === 'ACTIVE' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                    }`}>
                      {wallet.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full overflow-hidden border border-gray-100 dark:border-gray-700">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white">
                {activeTab === 'crypto' ? 'Add Crypto Address' : 'Add Bank Account'}
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                <span className="text-2xl">&times;</span>
              </button>
            </div>
            
            <form onSubmit={handleCreate} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Asset</label>
                <select
                  required
                  value={formData.assetId}
                  onChange={e => setFormData({...formData, assetId: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">Select Asset</option>
                  {filteredAssets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.network ? `(${a.network})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {activeTab === 'crypto' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Beneficiary Name</label>
                    <input
                      required
                      type="text"
                      value={formData.beneficiaryName}
                      onChange={e => setFormData({...formData, beneficiaryName: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="e.g. John Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Counterparty VASP</label>
                    <input
                      required
                      type="text"
                      value={formData.counterpartyVasp}
                      onChange={e => setFormData({...formData, counterpartyVasp: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="e.g. Binance, Coinbase, or Self-hosted"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Wallet Address</label>
                    <input
                      required
                      type="text"
                      value={formData.address}
                      onChange={e => setFormData({...formData, address: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="0x..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Memo / Tag (Optional)</label>
                    <input
                      type="text"
                      value={formData.memo}
                      onChange={e => setFormData({...formData, memo: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Holder Name</label>
                    <input
                      required
                      type="text"
                      value={formData.accountName}
                      onChange={e => setFormData({...formData, accountName: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bank Name</label>
                    <input
                      required
                      type="text"
                      value={formData.bankName}
                      onChange={e => setFormData({...formData, bankName: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">IBAN</label>
                    <input
                      required
                      type="text"
                      value={formData.iban}
                      onChange={e => setFormData({...formData, iban: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SWIFT / BIC Code (Optional)</label>
                    <input
                      type="text"
                      value={formData.bankCode}
                      onChange={e => setFormData({...formData, bankCode: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                </>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletManagement;
