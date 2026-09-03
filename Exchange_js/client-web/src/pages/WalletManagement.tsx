import { useState, useEffect, useCallback } from 'react';
import { Wallet, Building2, RefreshCw, Copy, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  CustomerSessionError,
  customerFetch,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';

interface WalletItem {
  id: string;
  walletNo: string;
  walletRole?: string;
  network: string;
  status: string;
  address?: string;
  iban?: string;
  custodianRef?: string;
  networkInfo?: {
    kind: string;
    custodian: string;
    bankName: string | null;
    accountName: string | null;
    explorerUrl: string | null;
  };
}

interface Asset {
  id: string;
  currency: string;
  code: string;
  type: string;
  network: string | null;
}

const WalletManagement = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'crypto' | 'fiat'>('crypto');
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ vaultCode: 'CLIENT_DEPOSIT', status: 'ACTIVE', take: '100' });
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/wallets?${params.toString()}`,
      );
      if (response.ok) {
        const data = await response.json();
        setWallets(data.items || []);
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

  const handleCreateWallet = async (network: string) => {
    setCreating(network);
    try {
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/deposit-wallets`,
        { method: 'POST', body: JSON.stringify({ network }) },
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

  const filteredAssets = assets.filter((a) =>
    activeTab === 'crypto' ? a.type === 'CRYPTO' : a.type === 'FIAT',
  );

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
          ) : filteredAssets.length > 0 ? (
            <div className="grid gap-4">
              {filteredAssets.map((asset) => {
                const wallet = wallets.find((w) => w.network === asset.network);
                return (
                  <div
                    key={asset.id}
                    className="p-4 border border-gray-100 dark:border-gray-700 rounded-lg"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-bold text-gray-900 dark:text-white">
                            {asset.code}
                          </span>
                          {wallet && (
                            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded text-xs font-medium">
                              {wallet.status}
                            </span>
                          )}
                        </div>

                        {!wallet ? (
                          <button
                            onClick={() => handleCreateWallet(asset.network!)}
                            disabled={creating !== null}
                            className="px-3 py-1.5 text-sm bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
                          >
                            {creating === asset.network ? 'Creating...' : `Open address on ${asset.network}`}
                          </button>
                        ) : activeTab === 'crypto' && wallet.address ? (
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
                        ) : activeTab === 'fiat' ? (
                          <div className="space-y-1 text-sm">
                            {wallet.networkInfo?.bankName && (
                              <div className="text-gray-600 dark:text-gray-300">
                                Bank: {wallet.networkInfo.bankName}
                              </div>
                            )}
                            {wallet.networkInfo?.accountName && (
                              <div className="text-gray-600 dark:text-gray-300">
                                Account: {wallet.networkInfo.accountName}
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
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
              <p>No {activeTab === 'crypto' ? 'crypto assets' : 'fiat currencies'} available.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WalletManagement;
