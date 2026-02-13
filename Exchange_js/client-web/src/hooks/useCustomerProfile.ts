import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

export interface CustomerProfileData {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName?: string | null;
  authStatus: string;
  authLevel: string;
  customerType: string;
  onboardingStage: string;
  canTradeSwap: boolean;
  canTradeWithdraw: boolean;
  onboardingRejectReason?: string | null;
  activeCddCaseId?: string | null;
  activeEddCaseId?: string | null;
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
           // window.location.href = '/login'; // Don't redirect automatically
           setLoading(false);
           return;
      }

      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      const payload = JSON.parse(jsonPayload);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/customers/${payload.sub}`, {
          headers: {
              'Authorization': `Bearer ${token}`
          }
      });

      if (response.ok) {
          const data = await response.json();
          setProfile({
            ...data,
            customerType: data.customerType || 'UNKNOWN',
            onboardingStage: data.onboardingStage || 'REGISTERED',
            canTradeSwap: !!data.canTradeSwap,
            canTradeWithdraw: !!data.canTradeWithdraw,
            onboardingRejectReason: data.onboardingRejectReason || null,
            activeCddCaseId: data.activeCddCaseId || null,
            activeEddCaseId: data.activeEddCaseId || null,
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

    let socket: Socket;
    const token = localStorage.getItem('customer_token');
    
    if (token) {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = JSON.parse(decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')));
        const customerId = jsonPayload.sub;

        socket = io(`${import.meta.env.VITE_API_URL}`, {
            query: { customerId }
        });

        socket.on('status_updated', (data: { status: string; authLevel: string }) => {
            setProfile(prev => prev ? {
                ...prev,
                authStatus: data.status,
                authLevel: data.authLevel,
            } : null);
        });
    }

    return () => {
        if (socket) socket.disconnect();
    };
  }, []);

  return { profile, loading, error, refreshProfile: fetchProfile };
};
