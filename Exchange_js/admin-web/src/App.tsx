import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AdminLogin from './pages/AdminLogin';
import DashboardLayout from './components/DashboardLayout';
import PlatformMembers from './pages/PlatformMembers';
import CustomerManagement from './pages/CustomerManagement';
import CustomerDetail from './pages/CustomerDetail';
import LiquidityProviderList from './pages/LiquidityProviderList';
import LiquidityProviderCreate from './pages/LiquidityProviderCreate';
import LiquidityConfigList from './pages/LiquidityConfigList';
import LiquidityConfigCreate from './pages/LiquidityConfigCreate';
import LiquidityConfigEdit from './pages/LiquidityConfigEdit';
import WalletList from './pages/WalletList';
import WalletDetail from './pages/WalletDetail';
import PayinList from './pages/PayinList';
import PayinDetail from './pages/PayinDetail';
import PayoutList from './pages/PayoutList';
import PayoutDetail from './pages/PayoutDetail';
import AssetList from './pages/AssetList';
import AssetCreate from './pages/AssetCreate';
import DepositTransactionList from './pages/DepositTransactionList';
import DepositTransactionDetail from './pages/DepositTransactionDetail';
import WithdrawTransactionList from './pages/WithdrawTransactionList';
import WithdrawTransactionDetail from './pages/WithdrawTransactionDetail';
import SwapTransactionList from './pages/SwapTransactionList';
import SwapTransactionDetail from './pages/SwapTransactionDetail';
import CoaList from './pages/CoaList';
import JournalList from './pages/JournalList';
import JournalDetail from './pages/JournalDetail';
import JournalLinesList from './pages/JournalLinesList';
import JournalLineDetail from './pages/JournalLineDetail';
import CustomerBalanceHistory from './pages/CustomerBalanceHistory';
import AcctEventList from './pages/AcctEventList';
import JournalHeaderTemplateList from './pages/JournalHeaderTemplateList';
import JournalLineTemplateList from './pages/JournalLineTemplateList';
import ClearingHeaderTemplateList from './pages/ClearingHeaderTemplateList';
import ClearingLineTemplateList from './pages/ClearingLineTemplateList';
import ClearingManagementList from './pages/ClearingManagementList';
import ClearingDetail from './pages/ClearingDetail';
import ClearingDetailsList from './pages/ClearingDetailsList';
import ClearingLineDetail from './pages/ClearingLineDetail';
import CddCasesPage from './pages/CddCasesPage';
import EddCasesPage from './pages/EddCasesPage';
import OnboardingDecisionsPage from './pages/OnboardingDecisionsPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/admin/login" element={<AdminLogin />} />
        
        <Route element={<DashboardLayout />}>
           <Route path="/dashboard">
             <Route index element={<div className="p-8 text-gray-500">Welcome to Admin Dashboard</div>} />
             <Route path="members" element={<PlatformMembers />} />
             <Route path="customer/management" element={<CustomerManagement />} />
             <Route path="compliance/cdd-cases" element={<CddCasesPage />} />
             <Route path="compliance/edd-cases" element={<EddCasesPage />} />
             <Route path="compliance/onboarding-decisions" element={<OnboardingDecisionsPage />} />
             <Route path="customer/:id" element={<CustomerDetail />} />
             <Route path="treasury/wallets" element={<WalletList />} />
             <Route path="treasury/wallets/:id" element={<WalletDetail />} />
             <Route path="treasury/payins" element={<PayinList />} />
             <Route path="treasury/payins/:id" element={<PayinDetail />} />
             <Route path="treasury/payouts" element={<PayoutList />} />
             <Route path="treasury/payouts/:id" element={<PayoutDetail />} />
             <Route path="system/liquidity-providers" element={<LiquidityProviderList />} />
             <Route path="system/liquidity-providers/create" element={<LiquidityProviderCreate />} />
             <Route path="system/liquidity-config" element={<LiquidityConfigList />} />
             <Route path="system/liquidity-config/create" element={<LiquidityConfigCreate />} />
             <Route path="system/liquidity-config/edit/:id" element={<LiquidityConfigEdit />} />
             <Route path="system/assets" element={<AssetList />} />
              <Route path="system/assets/create" element={<AssetCreate />} />
              <Route path="system/acct-events" element={<AcctEventList />} />
              <Route path="system/journal-header-templates" element={<JournalHeaderTemplateList />} />
              <Route path="system/journal-line-templates" element={<JournalLineTemplateList />} />
              <Route path="system/clearing-header-templates" element={<ClearingHeaderTemplateList />} />
              <Route path="system/clearing-line-templates" element={<ClearingLineTemplateList />} />
            </Route>

           <Route path="/exchange">
              <Route path="deposit-transactions" element={<DepositTransactionList />} />
              <Route path="deposit-transactions/:id" element={<DepositTransactionDetail />} />
              <Route path="withdraw-transactions" element={<WithdrawTransactionList />} />
              <Route path="withdraw-transactions/:id" element={<WithdrawTransactionDetail />} />
              <Route path="swap-transactions" element={<SwapTransactionList />} />
              <Route path="swap-transactions/:id" element={<SwapTransactionDetail />} />
           </Route>

           <Route path="/ledger">
              <Route path="coa" element={<CoaList />} />
              <Route path="journals" element={<JournalList />} />
              <Route path="journals/:id" element={<JournalDetail />} />
              <Route path="journal-lines" element={<JournalLinesList />} />
              <Route path="journal-lines/:id" element={<JournalLineDetail />} />
              <Route path="balance-history" element={<CustomerBalanceHistory />} />
           </Route>

           <Route path="/clearing">
              <Route path="management" element={<ClearingManagementList />} />
              <Route path="management/:id" element={<ClearingDetail />} />
              <Route path="details" element={<ClearingDetailsList />} />
              <Route path="lines/:id" element={<ClearingLineDetail />} />
           </Route>
        </Route>

        <Route path="/" element={<Navigate to="/admin/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
