import { useEffect, useState } from 'react';
import { customerFetch } from '../utils/customerFetch';
import { ProfileBanner, type ProfileBannerData } from './ProfileBanner';

/* ────────────────────────────────────────────────────────────────
 *  ProfileBannerStack — fetches and renders compliance banners.
 *  Calls GET /customers/me/profile-banners on mount and whenever
 *  the user returns to the tab (visibilitychange).
 * ──────────────────────────────────────────────────────────────── */

export function ProfileBannerStack() {
  const [banners, setBanners] = useState<ProfileBannerData[]>([]);

  const load = async () => {
    try {
      const res = await customerFetch(
        `${import.meta.env.VITE_API_URL}/customers/me/profile-banners`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { banners?: ProfileBannerData[] };
      setBanners(Array.isArray(data.banners) ? data.banners : []);
    } catch {
      // Silently ignore — banners are advisory; auth failures redirect via customerFetch.
    }
  };

  useEffect(() => {
    void load();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!banners.length) return null;

  return (
    <div className="space-y-2">
      {banners.map((banner) => (
        <ProfileBanner key={banner.id} banner={banner} />
      ))}
    </div>
  );
}
