import { useCallback, useEffect, useState } from 'react';
import {
  CustomerSessionError,
  customerFetch,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';

export const useTradingReadiness = () => {
  const [tradingReady, setTradingReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await customerFetch(`${import.meta.env.VITE_API_URL}/client/trading-readiness`);

      if (response.ok) {
        const data = await response.json();
        setTradingReady(!!data.tradingReady);
      } else {
        setTradingReady(false);
        setError(await getCustomerApiErrorMessage(response, 'Failed to check trading readiness'));
      }
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) {
        setTradingReady(false);
        setError('');
        return;
      }

      setTradingReady(false);
      setError(error instanceof Error ? error.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  return { tradingReady, loading, error, refetch: fetchReadiness };
};
