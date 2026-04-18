'use client';

import { useState } from 'react';
import { login, signup } from './actions';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAction = async (action: 'login' | 'signup') => {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('email', email);
      formData.append('password', password);
      
      const errorMessage = action === 'login' 
        ? await login(formData)
        : await signup(formData);

      if (errorMessage) {
        setError(errorMessage);
      }
    } catch (err: any) {
      setError('문제가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20">
      <div className="w-full max-w-sm p-8 bg-background border border-border rounded-2xl shadow-xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">Thesis Assistant 📝</h1>
          <p className="text-sm text-muted-foreground mt-2">논문 작성을 위한 전용 연구원 로그인</p>
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5" htmlFor="email">이메일</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
              placeholder="you@university.edu"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5" htmlFor="password">비밀번호</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-3 text-xs text-red-500 bg-red-500/10 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => handleAction('login')}
              disabled={loading || !email || !password}
              className="flex-1 py-2.5 rounded-lg font-bold text-sm bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-500 hover:to-purple-500 hover:shadow-lg disabled:opacity-50 transition-all"
            >
              로그인
            </button>
            <button
              type="button"
              onClick={() => handleAction('signup')}
              disabled={loading || !email || !password}
              className="flex-1 py-2.5 rounded-lg font-bold text-sm bg-muted text-foreground hover:bg-muted/80 border border-border disabled:opacity-50 transition-all"
            >
              회원가입
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
