import { useEffect, useState } from 'react';
import {
  CustomerSessionError,
  customerFetch,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';

/** /onboarding/me 下发的「可以告知客户」的限制行；SILENT 便签不在其中。 */
export interface DisclosedRestrictionView {
  restrictionNo: string;
  cause: string;
  scopes: string[];
  label: string;
  reason: string;
  openedAt: string;
}

export interface CustomerProfileData {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName?: string | null;
  customerType: string;
  /** 唯一状态轴。PROSPECT / IN_VERIFICATION / PENDING_APPROVAL / ACTIVE / REJECTED / WITHDRAWN / OFFBOARDED */
  lifecycle: string;
  /** 仅 DISCLOSED 限制贡献的能力集。响应体里【没有】blocked —— 见 restrictedCapabilities.ts。 */
  disclosedBlocked: string[];
  disclosed: DisclosedRestrictionView[];
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
          lifecycle: String(data.lifecycle || 'PROSPECT').toUpperCase(),
          // 后端已把 SILENT 过滤干净并展开好 scope，前端零加工——
          // 任何"更聪明"的归一化都可能把 SILENT 泄回客户面。
          disclosedBlocked: Array.isArray(data.disclosedBlocked) ? data.disclosedBlocked : [],
          disclosed: Array.isArray(data.disclosed) ? data.disclosed : [],
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
