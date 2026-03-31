import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const AdminInviteActivate = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => params.get('token') || '', [params]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [userNo, setUserNo] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setError('Invalid invitation link: missing token.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL}/auth/admin-invitations/${encodeURIComponent(token)}`,
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.message || 'Invitation link is unavailable.');
        }

        setEmail(payload.email || '');
        setUserNo(payload.userNo || '');
        setExpiresAt(payload.expiresAt || '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invitation link is unavailable.');
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!token) {
      setError('Invalid invitation link: missing token.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/admin-invitations/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || 'Activation failed.');
      }

      setSuccess('Activation succeeded. Redirecting to sign-in...');
      setTimeout(() => {
        navigate('/admin/login');
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white border border-gray-200 shadow-sm rounded-xl p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Admin Invitation Activation</h1>
          <p className="text-sm text-gray-500 mt-1">
            Set your password and activate the admin account from this invitation.
          </p>
        </div>

        {loading ? <div className="text-sm text-gray-500">Validating invitation...</div> : null}

        {!loading && !error ? (
          <div className="text-xs text-gray-600 space-y-1">
            <div>Email: {email}</div>
            <div>User No: {userNo || 'N/A'}</div>
            <div>Expires At: {expiresAt ? new Date(expiresAt).toLocaleString() : 'N/A'}</div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {success}
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">New Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
              minLength={6}
              required
              className="w-full px-3 py-2 border border-admin-border rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setError(null);
              }}
              minLength={6}
              required
              className="w-full px-3 py-2 border border-admin-border rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
            />
          </div>
          <button
            type="submit"
            disabled={loading || submitting || !email}
            className="w-full py-2 rounded-md bg-gray-900 text-white hover:bg-black disabled:opacity-60"
          >
            {submitting ? 'Submitting...' : 'Activate Account'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminInviteActivate;
