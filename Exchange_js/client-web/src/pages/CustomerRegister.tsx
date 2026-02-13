import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowRight, User, Shield, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

const CustomerRegister = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    customerType: 'INDIVIDUAL' as 'INDIVIDUAL' | 'CORPORATE',
    companyName: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setIsLoading(false);
      return;
    }

    if (formData.customerType === 'CORPORATE' && !formData.companyName.trim()) {
      setError('Company name is required for corporate registration');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/customer/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          customerType: formData.customerType,
          companyName: formData.customerType === 'CORPORATE' ? formData.companyName : undefined,
          firstName: formData.username // Using username as firstName for now
        })
      });

      if (response.ok) {
        // Auto login or redirect to login? Requirement says redirect to profile eventually, 
        // but typically register -> login. 
        // Let's stick to previous flow: register -> login page.
        navigate('/login');
      } else {
        const err = await response.json();
        setError(err.message || 'Registration failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-brand-secondary font-['Noto_Sans_SC']">
      {/* Left: Brand Image Section (40%) - Distinct from Login */}
      <div className="hidden lg:flex lg:w-[40%] relative overflow-hidden bg-brand-dark">
        <motion.div 
          initial={{ scale: 1.1, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.5 }}
          className="absolute inset-0"
        >
          <img 
            src="https://images.unsplash.com/photo-1621504450168-38f647315648?q=80&w=2940&auto=format&fit=crop"
            alt="Register Visual" 
            className="w-full h-full object-cover opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-purple-900/90 to-transparent mix-blend-multiply"></div>
        </motion.div>
        
        <div className="relative z-10 p-12 flex flex-col justify-between text-white h-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-purple-700 font-bold text-xl">E</div>
            <span className="text-2xl font-bold tracking-tight">EXCHANGE</span>
          </div>
          <div className="space-y-6">
            <h2 className="text-4xl font-bold leading-tight">Start Your <br/>Crypto Journey</h2>
            <p className="text-purple-100 text-lg max-w-md">
              Join millions of users worldwide and trade with confidence on the most secure platform.
            </p>
            <div className="space-y-3 pt-4">
               <div className="flex items-center gap-3">
                 <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white">1</div>
                 <span className="font-medium">Create Account</span>
               </div>
               <div className="w-0.5 h-6 bg-white/20 ml-4"></div>
               <div className="flex items-center gap-3 opacity-60">
                 <div className="w-8 h-8 rounded-full border border-white/30 flex items-center justify-center text-white">2</div>
                 <span>Verify Identity</span>
               </div>
               <div className="w-0.5 h-6 bg-white/20 ml-4"></div>
               <div className="flex items-center gap-3 opacity-60">
                 <div className="w-8 h-8 rounded-full border border-white/30 flex items-center justify-center text-white">3</div>
                 <span>Start Trading</span>
               </div>
            </div>
          </div>
          <div className="text-xs text-purple-200/60">
            © 2026 Exchange Group. All rights reserved.
          </div>
        </div>
      </div>

      {/* Right: Register Form Section (60%) */}
      <div className="w-full lg:w-[60%] flex flex-col justify-center items-center p-6 sm:p-12 relative">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile Header Logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <div className="w-12 h-12 bg-purple-700 rounded-xl flex items-center justify-center text-white font-bold text-2xl">E</div>
          </div>

          <div className="text-center lg:text-left space-y-2">
            <h1 className="text-3xl font-bold text-gray-900">Create Account</h1>
            <p className="text-gray-500">Sign up in seconds. No credit card required.</p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-600">
                <AlertCircle size={16} />
                {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Username</label>
                <div className="relative">
                <User className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
                <input 
                    type="text" 
                    required
                    minLength={2}
                    maxLength={20}
                    value={formData.username}
                    onChange={e => setFormData({...formData, username: e.target.value})}
                    className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all"
                    placeholder="Your username"
                />
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
                <div className="relative">
                <Mail className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
                <input 
                    type="email" 
                    required
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all"
                    placeholder="name@example.com"
                />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                    <div className="relative">
                    <input 
                        type={showPassword ? "text" : "password"}
                        required
                        minLength={6}
                        maxLength={20}
                        value={formData.password}
                        onChange={e => setFormData({...formData, password: e.target.value})}
                        className="w-full pl-4 pr-10 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all"
                        placeholder="••••••••"
                    />
                    <button 
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
                    <div className="relative">
                    <input 
                        type={showConfirmPassword ? "text" : "password"}
                        required
                        value={formData.confirmPassword}
                        onChange={e => setFormData({...formData, confirmPassword: e.target.value})}
                        className="w-full pl-4 pr-10 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all"
                        placeholder="••••••••"
                    />
                    <button 
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                    </div>
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Entity Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, customerType: 'INDIVIDUAL' })}
                    className={`px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
                      formData.customerType === 'INDIVIDUAL'
                        ? 'border-purple-600 bg-purple-50 text-purple-700'
                        : 'border-gray-200 text-gray-600 hover:border-purple-200'
                    }`}
                  >
                    Individual
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, customerType: 'CORPORATE' })}
                    className={`px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
                      formData.customerType === 'CORPORATE'
                        ? 'border-purple-600 bg-purple-50 text-purple-700'
                        : 'border-gray-200 text-gray-600 hover:border-purple-200'
                    }`}
                  >
                    Corporate
                  </button>
                </div>
            </div>

            {formData.customerType === 'CORPORATE' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Company Legal Name</label>
                <input
                  type="text"
                  required
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all"
                  placeholder="Enter company legal name"
                />
              </div>
            )}

            <div className="flex items-start gap-2">
                <input type="checkbox" required className="mt-1 w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500/20" />
                <span className="text-sm text-gray-500">
                    I agree to the <a href="#" className="text-purple-600 hover:text-purple-800 font-medium">Terms of Service</a> and <a href="#" className="text-purple-600 hover:text-purple-800 font-medium">Privacy Policy</a>
                </span>
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full py-3.5 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 focus:ring-4 focus:ring-purple-500/20 transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>Create Account <ArrowRight size={20} /></>
              )}
            </button>
          </form>

          <div className="text-center space-y-4">
            <p className="text-sm text-gray-500">
              Already have an account? <Link to="/login" className="font-bold text-purple-600 hover:text-purple-800">Sign in instead</Link>
            </p>
            
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400 bg-gray-50 py-2 rounded-lg">
              <Shield size={14} />
              <span>Protected by Bank-Grade Encryption</span>
            </div>
          </div>
        </div>

        {/* Floating Background Elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-50 rounded-full blur-3xl -z-10 opacity-50 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-gray-100 rounded-full blur-3xl -z-10 opacity-50 pointer-events-none"></div>
      </div>
    </div>
  );
};

export default CustomerRegister;
