import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@/app/globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from '@/app-router';
import { AuthProvider } from '@/components/auth-provider';
import { AppErrorBoundary } from '@/components/error-boundary';
import { ThemeProvider } from '@/components/theme-provider';
import { prefetchSimulationEngine } from '@/engine/mc';

const root = document.getElementById('root');
if (!root) throw new Error('Application root element is missing');

prefetchSimulationEngine();

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <AppRouter />
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
