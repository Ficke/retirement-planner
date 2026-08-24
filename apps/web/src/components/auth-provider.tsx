import { AuthProvider as FirebaseAuthProvider } from '@/lib/firebase/auth-context';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <FirebaseAuthProvider>{children}</FirebaseAuthProvider>;
}
