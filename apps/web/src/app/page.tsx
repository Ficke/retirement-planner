"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase";
import { useMigration } from "@/hooks/useMigration";
import { usePlan } from "@/state/usePlan";
import { Sidebar, type PageId } from "@/components/retire/sidebar";
import { TweaksPanel, type SidebarStyle } from "@/components/retire/tweaks-panel";
import { Button } from "@/components/ui/button";
import { PageOverview } from "@/components/retire/pages/overview";
import { PagePlan } from "@/components/retire/pages/plan";
import { PageAccounts } from "@/components/retire/pages/accounts";
import { PageProjections } from "@/components/retire/pages/projections";
import { PageSensitivity } from "@/components/retire/pages/sensitivity";
import { PageAssumptions } from "@/components/retire/pages/assumptions";
import { PageSettings } from "@/components/retire/pages/settings";

const PAGES: Record<PageId, { label: string; Comp: () => React.ReactElement }> = {
  overview:    { label: "Overview",    Comp: PageOverview },
  sensitivity: { label: "Sensitivity", Comp: PageSensitivity },
  projections: { label: "Projections", Comp: PageProjections },
  plan:        { label: "Profile",     Comp: PagePlan },
  accounts:    { label: "Accounts",    Comp: PageAccounts },
  assumptions: { label: "Assumptions", Comp: PageAssumptions },
  settings:    { label: "Settings",    Comp: PageSettings },
};

export default function Home() {
  const { migrationStatus, isReady } = useMigration();
  const { user, loading } = useAuth();
  const router = useRouter();

  const [page, setPage] = useState<PageId>("overview");
  const [sidebarStyle, setSidebarStyle] = useState<SidebarStyle>("expanded");
  const [darkMode, setDarkMode] = useState(false);
  const [showTweaks, setShowTweaks] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/auth/signin");
  }, [user, loading, router]);
  // Bootstrap (loadProfile + loadAccounts → schedules all sims) is owned by useMigration.

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
    <div
      className={darkMode ? "retire-app dark" : "retire-app"}
      data-theme={darkMode ? "dark" : "light"}
      data-sidebar={sidebarMode}
    >
      <div className="bg-background text-foreground flex h-screen min-h-screen">
        <Sidebar
          active={page}
          onNav={setPage}
          collapsed={collapsed}
          onToggleCollapsed={() => setSidebarStyle(collapsed ? "expanded" : "rail")}
          userName={userName}
          userEmail={userEmail}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background/80 border-border sticky top-0 z-20 flex min-h-14 items-center justify-between gap-4 border-b px-7 py-3 backdrop-blur">
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <span>Retire</span>
              <span className="opacity-40">/</span>
              <b className="text-foreground font-semibold">{PAGES[page].label}</b>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTweaks((s) => !s)}
              >
                Tweaks
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[1400px] space-y-4 px-7 pt-6 pb-16">
              <Page />
            </div>
          </main>
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
