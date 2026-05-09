"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase";
import { useMigration } from "@/hooks/useMigration";
import { usePlan } from "@/state/usePlan";
import { Sidebar, type PageId } from "@/components/retire/sidebar";
import { TweaksPanel, type SidebarStyle } from "@/components/retire/tweaks-panel";
import { PageOverview } from "@/components/retire/pages/overview";
import { PagePlan } from "@/components/retire/pages/plan";
import { PageAccounts } from "@/components/retire/pages/accounts";
import { PageProjections } from "@/components/retire/pages/projections";
import { PageDecisions } from "@/components/retire/pages/decisions";
import { PageAssumptions } from "@/components/retire/pages/assumptions";
import { PageSettings } from "@/components/retire/pages/settings";

const PAGES: Record<PageId, { label: string; Comp: () => React.ReactElement }> = {
  overview:    { label: "Overview",    Comp: PageOverview },
  plan:        { label: "Profile",     Comp: PagePlan },
  accounts:    { label: "Accounts",    Comp: PageAccounts },
  projections: { label: "Projections", Comp: PageProjections },
  decisions:   { label: "Decisions",   Comp: PageDecisions },
  assumptions: { label: "Assumptions", Comp: PageAssumptions },
  settings:    { label: "Settings",    Comp: PageSettings },
};

export default function Home() {
  const { migrationStatus, isReady } = useMigration();
  const { user, loading } = useAuth();
  const router = useRouter();

  const loadAccounts = usePlan(s => s.loadAccounts);
  const runMainSimulation = usePlan(s => s.runMainSimulation);
  const runSSAnalysis = usePlan(s => s.runSSAnalysis);
  const runSpendingAnalysis = usePlan(s => s.runSpendingAnalysis);
  const runRetirementAgeAnalysis = usePlan(s => s.runRetirementAgeAnalysis);

  const [page, setPage] = useState<PageId>("overview");
  const [sidebarStyle, setSidebarStyle] = useState<SidebarStyle>("expanded");
  const [darkMode, setDarkMode] = useState(false);
  const [showTweaks, setShowTweaks] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/auth/signin");
  }, [user, loading, router]);

  // Bootstrap data on mount once auth is ready.
  useEffect(() => {
    if (!user || !isReady) return;
    (async () => {
      await loadAccounts();
      runMainSimulation();
      runSSAnalysis();
      runSpendingAnalysis();
      runRetirementAgeAnalysis();
    })();
  }, [user, isReady, loadAccounts, runMainSimulation, runSSAnalysis, runSpendingAnalysis, runRetirementAgeAnalysis]);

  if (loading || !isReady || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">
            {loading ? "Loading…" : migrationStatus === "running" ? "Updating account system…" : "Initializing…"}
          </p>
        </div>
      </div>
    );
  }

  const collapsed = sidebarStyle === "rail";
  const sidebarMode = sidebarStyle === "minimal" ? "minimal" : "default";
  const Page = PAGES[page].Comp;
  const userName = user.displayName || user.email?.split("@")[0] || "You";
  const userEmail = user.email || "";

  return (
    <div className="retire-app" data-theme={darkMode ? "dark" : "light"}>
      <div className="r-app" data-collapsed={collapsed} data-sidebar={sidebarMode}>
        <Sidebar
          active={page}
          onNav={setPage}
          collapsed={collapsed}
          onToggleCollapsed={() => setSidebarStyle(collapsed ? "expanded" : "rail")}
          userName={userName}
          userEmail={userEmail}
        />
        <div className="r-content">
          <div className="r-topbar">
            <div className="r-crumbs">
              <span>Retire</span>
              <span className="slash">/</span>
              <b>{PAGES[page].label}</b>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="r-btn r-btn-ghost"
                onClick={() => setShowTweaks(s => !s)}
                title="Tweaks"
              >
                Tweaks
              </button>
            </div>
          </div>
          <div className="r-page">
            <Page />
          </div>
        </div>
      </div>

      {showTweaks && (
        <TweaksPanel
          sidebarStyle={sidebarStyle}
          onSidebarStyle={setSidebarStyle}
          darkMode={darkMode}
          onDarkMode={setDarkMode}
        />
      )}
    </div>
  );
}
