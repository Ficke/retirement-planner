import { useEffect, useRef } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Home from '@/app/page';
import SignInPage from '@/app/auth/signin/page';
import SignUpPage from '@/app/auth/signup/page';
import { NotFound } from '@/components/not-found';
import { useAuth } from '@/lib/firebase';
import { setAnalyticsUserId, setAnalyticsUserStatus, trackPageView } from '@/lib/analytics';
import { CLIENT_ROUTES } from '@/lib/client-routes';

export function AppRouter() {
  const location = useLocation();
  const { loading, user } = useAuth();
  const trackedLocation = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;

    setAnalyticsUserStatus(user ? 'signed_in' : 'guest');
    setAnalyticsUserId(user?.uid ?? null);

    const locationKey = `${location.pathname}${location.search}`;
    if (trackedLocation.current === locationKey) return;
    trackedLocation.current = locationKey;
    trackPageView();
  }, [loading, location.pathname, location.search, user]);

  return (
    <Routes>
      <Route path={CLIENT_ROUTES.home} element={<Home />} />
      <Route path={CLIENT_ROUTES.signIn} element={<SignInPage />} />
      <Route path={CLIENT_ROUTES.signUp} element={<SignUpPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
