import { useNavigate } from 'react-router-dom';
import { User, Mail, Phone, Calendar, ShieldCheck, Clock, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useCustomerProfile } from '../hooks/useCustomerProfile';

const CustomerProfile = () => {
  const { profile, loading, error } = useCustomerProfile();
  const navigate = useNavigate();

  if (loading) return <div className="p-8 text-center text-gray-500">Loading profile...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!profile) return null;

  const isApproved = profile.complianceStatus === 'ACTIVE';
  const isRejected =
    profile.cddStatus === 'REJECTED' ||
    profile.eddStatus === 'REJECTED' ||
    profile.finalApprovalStatus === 'REJECTED';
  const isExpired = profile.complianceStatus === 'EXPIRED' || profile.cddStatus === 'EXPIRED';
  const isBlocked = profile.complianceStatus === 'BLOCKED' || isRejected;
  const isRestricted = profile.complianceStatus === 'RESTRICTED';
  const isInProgress = ['NONE', 'IN_PROGRESS'].includes(profile.complianceStatus);
  const isFinalPending = profile.finalApprovalStatus === 'PENDING';
  const showVerifyButton = !isApproved;

  const statusIconClass = isApproved
    ? 'bg-green-100 text-green-600'
    : isBlocked
      ? 'bg-red-100 text-red-600'
      : isExpired
        ? 'bg-gray-100 text-gray-600'
        : isRestricted
          ? 'bg-yellow-100 text-yellow-600'
          : 'bg-blue-100 text-blue-600';

  const statusBadgeClass = isApproved
    ? 'bg-green-100 text-green-700'
    : isBlocked
      ? 'bg-red-100 text-red-700'
      : isExpired
        ? 'bg-gray-100 text-gray-700'
        : isRestricted
          ? 'bg-yellow-100 text-yellow-700'
          : isInProgress
            ? 'bg-blue-100 text-blue-700'
            : 'bg-gray-100 text-gray-700';

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
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300 ${statusIconClass}`}>
                      <ShieldCheck size={20} />
                  </div>
                  <div>
                      <h3 className="font-bold text-gray-900">Onboarding Status</h3>
                      <p className="text-sm text-gray-500">Customer Type: <span className="font-medium text-gray-900">{profile.customerType}</span></p>
                  </div>
              </div>
              <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold transition-colors duration-300 ${statusBadgeClass}`}>
                      {profile.complianceStatus.replace(/_/g, ' ')}
                  </span>
                  {showVerifyButton && (
                      <button 
                          onClick={() => navigate('/verification')}
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
                      <p>
                        {isExpired
                          ? 'Your CDD document has expired. Please re-initiate CDD verification.'
                          : isRejected
                            ? 'Compliance case rejected. Please re-initiate verification.'
                            : isFinalPending
                              ? 'EDD approved. Waiting for final management approval.'
                              : 'Complete onboarding (CDD/EDD) to unlock trading features.'}
                      </p>
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

    </div>
  );
};

export default CustomerProfile;
