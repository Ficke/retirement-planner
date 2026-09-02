import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { NotFound } from '@/components/not-found';
import { useAuth } from '@/lib/firebase';
import { setAnalyticsUserId, setAnalyticsUserStatus } from '@/lib/analytics';
import { APP_PAGES, appPageForPath, CLIENT_ROUTES } from '@/lib/client-routes';

const Home = lazy(() => import('@/app/page'));
const PagePlan = lazy(() =>
  import('@/components/retire/pages/plan').then(({ PagePlan }) => ({ default: PagePlan })),
);
const PageAccounts = lazy(() =>
  import('@/components/retire/pages/accounts').then(({ PageAccounts }) => ({ default: PageAccounts })),
);
const PageProfile = lazy(() =>
  import('@/components/retire/pages/profile').then(({ PageProfile }) => ({ default: PageProfile })),
);
const PageSettings = lazy(() =>
  import('@/components/retire/pages/settings').then(({ PageSettings }) => ({ default: PageSettings })),
);
const SignInPage = lazy(() => import('@/app/auth/signin/page'));
const SignUpPage = lazy(() => import('@/app/auth/signup/page'));

export function AppRouter() {
  const { loading, user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;

    setAnalyticsUserStatus(user ? 'signed_in' : 'guest');
    setAnalyticsUserId(user?.uid ?? null);
  }, [loading, user]);

  useEffect(() => {
    const appPage = appPageForPath(location.pathname);
    const pageTitle = appPage
      ? APP_PAGES[appPage].label
      : location.pathname === CLIENT_ROUTES.signIn
        ? 'Sign in'
        : location.pathname === CLIENT_ROUTES.signUp
          ? 'Sign up'
          : location.pathname === CLIENT_ROUTES.root
            ? null
            : 'Page not found';
    document.title = pageTitle ? `${pageTitle} · RetirePlan` : 'RetirePlan';
  }, [location.pathname]);

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading…</div>}>
      <Routes>
        <Route path={CLIENT_ROUTES.root} element={<Home />}>
          <Route index element={<Navigate to={CLIENT_ROUTES.plan} replace />} />
          <Route path={CLIENT_ROUTES.plan} element={<PagePlan />} />
          <Route path={CLIENT_ROUTES.accounts} element={<PageAccounts />} />
          <Route path={CLIENT_ROUTES.profile} element={<PageProfile />} />
          <Route path={CLIENT_ROUTES.settings} element={<PageSettings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path={CLIENT_ROUTES.signIn} element={<SignInPage />} />
        <Route path={CLIENT_ROUTES.signUp} element={<SignUpPage />} />
      </Routes>
    </Suspense>
  );
}
