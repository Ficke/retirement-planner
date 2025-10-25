"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { InputsForm } from "@/components/inputs-form";
import { ModernAccountsManager } from "@/components/modern-accounts-manager";
import { AssumptionsPanel } from "@/components/assumptions-panel";
import { ResultsPanel } from "@/components/results-panel";
import { SimulationControls } from "@/components/simulation-controls";
import { SimulationAnalyzer } from "@/components/SimulationAnalyzer";
import { DeveloperTools } from "@/components/developer-tools";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMigration } from "@/hooks/useMigration";
import { useAuth } from "@/lib/firebase";

export default function Home() {
  const { migrationStatus, isReady } = useMigration();
  const { user, loading } = useAuth();
  const router = useRouter();

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/signin');
    }
  }, [user, loading, router]);

  // Show loading state while checking auth or during migration
  if (loading || !isReady || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">
            {loading ? 'Loading...' : migrationStatus === 'running' ? 'Updating account system...' : 'Initializing...'}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold">RetirePlan</h1>
            </div>
            <div className="flex items-center gap-4">
              <UserMenu />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </nav>
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Interactive Simulation Controls */}
          <SimulationControls />

          {/* Scenario Analysis */}
          <SimulationAnalyzer />

          {/* Simulation Results - Front and Center */}
          <ResultsPanel />

          {/* Modern Account Management - Top Level */}
          <ModernAccountsManager />

          {/* Configuration Options - Secondary */}
          <Tabs defaultValue="inputs" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="inputs">Inputs & Profile</TabsTrigger>
              <TabsTrigger value="assumptions">Market Assumptions</TabsTrigger>
            </TabsList>

            <TabsContent value="inputs" className="mt-6">
              <InputsForm />
            </TabsContent>

            <TabsContent value="assumptions" className="mt-6">
              <AssumptionsPanel />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Developer Tools - Only shown in development */}
      <DeveloperTools />
    </div>
  );
}
