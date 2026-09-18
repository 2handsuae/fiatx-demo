import { useEffect, useState } from 'react';

const STORAGE_KEY = 'admin_simulation_mode';
const COOKIE_KEY = 'shared_simulation_mode';
const EVENT_NAME = 'admin-simulation-mode-changed';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

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

  const cookieValue = parseBoolean(readSimulationCookie());
  if (cookieValue !== null) {
    localStorage.setItem(STORAGE_KEY, cookieValue ? 'true' : 'false');
    return cookieValue;
  }

  return localStorage.getItem(STORAGE_KEY) === 'true';
};

export const setSimulationModeEnabled = (enabled: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(enabled ? 'true' : 'false')}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  window.dispatchEvent(
    new CustomEvent(EVENT_NAME, {
      detail: enabled,
    }),
  );
};

export const useSimulationMode = () => {
  const [enabled, setEnabled] = useState(getSimulationModeEnabled);

  useEffect(() => {
    const sync = () => {
      setEnabled(getSimulationModeEnabled());
    };

    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener('storage', sync);

    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return {
    enabled,
    setEnabled: (next: boolean) => {
      setSimulationModeEnabled(next);
      setEnabled(next);
    },
  };
};
