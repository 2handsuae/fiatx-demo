import { useState, useEffect, useCallback } from 'react';
import { Wallet, Building2, RefreshCw, Copy, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  CustomerSessionError,
  customerFetch,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';

interface WalletAsset {
  code: string;
  type: string;
  decimals: number;
}

interface DepositWallet {
  id: string;
  walletNo: string;
  type: string;
  walletRole: string;
  status: string;
  address: string | null;
  iban: string | null;
  bankName: string | null;
  accountName: string | null;
  asset: WalletAsset;
}

interface Asset {
  id: string;
  currency: string;
  code: string;
  type: string;
  network: string | null;
}

const DEPOSIT_ROLES = ['C_DEP', 'C_VIBAN'];

const WalletManagement = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'crypto' | 'fiat'>('crypto');
  const [wallets, setWallets] = useState<DepositWallet[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: 'ACTIVE', take: '100' });
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/wallets?${params.toString()}`,
      );
      if (response.ok) {
        const data = await response.json();
        const depositWallets = (data.items || []).filter(
          (w: DepositWallet) => DEPOSIT_ROLES.includes(w.walletRole),
        );
        setWallets(depositWallets);
      }
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      console.error('Failed to fetch wallets', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAssets = useCallback(async () => {
    try {
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`,
      );
      if (response.ok) {
        const data = await response.json();
        setAssets(data.items || []);
      }
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      console.error('Failed to fetch assets', error);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchWallets();
      fetchAssets();
    }
  }, [user, fetchWallets, fetchAssets]);

  const handleCreateWallet = async (assetId: string) => {
    setCreating(assetId);
    try {
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/deposit-wallets`,
        { method: 'POST', body: JSON.stringify({ assetId }) },
      );
      if (response.ok) {
        await fetchWallets();
      } else {
        alert(await getCustomerApiErrorMessage(response, 'Failed to create wallet'));
      }
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      console.error('Failed to create wallet', error);
      alert('An unexpected error occurred');
    } finally {
      setCreating(null);
    }
  };

  const copyToClipboard = (text: string, walletId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(walletId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredWallets = wallets.filter((w) =>
    activeTab === 'crypto' ? w.asset.type === 'CRYPTO' : w.asset.type === 'FIAT',
  );

  // Assets that don't have an ACTIVE deposit wallet yet
  const availableAssets = assets.filter((a) => {
    const matchesTab = activeTab === 'crypto' ? a.type === 'CRYPTO' : a.type === 'FIAT';
    if (!matchesTab) return false;
    return !wallets.some((w) => w.asset.code === a.code && w.status === 'ACTIVE');
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deposit Wallets</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Your deposit addresses and bank accounts for receiving funds
        </p>
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
                Crypto
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
                Fiat
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
          ) : (
            <div className="space-y-6">
              {/* Existing deposit wallets */}
              {filteredWallets.length > 0 && (
                <div className="grid gap-4">
                  {filteredWallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      className="p-4 border border-gray-100 dark:border-gray-700 rounded-lg"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold text-gray-900 dark:text-white">
                              {wallet.asset.code}
                            </span>
                            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded text-xs font-medium">
                              {wallet.status}
                            </span>
                          </div>

                          {activeTab === 'crypto' && wallet.address && (
                            <div className="flex items-center gap-2">
                              <code className="text-sm text-gray-600 dark:text-gray-300 font-mono break-all">
                                {wallet.address}
                              </code>
                              <button
                                onClick={() => copyToClipboard(wallet.address!, wallet.id)}
                                className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                title="Copy address"
                              >
                                {copiedId === wallet.id ? (
                                  <Check size={16} className="text-green-500" />
                                ) : (
                                  <Copy size={16} />
                                )}
                              </button>
                            </div>
                          )}

                          {activeTab === 'fiat' && (
                            <div className="space-y-1 text-sm">
                              {wallet.bankName && (
                                <div className="text-gray-600 dark:text-gray-300">
                                  Bank: {wallet.bankName}
                                </div>
                              )}
                              {wallet.accountName && (
                                <div className="text-gray-600 dark:text-gray-300">
                                  Account: {wallet.accountName}
                                </div>
                              )}
                              {wallet.iban && (
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-600 dark:text-gray-300 font-mono">
                                    IBAN: {wallet.iban}
                                  </span>
                                  <button
                                    onClick={() => copyToClipboard(wallet.iban!, wallet.id)}
                                    className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                    title="Copy IBAN"
                                  >
                                    {copiedId === wallet.id ? (
                                      <Check size={16} className="text-green-500" />
                                    ) : (
                                      <Copy size={16} />
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Available assets to create wallets for */}
              {availableAssets.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                    Get a deposit {activeTab === 'crypto' ? 'address' : 'account'}
                  </h3>
                  <div className="grid gap-2">
                    {availableAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex items-center justify-between p-3 border border-dashed border-gray-200 dark:border-gray-600 rounded-lg"
                      >
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                          {asset.code}
                        </span>
                        <button
                          onClick={() => handleCreateWallet(asset.id)}
                          disabled={creating !== null}
                          className="px-3 py-1.5 text-sm bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
                        >
                          {creating === asset.id ? 'Creating...' : 'Get Address'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filteredWallets.length === 0 && availableAssets.length === 0 && (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
                  <p>No {activeTab === 'crypto' ? 'crypto assets' : 'fiat currencies'} available.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WalletManagement;
