import { Route, Routes } from 'react-router-dom';
import Home from '@/app/page';
import SignInPage from '@/app/auth/signin/page';
import SignUpPage from '@/app/auth/signup/page';
import { NotFound } from '@/components/not-found';
import { CLIENT_ROUTES } from '@/lib/client-routes';

export function AppRouter() {
  return (
    <Routes>
      <Route path={CLIENT_ROUTES.home} element={<Home />} />
      <Route path={CLIENT_ROUTES.signIn} element={<SignInPage />} />
      <Route path={CLIENT_ROUTES.signUp} element={<SignUpPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
