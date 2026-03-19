import { useNavigate } from 'react-router-dom';
import { User, Mail, Phone, Calendar, ShieldCheck, Clock, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useCustomerProfile } from '../hooks/useCustomerProfile';
import {
  isCustomerApprovedForAccess,
  isCustomerFinalApprovalPending,
  isCustomerInProgress,
  isCustomerRejected,
  isCustomerWithdrawn,
} from '../utils/customerOnboarding';

const getPrimaryStatusLabel = (input: {
  onboardingStatus?: string | null;
  operatingStatus?: string | null;
  restrictionStatus?: string | null;
  complianceHoldStatus?: string | null;
}) => {
  const complianceHoldStatus = String(input.complianceHoldStatus || 'ACTIVE').trim().toUpperCase();
  const restrictionStatus = String(input.restrictionStatus || 'CLEAR').trim().toUpperCase();
  const onboardingStatus = String(input.onboardingStatus || 'NONE').trim().toUpperCase();
  const operatingStatus = String(input.operatingStatus || 'INACTIVE').trim().toUpperCase();

  if (complianceHoldStatus === 'FROZEN') return 'FROZEN';
  if (restrictionStatus === 'RESTRICTED') return 'RESTRICTED';
  if (onboardingStatus === 'APPROVED' && operatingStatus === 'ACTIVE') return 'ACTIVE';
  return onboardingStatus;
};

const CustomerProfile = () => {
  const { profile, loading, error } = useCustomerProfile();
  const navigate = useNavigate();

  if (loading) return <div className="p-8 text-center text-gray-500">Loading profile...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!profile) return null;

  const onboardingStatus = String(profile.onboardingStatus || 'NONE').toUpperCase();
  const restrictionStatus = String(profile.restrictionStatus || 'CLEAR').toUpperCase();
  const complianceHoldStatus = String(profile.complianceHoldStatus || 'ACTIVE').toUpperCase();
  const statusLabel = getPrimaryStatusLabel(profile);
  const isApproved = isCustomerApprovedForAccess(profile);
  const isRejected = isCustomerRejected(profile);
  const isWithdrawn = isCustomerWithdrawn(profile);
  const isExpired = !!(
    profile.cddDocumentExpiresAt &&
    onboardingStatus === 'PENDING_CDD_INPUT' &&
    new Date(profile.cddDocumentExpiresAt).getTime() <= Date.now()
  );
  const isBlocked = isRejected || isWithdrawn;
  const isRestricted =
    restrictionStatus === 'RESTRICTED' || complianceHoldStatus === 'FROZEN';
  const isInProgress = isCustomerInProgress(profile);
  const isFinalPending = isCustomerFinalApprovalPending(profile);
  const showVerifyButton = !isApproved;
  const periodicReviewStatus = String(
    profile.activePeriodicReviewCycle?.status ||
      (profile.periodicReviewOverdueAt ? 'OVERDUE' : ''),
  )
    .trim()
    .toUpperCase();
  const showPeriodicReviewBanner = !!(
    profile.activePeriodicReviewCycleId || profile.periodicReviewOverdueAt
  );
  const periodicReviewMessage =
    periodicReviewStatus === 'REJECTED'
      ? 'Periodic review was rejected. Trading restrictions remain in place until compliance resolves the cycle.'
      : periodicReviewStatus === 'EDD_UNDER_REVIEW'
        ? 'Your periodic review EDD submission is under compliance review.'
        : periodicReviewStatus === 'CDD_UNDER_REVIEW'
          ? 'Your periodic review CDD submission is under compliance review.'
          : periodicReviewStatus === 'PENDING_EDD_INPUT'
            ? 'Additional EDD information is required for your periodic review.'
            : profile.periodicReviewOverdueAt
              ? 'Periodic review is due and waiting to be triggered after current restrictions are cleared.'
              : 'Periodic review is active. Complete the required response to continue.';

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
                      {statusLabel.replace(/_/g, ' ')}
                  </span>
                  {showVerifyButton && (
                      <button 
                          onClick={() => navigate('/verification')}
                          className={`px-4 py-2 ${isBlocked ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-primary hover:bg-blue-700'} text-white text-sm font-bold rounded-lg transition-colors`}
                      >
                          {isBlocked ? 'Retry' : 'View Detail'}
                      </button>
                  )}
              </div>
          </div>
          {!isApproved && (
              <div className={`p-4 ${isRejected ? 'bg-red-50/50' : 'bg-gray-50/50'}`}>
                  <div className="flex items-start gap-3 text-sm text-gray-600">
                      <AlertCircle size={16} className={`mt-0.5 ${isRejected ? 'text-red-600' : 'text-brand-primary'}`} />
                      <div>
                        <p>
                        {isExpired
                          ? 'Your CDD document has expired. Please re-initiate CDD verification.'
                          : isBlocked
                            ? 'Compliance case rejected. Please re-initiate verification.'
                            : isFinalPending
                              ? 'EDD approved. Waiting for final management approval.'
                              : isInProgress && onboardingStatus === 'NONE'
                              ? 'Start onboarding to unlock trading features.'
                              : 'Complete onboarding (CDD/EDD) to unlock trading features.'}
                        </p>
                      </div>
                  </div>
              </div>
          )}
      </motion.div>

      {showPeriodicReviewBanner && (
        <motion.div
          layout
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-amber-50 rounded-xl shadow-sm border border-amber-200 overflow-hidden"
        >
          <div className="p-6 border-b border-amber-100 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-amber-900">Periodic Review</h3>
              <p className="text-sm text-amber-700 mt-1">
                {periodicReviewMessage}
              </p>
            </div>
            <button
              onClick={() => navigate('/verification')}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-lg transition-colors"
            >
              Open Review
            </button>
          </div>
          <div className="px-6 py-4 text-sm text-amber-800 flex flex-wrap gap-4">
            <span>Status: {periodicReviewStatus || 'ACTIVE'}</span>
            {profile.activePeriodicReviewCycle?.cycleNo && (
              <span>Cycle: {profile.activePeriodicReviewCycle.cycleNo}</span>
            )}
            {profile.nextReviewAt && (
              <span>Next Review At: {new Date(profile.nextReviewAt).toLocaleDateString()}</span>
            )}
          </div>
        </motion.div>
      )}

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
