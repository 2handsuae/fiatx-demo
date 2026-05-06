import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'form' | 'success' | 'error'>('form');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/password-reset/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Reset failed');
      }
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Link is invalid or expired');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-adm-panel">
        <div className="bg-adm-card p-8 rounded-lg shadow max-w-md w-full text-center">
          <h2 className="text-xl font-semibold text-adm-t1 mb-4">Invalid Link</h2>
          <p className="text-adm-t2 mb-4">No reset token found in the URL.</p>
          <button onClick={() => navigate('/login')} className="text-adm-blue hover:underline">
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-adm-panel">
        <div className="bg-adm-card p-8 rounded-lg shadow max-w-md w-full text-center">
          <h2 className="text-xl font-semibold text-adm-t1 mb-4">Password Reset Complete</h2>
          <p className="text-adm-t2 mb-6">Your password has been successfully reset.</p>
          <button onClick={() => navigate('/login')} className="bg-adm-blue text-white px-6 py-2 rounded hover:opacity-90">
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-adm-panel">
      <div className="bg-adm-card p-8 rounded-lg shadow max-w-md w-full">
        <h2 className="text-xl font-semibold text-adm-t1 mb-6">Set New Password</h2>
        {(status === 'error' || errorMsg) && (
          <div className="bg-red-50 border border-adm-red text-adm-red p-3 rounded mb-4 text-sm">
            {errorMsg || 'Link is invalid or expired.'}
            <button onClick={() => navigate('/login')} className="block mt-2 text-adm-blue hover:underline text-sm">
              Request a new reset
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-adm-t2 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full border border-adm-border rounded px-3 py-2 bg-adm-bg text-adm-t1"
              minLength={8}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-adm-t2 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border border-adm-border rounded px-3 py-2 bg-adm-bg text-adm-t1"
              minLength={8}
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-adm-blue text-white py-2 rounded hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
