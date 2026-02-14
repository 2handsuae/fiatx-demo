import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import CustomerLogin from './pages/CustomerLogin';
import CustomerRegister from './pages/CustomerRegister';
import LandingPage from './pages/LandingPage';
import CustomerDashboardLayout from './components/CustomerDashboardLayout';
import CustomerProfile from './pages/CustomerProfile';
import Verification from './pages/Verification';
import AuthGuard from './components/AuthGuard';
import WalletManagement from './pages/WalletManagement';
import Deposit from './pages/Deposit';
import Withdraw from './pages/Withdraw';
import Swap from './pages/Swap';
import DashboardOverview from './pages/DashboardOverview';
import TransactionHistory from './pages/TransactionHistory';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
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

               {/* Public Dashboard Routes */}
               <Route path="/profile" element={<CustomerProfile />} />
               <Route path="/verification" element={<Verification />} />
            </Route>

            {/* Redirect old dashboard routes */}
            <Route path="/dashboard/*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
