import { Route, Routes } from 'react-router-dom';
import Home from '@/app/page';
import SignInPage from '@/app/auth/signin/page';
import SignUpPage from '@/app/auth/signup/page';
import { NotFound } from '@/components/not-found';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/signin" element={<SignInPage />} />
      <Route path="/auth/signup" element={<SignUpPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
