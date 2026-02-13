import { useState } from 'react';
import { User, Mail, Phone, Calendar, ShieldCheck, Clock, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCustomerProfile } from '../hooks/useCustomerProfile';
import Verification from './Verification';

const CustomerProfile = () => {
  const { profile, loading, error } = useCustomerProfile();
  const [showVerification, setShowVerification] = useState(false);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading profile...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!profile) return null;

  const isApproved =
    profile.onboardingStage === 'ONBOARDING_APPROVED' ||
    (profile.canTradeSwap && profile.canTradeWithdraw);
  const isRejected = profile.onboardingStage === 'ONBOARDING_REJECTED';
  const showVerifyButton = !isApproved;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          <p className="text-gray-500">Manage your account settings and preferences.</p>
      </div>

      {/* Identity Verification Card */}
      <motion.div 
          layout
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative"
      >
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300 ${isApproved ? 'bg-green-100 text-green-600' : isRejected ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600'}`}>
                      <ShieldCheck size={20} />
                  </div>
                  <div>
                      <h3 className="font-bold text-gray-900">Onboarding Status</h3>
                      <p className="text-sm text-gray-500">Customer Type: <span className="font-medium text-gray-900">{profile.customerType}</span></p>
                  </div>
              </div>
              <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold transition-colors duration-300 ${isApproved ? 'bg-green-100 text-green-700' : isRejected ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {profile.onboardingStage.replace(/_/g, ' ')}
                  </span>
                  {showVerifyButton && (
                      <button 
                          onClick={() => setShowVerification(true)}
                          className={`px-4 py-2 ${isRejected ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-primary hover:bg-blue-700'} text-white text-sm font-bold rounded-lg transition-colors`}
                      >
                          {isRejected ? 'Retry' : 'View Detail'}
                      </button>
                  )}
              </div>
          </div>
          {!isApproved && (
              <div className={`p-4 ${isRejected ? 'bg-red-50/50' : 'bg-gray-50/50'}`}>
                  <div className="flex items-start gap-3 text-sm text-gray-600">
                      <AlertCircle size={16} className={`mt-0.5 ${isRejected ? 'text-red-600' : 'text-brand-primary'}`} />
                      <p>{isRejected ? profile.onboardingRejectReason || 'Onboarding was rejected. Please update your documents and resubmit.' : 'Complete onboarding (CDD/EDD and approval) to unlock trading features.'}</p>
                  </div>
              </div>
          )}
      </motion.div>

      {/* Basic Info Card */}
        <motion.div 
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl shadow-sm border border-gray-200"
        >
            <div className="p-6 border-b border-gray-100">
                <h3 className="font-bold text-gray-900">Basic Information</h3>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <User size={14} /> Full Name
                    </label>
                    <div className="font-medium text-gray-900 text-lg">
                        {profile.firstName || profile.lastName ? `${profile.firstName || ''} ${profile.lastName || ''}` : 'Not set'}
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Mail size={14} /> Email Address
                    </label>
                    <div className="font-medium text-gray-900 text-lg">
                        {profile.email || 'Not linked'}
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Phone size={14} /> Phone Number
                    </label>
                    <div className="font-medium text-gray-900 text-lg">
                        {profile.phone || 'Not linked'}
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Calendar size={14} /> Member Since
                    </label>
                    <div className="font-medium text-gray-900 text-lg">
                        {new Date(profile.createdAt).toLocaleDateString()}
                    </div>
                </div>

                <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock size={14} /> Last Login
                    </label>
                    <div className="font-medium text-gray-900">
                        {profile.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : 'Never'}
                    </div>
                </div>
            </div>
        </motion.div>

      {/* Verification Modal */}
      <AnimatePresence>
          {showVerification && (
              <Verification isModal onClose={() => setShowVerification(false)} />
          )}
      </AnimatePresence>
    </div>
  );
};

export default CustomerProfile;
