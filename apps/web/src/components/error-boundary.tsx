import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="bg-background flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">Something went wrong</CardTitle>
            <CardDescription>Reload the application. Your browser-only plan remains stored locally.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {import.meta.env.DEV && (
              <p className="bg-muted text-muted-foreground break-all rounded-md p-3 font-mono text-sm">
                {this.state.error.message}
              </p>
            )}
            <div className="flex gap-2">
              <Button className="w-full" onClick={() => this.setState({ error: null })}>Try again</Button>
              <Button className="w-full" variant="outline" onClick={() => window.location.assign('/')}>Reload</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}
