import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import CustomerDashboardLayout from './components/CustomerDashboardLayout';
import AuthGuard from './components/AuthGuard';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const CustomerLogin = lazy(() => import('./pages/CustomerLogin'));
const CustomerRegister = lazy(() => import('./pages/CustomerRegister'));
const CustomerProfile = lazy(() => import('./pages/CustomerProfile'));
const Verification = lazy(() => import('./pages/Verification'));
const WalletManagement = lazy(() => import('./pages/WalletManagement'));
const Deposit = lazy(() => import('./pages/Deposit'));
const Withdraw = lazy(() => import('./pages/Withdraw'));
const Swap = lazy(() => import('./pages/Swap'));
const DashboardOverview = lazy(() => import('./pages/DashboardOverview'));
const TransactionHistory = lazy(() => import('./pages/TransactionHistory'));
const WithdrawalAddresses = lazy(() => import('./pages/WithdrawalAddresses'));

const RouteLoading = () => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
    <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white px-8 py-10 text-center shadow-sm">
      <h1 className="text-2xl font-semibold text-gray-900">Loading Page</h1>
      <p className="mt-3 text-sm text-gray-600">Preparing the requested customer page...</p>
    </div>
  </div>
);

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<CustomerLogin />} />
              <Route path="/register" element={<CustomerRegister />} />

              {/* Dashboard Routes (No /dashboard prefix) */}
              <Route element={<CustomerDashboardLayout />}>
                 {/* Protected Routes */}
                 <Route path="/overview" element={<AuthGuard><DashboardOverview /></AuthGuard>} />
                 <Route path="/wallet" element={<AuthGuard><WalletManagement /></AuthGuard>} />
                 <Route path="/deposit" element={<AuthGuard><Deposit /></AuthGuard>} />
                 <Route path="/swap" element={<AuthGuard><Swap /></AuthGuard>} />
                 <Route path="/withdraw" element={<AuthGuard><Withdraw /></AuthGuard>} />
                 <Route path="/transactions" element={<AuthGuard><TransactionHistory /></AuthGuard>} />
                 <Route path="/withdrawal-addresses" element={<AuthGuard><WithdrawalAddresses /></AuthGuard>} />

                 {/* Public Dashboard Routes */}
                 <Route path="/profile" element={<CustomerProfile />} />
                 <Route path="/verification" element={<Verification />} />
              </Route>

              {/* Redirect old dashboard routes */}
              <Route path="/dashboard/*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </Suspense>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
