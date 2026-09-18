import { useEffect, useState } from 'react';

const COOKIE_KEY = 'shared_simulation_mode';
const EVENT_NAME = 'client-simulation-mode-sync';

const parseBoolean = (value: string | null) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
};

const readSimulationCookie = () => {
  if (typeof document === 'undefined') {
    return null;
  }

  const match = document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${COOKIE_KEY}=`));

  if (!match) {
    return null;
  }

  return decodeURIComponent(match.slice(COOKIE_KEY.length + 1));
};

export const getSimulationModeEnabled = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  return parseBoolean(readSimulationCookie()) ?? false;
};

export const useSimulationMode = () => {
  const [enabled, setEnabled] = useState(getSimulationModeEnabled);

  useEffect(() => {
    const sync = () => {
      setEnabled(getSimulationModeEnabled());
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        sync();
      }
    };

    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('pageshow', sync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return {
    enabled,
  };
};
