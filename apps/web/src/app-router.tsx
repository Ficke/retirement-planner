import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { NotFound } from '@/components/not-found';
import { useAuth } from '@/lib/firebase';
import { setAnalyticsUserId, setAnalyticsUserStatus } from '@/lib/analytics';
import { CLIENT_ROUTES } from '@/lib/client-routes';

const Home = lazy(() => import('@/app/page'));
const SignInPage = lazy(() => import('@/app/auth/signin/page'));
const SignUpPage = lazy(() => import('@/app/auth/signup/page'));

export function AppRouter() {
  const { loading, user } = useAuth();

  useEffect(() => {
    if (loading) return;

    setAnalyticsUserStatus(user ? 'signed_in' : 'guest');
    setAnalyticsUserId(user?.uid ?? null);
  }, [loading, user]);

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading…</div>}>
      <Routes>
        <Route path={CLIENT_ROUTES.home} element={<Home />} />
        <Route path={CLIENT_ROUTES.signIn} element={<SignInPage />} />
        <Route path={CLIENT_ROUTES.signUp} element={<SignUpPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
