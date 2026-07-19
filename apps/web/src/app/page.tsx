"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/firebase";
import { usePlan } from "@/state/usePlan";
import { Sidebar, type PageId } from "@/components/retire/sidebar";
import { Button } from "@/components/ui/button";
import { PageOverview } from "@/components/retire/pages/overview";
import { PagePlan } from "@/components/retire/pages/plan";
import { PageAccounts } from "@/components/retire/pages/accounts";
import { PageProjections } from "@/components/retire/pages/projections";
import { PageSettings } from "@/components/retire/pages/settings";

const PAGES: Record<PageId, { label: string; Comp: () => React.ReactElement }> = {
  overview:    { label: "Overview",    Comp: PageOverview },
  projections: { label: "Projections", Comp: PageProjections },
  plan:        { label: "Profile",     Comp: PagePlan },
  accounts:    { label: "Accounts",    Comp: PageAccounts },
  settings:    { label: "Settings",    Comp: PageSettings },
};

export default function Home() {
  const { user, loading } = useAuth();
  const bootstrap = usePlan((s) => s.bootstrap);
  const bootstrapped = usePlan((s) => s.bootstrapped);
  const { resolvedTheme, setTheme } = useTheme();

  const [page, setPage] = useState<PageId>("overview");
  const [collapsed, setCollapsed] = useState(false);

  // The app is fully usable without an account (local data mode). Bootstrap
  // re-runs on every auth change so sign-in/out swaps the data source.
  useEffect(() => {
    if (loading) return;
    bootstrap(user ? { id: user.uid } : null);
  }, [loading, user, bootstrap]);

  if (loading || !bootstrapped) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="border-primary mx-auto h-8 w-8 animate-spin rounded-full border-b-2"></div>
          <p className="text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  const Page = PAGES[page].Comp;
  const isDark = resolvedTheme === "dark";

  return (
    <div className="bg-background text-foreground flex h-screen min-h-screen">
      <Sidebar
        active={page}
        onNav={setPage}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        user={user ? { name: user.displayName || user.email?.split("@")[0] || "You", email: user.email || "" } : null}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 border-border sticky top-0 z-20 flex min-h-14 items-center justify-between gap-4 border-b px-7 py-3 backdrop-blur">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span>Retire</span>
            <span className="opacity-40">/</span>
            <b className="text-foreground font-semibold">{PAGES[page].label}</b>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1400px] space-y-4 px-7 pt-6 pb-16">
            <Page />
          </div>
        </main>
      </div>
    </div>
  );
}
