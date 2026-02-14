import { Wallet, ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, History } from 'lucide-react';

interface PlaceholderProps {
  title: string;
  icon: React.ReactNode;
}

const PlaceholderPage: React.FC<PlaceholderProps> = ({ title, icon }) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-brand-primary/10 text-brand-primary rounded-xl">
          {icon}
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
            {/* Content Placeholder */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm min-h-[400px] flex flex-col items-center justify-center text-gray-400">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                    {icon}
                </div>
                <p className="text-lg font-medium text-gray-500">Feature Coming Soon</p>
                <p className="text-sm">This module is currently under development.</p>
            </div>
        </div>

        <div className="space-y-6">
            {/* Sidebar Placeholder */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-[200px] animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                    <div className="h-3 bg-gray-50 rounded w-full"></div>
                    <div className="h-3 bg-gray-50 rounded w-5/6"></div>
                    <div className="h-3 bg-gray-50 rounded w-4/6"></div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export const WalletPage = () => <PlaceholderPage title="Wallet" icon={<Wallet size={24} />} />;
export const DepositPage = () => <PlaceholderPage title="Deposit" icon={<ArrowDownCircle size={24} />} />;
export const SwapPage = () => <PlaceholderPage title="Swap" icon={<ArrowLeftRight size={24} />} />;
export const WithdrawPage = () => <PlaceholderPage title="Withdraw" icon={<ArrowUpCircle size={24} />} />;
export const TransactionPage = () => <PlaceholderPage title="Transactions" icon={<History size={24} />} />;
