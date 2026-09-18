import { useEffect, useState } from 'react';
import { adminFetch } from '../utils/adminFetch';

export type VerdictButton = { key: string; label: string; source: 'ENGINE' | 'OFFICER' };

/**
 * ⚡ 面板按钮清单 —— 从后端拉，不再手抄。
 *
 * 2026-08-29 之前三个详情页各手抄一份 key/label 常量，靠注释提醒「改一侧务必
 * 同步改另一侧」，没有任何机制保证一致。按钮表当时实际有 6 份。
 */
export function useVerdictButtons(domain: 'deposit' | 'withdraw' | 'swap') {
  const [buttons, setButtons] = useState<VerdictButton[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/${domain}-sumsub/demo/verdict-buttons`)
      .then((r) => r.json())
      .then((d) => { if (alive) setButtons(d.buttons ?? []); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [domain]);
  return { buttons, loading };
}
