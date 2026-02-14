import { useEffect, useState } from 'react';

export interface CustomerProfileData {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName?: string | null;
  customerType: string;
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
        setError('Failed to load profile');
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
