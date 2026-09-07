import { useCallback, useEffect, useState } from 'react';
import { customerFetch } from '../utils/customerFetch';

export interface TierUpgradeOverview {
  tradingTier: string;
  limits: Array<{ operationType: string; period: string; basicLimit?: string; premiumLimit?: string }>;
  application: { upgradeNo: string; stage: 'SUBMIT_MATERIALS' | 'UNDER_REVIEW' | 'PENDING_DECISION' | 'APPROVED' | 'REJECTED' } | null;
  canApply: boolean;
}

export const useTierUpgrade = () => {
  const [data, setData] = useState<TierUpgradeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/tier-upgrade`);
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, reload };
};
