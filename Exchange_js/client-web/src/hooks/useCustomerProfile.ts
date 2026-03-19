import { useEffect, useState } from 'react';

export interface CustomerProfileData {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName?: string | null;
  customerType: string;
  onboardingStatus?: string;
  operatingStatus?: string;
  restrictionStatus?: string;
  complianceHoldStatus?: string;
  actions?: Array<{ type: string; payload?: Record<string, unknown> }>;
  amlRiskTier: string;
  eddRequired: boolean;
  cddDocumentExpiresAt?: string | null;
  nextReviewAt?: string | null;
  activePeriodicReviewCycleId?: string | null;
  periodicReviewOverdueAt?: string | null;
  periodicReviewOverdueReason?: string | null;
  activePeriodicReviewCycle?: {
    id: string;
    cycleNo: string;
    status: string;
    dueAt: string;
    triggeredAt?: string | null;
    clearedAt?: string | null;
    rejectedAt?: string | null;
    currentCddResponseId?: string | null;
    currentEddResponseId?: string | null;
    primaryAlertId?: string | null;
    primaryIncidentId?: string | null;
    resolutionReason?: string | null;
  } | null;
  investorClassification?: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export const useCustomerProfile = () => {
  const [profile, setProfile] = useState<CustomerProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('customer_token');
      if (!token) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL}/onboarding/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setProfile({
          ...data,
          customerType: data.customerType || 'UNKNOWN',
          onboardingStatus: data.onboardingStatus || 'NONE',
          operatingStatus: data.operatingStatus || 'INACTIVE',
          restrictionStatus: data.restrictionStatus || 'CLEAR',
          complianceHoldStatus: data.complianceHoldStatus || 'ACTIVE',
          actions: Array.isArray(data.actions) ? data.actions : [],
          amlRiskTier: data.amlRiskTier || 'LOW',
          eddRequired: !!data.eddRequired,
          cddDocumentExpiresAt: data.cddDocumentExpiresAt || null,
          nextReviewAt: data.nextReviewAt || null,
          activePeriodicReviewCycleId: data.activePeriodicReviewCycleId || null,
          periodicReviewOverdueAt: data.periodicReviewOverdueAt || null,
          periodicReviewOverdueReason: data.periodicReviewOverdueReason || null,
          activePeriodicReviewCycle: data.activePeriodicReviewCycle || null,
          investorClassification: data.investorClassification || 'RETAIL',
        });
      } else {
        let payload: any = {};
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem('customer_token');
          setProfile(null);

          const code = String(payload?.code || '').trim().toUpperCase();
          const message = String(payload?.message || '').trim();
          if (code === 'CUSTOMER_ACCOUNT_FROZEN') {
            const noticeMessage =
              message || '账号已冻结，禁止登录。请联系 WhatsApp 客服处理。';
            sessionStorage.setItem(
              'customer_login_notice',
              JSON.stringify({
                code,
                message: noticeMessage,
              }),
            );
          }

          setError('');
          return;
        }

        setError(String(payload?.message || 'Failed to load profile'));
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  return { profile, loading, error, refreshProfile: fetchProfile };
};
