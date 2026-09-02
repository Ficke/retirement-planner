import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { CLIENT_ROUTES } from '@/lib/client-routes';

export function NotFound() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="leading-none font-semibold">Page not found</h1>
          <CardDescription>The page you requested does not exist.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full"><Link to={CLIENT_ROUTES.plan}>Go to plan</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
