import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { signIn, useAuth } from '@/lib/firebase';
import { setAnalyticsUserId, setAnalyticsUserStatus, trackEvent } from '@/lib/analytics';
import { CLIENT_ROUTES } from '@/lib/client-routes';

export default function SignInPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Redirect to home if already logged in
  useEffect(() => {
    if (!loading && user) {
      navigate(CLIENT_ROUTES.plan);
    }
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const { user, error: signInError } = await signIn(email, password);

      if (signInError) {
        setError(signInError.message);
        setIsLoading(false);
      } else if (user) {
        setAnalyticsUserStatus('signed_in');
        setAnalyticsUserId(user.uid);
        trackEvent('login', { method: 'email' });
        // Wait a moment for auth state to propagate
        await new Promise(resolve => setTimeout(resolve, 500));
        // Use window.location for hard navigation to avoid race conditions
        window.location.href = '/';
      }
    } catch (err) {
      console.error('Sign in error:', err);
      setError('An error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-background flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Sign in to sync your plan to your account and use it across devices
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>

            <p className="text-muted-foreground text-center text-sm">
              Don&apos;t have an account?{' '}
              <Link to={CLIENT_ROUTES.signUp} className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
            <p className="text-muted-foreground text-center text-sm">
              <Link to={CLIENT_ROUTES.plan} className="hover:underline">
                Continue without an account
              </Link>{' '}
              Your data stays in this browser.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
