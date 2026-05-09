import { useEffect, useState } from 'react';
import {
  CustomerSessionError,
  customerFetch,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';

export interface CustomerProfileData {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName?: string | null;
  customerType: string;
  onboardingStatus?: string;
  adminStatus?: string;
  complianceStatus?: string;
  restrictions?: string[];
  actions?: Array<{ type: string; payload?: Record<string, unknown> }>;
  riskRating: string;
  eddRequired: boolean;
  cddDocumentExpiresAt?: string | null;
  nextReviewAt?: string | null;
  activePeriodicReviewCycleId?: string | null;
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
  investorTier?: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export const useCustomerProfile = () => {
  const [profile, setProfile] = useState<CustomerProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProfile = async () => {
    setLoading(true);
    setError('');
    try {
      if (!localStorage.getItem('customer_token')) {
        setProfile(null);
        return;
      }

      const response = await customerFetch(`${import.meta.env.VITE_API_URL}/onboarding/me`);

      if (response.ok) {
        const data = await response.json();
        setProfile({
          ...data,
          customerType: data.customerType || 'UNKNOWN',
          onboardingStatus: data.onboardingStatus || 'NONE',
          adminStatus: data.adminStatus || 'INACTIVE',
          complianceStatus: data.complianceStatus || 'CLEAR',
          restrictions: (() => {
            if (Array.isArray(data.restrictions)) return data.restrictions;
            if (typeof data.restrictions === 'string') {
              try { return JSON.parse(data.restrictions); } catch { return []; }
            }
            return [];
          })(),
          actions: Array.isArray(data.actions) ? data.actions : [],
          riskRating: data.riskRating || 'LOW',
          eddRequired: !!data.eddRequired,
          cddDocumentExpiresAt: data.cddDocumentExpiresAt || null,
          nextReviewAt: data.nextReviewAt || null,
          activePeriodicReviewCycleId: data.activePeriodicReviewCycleId || null,
          activePeriodicReviewCycle: data.activePeriodicReviewCycle || null,
          investorTier: data.investorTier || 'STANDARD',
        });
      } else {
        setError(await getCustomerApiErrorMessage(response, 'Failed to load profile'));
      }
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) {
        setProfile(null);
        setError('');
        return;
      }

      setError(error instanceof Error ? error.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  return { profile, loading, error, refreshProfile: fetchProfile };
};
