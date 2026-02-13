import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, User, ShieldCheck, ArrowRight, Eye, EyeOff, LayoutDashboard, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AdminLogin = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    // Get input values directly from form since we aren't using controlled state for inputs yet
    const form = e.target as HTMLFormElement;
    const email = (form.elements[0] as HTMLInputElement).value;
    const password = (form.elements[1] as HTMLInputElement).value;

    try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('admin_token', data.access_token);
            navigate('/dashboard/members');
        } else {
            const err = await response.json();
            setError(err.message || 'Login failed');
        }
    } catch (err) {
        setError('Network error. Please try again.');
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex font-['Noto_Sans_SC'] bg-gray-50">
      {/* Left: Brand Image Section (40%) - Darker/More Professional for Admin */}
      <div className="hidden lg:flex lg:w-[40%] relative overflow-hidden bg-gray-900">
        <motion.div 
          initial={{ scale: 1.1, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.5 }}
          className="absolute inset-0"
        >
          <img 
            src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=2940&auto=format&fit=crop"
            alt="Admin Visual" 
            className="w-full h-full object-cover opacity-40 grayscale"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/40 to-gray-900/90 mix-blend-overlay"></div>
        </motion.div>
        
        <div className="relative z-10 p-12 flex flex-col justify-between text-white h-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/10 backdrop-blur border border-white/20 rounded-lg flex items-center justify-center text-white font-bold text-xl">
              <ShieldCheck size={24} />
            </div>
            <span className="text-xl font-bold tracking-tight opacity-90">ADMIN PORTAL</span>
          </div>
          <div className="space-y-4">
            <div className="w-16 h-1 bg-brand-primary rounded-full"></div>
            <h2 className="text-3xl font-bold leading-tight">System Control Center</h2>
            <p className="text-gray-300 text-sm max-w-xs leading-relaxed">
              Authorized personnel only. All activities are monitored and logged for security purposes.
            </p>
          </div>
          <div className="text-xs text-gray-500 font-mono">
            V 2.5.0 • BUILD 2026.01
          </div>
        </div>
      </div>

      {/* Right: Login Form Section (60%) */}
      <div className="w-full lg:w-[60%] flex flex-col justify-center items-center p-6 sm:p-12 relative">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
          <div className="text-center mb-10">
            <div className="mx-auto w-16 h-16 bg-brand-primary/5 rounded-full flex items-center justify-center mb-4 text-brand-primary">
              <LayoutDashboard size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Administrator Sign In</h1>
            <p className="text-sm text-gray-500 mt-2">Enter your credentials to access the dashboard</p>
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-600">
                <AlertCircle size={16} />
                {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Admin ID / Email</label>
              <div className="relative group">
                <User className="absolute left-4 top-3.5 w-5 h-5 text-gray-400 group-focus-within:text-brand-primary transition-colors" />
                <input 
                  type="text" 
                  required
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all font-medium text-gray-900"
                  placeholder="admin@exchange.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Password</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-400 group-focus-within:text-brand-primary transition-colors" />
                <input 
                  type={showPassword ? "text" : "password"}
                  required
                  className="w-full pl-12 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all font-medium text-gray-900"
                  placeholder="••••••••••••"
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full py-3.5 bg-gray-900 text-white font-bold rounded-lg hover:bg-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-gray-900/20 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>Authenticate <ArrowRight size={18} /></>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-100">
             <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <ShieldCheck className="w-5 h-5 text-brand-primary mt-0.5" />
                <p className="text-xs text-blue-800 leading-relaxed">
                  This system is restricted to authorized users. Unauthorized access attempts will be recorded and prosecuted.
                </p>
             </div>
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-gray-400">
          Secure Connection • 256-bit SSL Encrypted
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
