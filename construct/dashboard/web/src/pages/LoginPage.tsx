import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

type AuthStatus = { authenticated: boolean; hasCredentials: boolean };

export function LoginPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleRegister() {
    setStatus('loading');
    setErrorMsg('');
    try {
      const options = await api.post<Record<string, unknown>>('/auth/register/options');
      const credential = await startRegistration({ optionsJSON: options as never });
      await api.post('/auth/register/verify', credential);
      navigate('/goals', { replace: true });
    } catch (err) {
      setStatus('error');
      if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Registration failed');
      }
    }
  }

  async function handleLogin() {
    setStatus('loading');
    setErrorMsg('');
    try {
      const options = await api.post<Record<string, unknown>>('/auth/login/options');
      const credential = await startAuthentication({ optionsJSON: options as never });
      await api.post('/auth/login/verify', credential);
      navigate('/goals', { replace: true });
    } catch (err) {
      setStatus('error');
      if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Login failed');
      }
    }
  }

  async function handleAuto() {
    setStatus('loading');
    setErrorMsg('');
    try {
      const authStatus = await api.get<AuthStatus>('/auth/status');
      if (authStatus.hasCredentials) {
        await handleLogin();
      } else {
        await handleRegister();
      }
    } catch {
      // If status check fails, try login first, then register
      await handleLogin();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm space-y-6 p-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">Goal Tracker</h1>
          <p className="text-gray-400 text-sm">Sign in with your passkey</p>
        </div>

        {status === 'error' && errorMsg && (
          <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
            {errorMsg}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleAuto}
            disabled={status === 'loading'}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
          >
            {status === 'loading' ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                <span>Authenticating...</span>
              </>
            ) : (
              <span>Sign in with Passkey</span>
            )}
          </button>

          <div className="flex gap-2">
            <button
              onClick={handleLogin}
              disabled={status === 'loading'}
              className="flex-1 text-sm text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed py-2 px-3 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
            >
              Login
            </button>
            <button
              onClick={handleRegister}
              disabled={status === 'loading'}
              className="flex-1 text-sm text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed py-2 px-3 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
            >
              Register
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
