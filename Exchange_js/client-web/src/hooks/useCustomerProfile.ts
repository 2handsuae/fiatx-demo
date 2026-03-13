import { useEffect, useState } from 'react';

export interface CustomerProfileData {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName?: string | null;
  customerType: string;
  publicStatus: string;
  actions?: Array<{ type: string; payload?: Record<string, unknown> }>;
  cddStatus: string;
  amlRiskTier: string;
  eddRequired: boolean;
  eddStatus: string;
  complianceStatus: string;
  cddDocumentExpiresAt?: string | null;
  finalApprovalStatus?: string;
  finalApprovalReason?: string | null;
  finalApprovalReviewerId?: string | null;
  finalApprovalReviewedAt?: string | null;
  nextReviewAt?: string | null;
  currentCddCaseId?: string | null;
  currentEddCaseId?: string | null;
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
          publicStatus: data.publicStatus || 'NONE',
          actions: Array.isArray(data.actions) ? data.actions : [],
          cddStatus: data.cddStatus || 'NOT_STARTED',
          amlRiskTier: data.amlRiskTier || 'LOW',
          eddRequired: !!data.eddRequired,
          eddStatus: data.eddStatus || 'NOT_REQUIRED',
          complianceStatus: data.complianceStatus || 'NONE',
          cddDocumentExpiresAt: data.cddDocumentExpiresAt || null,
          finalApprovalStatus: data.finalApprovalStatus || 'NOT_REQUIRED',
          finalApprovalReason: data.finalApprovalReason || null,
          finalApprovalReviewerId: data.finalApprovalReviewerId || null,
          finalApprovalReviewedAt: data.finalApprovalReviewedAt || null,
          nextReviewAt: data.nextReviewAt || null,
          currentCddCaseId: data.currentCddCaseId || null,
          currentEddCaseId: data.currentEddCaseId || null,
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
