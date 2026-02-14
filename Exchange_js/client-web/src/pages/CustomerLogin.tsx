import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowRight, Smartphone, Shield, Eye, EyeOff } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const CustomerLogin = () => {
  const [method, setMethod] = useState<'email' | 'mobile'>('email');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    phone: '',
    password: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
        const loginData: any = { password: formData.password };
        if (method === 'email') {
            loginData.email = formData.email.trim();
        } else {
            loginData.phone = formData.phone.trim();
        }

        const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/customer/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginData)
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('customer_token', data.access_token);
            await refreshProfile(); // Refresh global auth state
            navigate('/profile');
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
    <div className="min-h-screen flex bg-brand-secondary font-['Noto_Sans_SC']">
      {/* Left: Brand Image Section (40%) */}
      <div className="hidden lg:flex lg:w-[40%] relative overflow-hidden bg-brand-dark">
        <motion.div 
          initial={{ scale: 1.1, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.5 }}
          className="absolute inset-0"
        >
          <img 
            src="https://images.unsplash.com/photo-1639322537228-f710d846310a?q=80&w=2832&auto=format&fit=crop"
            alt="Brand Visual" 
            className="w-full h-full object-cover opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-primary/90 to-transparent mix-blend-multiply"></div>
        </motion.div>
        
        <div className="relative z-10 p-12 flex flex-col justify-between text-white h-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-brand-primary font-bold text-xl">E</div>
            <span className="text-2xl font-bold tracking-tight">EXCHANGE</span>
          </div>
          <div className="space-y-6">
            <h2 className="text-4xl font-bold leading-tight">The Future of <br/>Digital Asset Trading</h2>
            <p className="text-blue-100 text-lg max-w-md">
              Experience institutional-grade security and liquidity on the world's most advanced crypto exchange platform.
            </p>
            <div className="flex gap-4 pt-4">
              <div className="flex -space-x-3">
                {[1,2,3].map(i => (
                  <div key={i} className="w-10 h-10 rounded-full border-2 border-brand-primary bg-gray-200"></div>
                ))}
              </div>
              <div className="text-sm">
                <p className="font-bold">Trusted by 2M+ Users</p>
                <p className="text-blue-200">Join the community today</p>
              </div>
            </div>
          </div>
          <div className="text-xs text-blue-200/60">
            © 2026 Exchange Group. All rights reserved.
          </div>
        </div>
      </div>

      {/* Right: Login Form Section (60%) */}
      <div className="w-full lg:w-[60%] flex flex-col justify-center items-center p-6 sm:p-12 relative">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile Header Logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <div className="w-12 h-12 bg-brand-primary rounded-xl flex items-center justify-center text-white font-bold text-2xl">E</div>
          </div>

          <div className="text-center lg:text-left space-y-2">
            <h1 className="text-3xl font-bold text-gray-900">Welcome Back</h1>
            <p className="text-gray-500">Please enter your details to sign in.</p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Login Method Tabs */}
          <div className="flex p-1 bg-gray-100 rounded-xl">
            <button 
              onClick={() => setMethod('email')}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-all ${
                method === 'email' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Mail size={18} /> Email
            </button>
            <button 
              onClick={() => setMethod('mobile')}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-all ${
                method === 'mobile' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Smartphone size={18} /> Mobile
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-5">
              {method === 'email' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
                  <div className="relative">
                    <input 
                      type="email" 
                      required
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                      className="w-full pl-4 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all"
                      placeholder="name@example.com"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number</label>
                  <div className="flex gap-3">
                    <select className="bg-white border border-gray-200 rounded-xl px-3 py-3 outline-none focus:border-brand-primary">
                      <option>+86</option>
                      <option>+1</option>
                    </select>
                    <input 
                      type="tel" 
                      required
                      value={formData.phone}
                      onChange={e => setFormData({...formData, phone: e.target.value})}
                      className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all"
                      placeholder="138 0000 0000"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"}
                    required
                    value={formData.password}
                    onChange={e => setFormData({...formData, password: e.target.value})}
                    className="w-full pl-4 pr-12 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all"
                    placeholder="••••••••"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary/20" />
                <span className="text-sm text-gray-500 group-hover:text-gray-700">Remember me</span>
              </label>
              <a href="#" className="text-sm font-medium text-brand-primary hover:text-blue-700">Forgot password?</a>
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full py-3.5 bg-brand-primary text-white font-bold rounded-xl hover:bg-blue-700 focus:ring-4 focus:ring-brand-primary/20 transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/20 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>Sign in <ArrowRight size={20} /></>
              )}
            </button>
          </form>

          <div className="text-center space-y-4">
            <p className="text-sm text-gray-500">
              Don't have an account? <Link to="/register" className="font-bold text-brand-primary hover:text-blue-700">Create free account</Link>
            </p>
            
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400 bg-gray-50 py-2 rounded-lg">
              <Shield size={14} />
              <span>Protected by Bank-Grade Encryption</span>
            </div>
          </div>
        </div>

        {/* Floating Background Elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-50 rounded-full blur-3xl -z-10 opacity-50 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-gray-100 rounded-full blur-3xl -z-10 opacity-50 pointer-events-none"></div>
      </div>
    </div>
  );
};

export default CustomerLogin;
