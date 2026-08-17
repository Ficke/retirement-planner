"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Moon, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/firebase";
import { usePlan } from "@/state/usePlan";
import { Sidebar, type PageId } from "@/components/retire/sidebar";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PagePlan } from "@/components/retire/pages/plan";
import { PageProfile } from "@/components/retire/pages/profile";
import { PageAccounts } from "@/components/retire/pages/accounts";
import { PageSettings } from "@/components/retire/pages/settings";

const PAGES: Record<PageId, { label: string; Comp: () => React.ReactElement }> = {
  plan:        { label: "Plan",        Comp: PagePlan },
  accounts:    { label: "Accounts",    Comp: PageAccounts },
  profile:     { label: "Profile",     Comp: PageProfile },
  settings:    { label: "Settings",    Comp: PageSettings },
};

export default function Home() {
  const { user, cloudReady, loading, error: authError } = useAuth();
  const bootstrap = usePlan((s) => s.bootstrap);
  const bootstrapped = usePlan((s) => s.bootstrapped);
  const bootstrappedOwner = usePlan((s) => s.authUser?.id ?? null);
  const planError = usePlan((s) => s.error);
  const clearError = usePlan((s) => s.clearError);
  const { resolvedTheme, setTheme } = useTheme();

  const [page, setPage] = useState<PageId>("plan");
  const [collapsed, setCollapsed] = useState(false);

  // Preserve usable chart width on phones. The sidebar can still be expanded
  // explicitly, but it should not consume most of the initial viewport.
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const collapseOnSmallScreens = () => {
      if (media.matches) setCollapsed(true);
    };

    collapseOnSmallScreens();
    media.addEventListener("change", collapseOnSmallScreens);
    return () => media.removeEventListener("change", collapseOnSmallScreens);
  }, []);

  // The app is fully usable without an account (local data mode). Bootstrap
  // re-runs on every auth change so sign-in/out swaps the data source.
  useEffect(() => {
    if (loading) return;
    bootstrap(user ? { id: user.uid } : null, cloudReady);
  }, [loading, user, cloudReady, bootstrap]);

  const authenticatedOwner = user?.uid ?? null;
  if (loading || !bootstrapped || bootstrappedOwner !== authenticatedOwner) {
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
            {(authError || planError) && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription className="flex items-start justify-between gap-4">
                  <span>
                    {authError
                      ? "Cloud storage could not be prepared. This session is staying in browser-only mode; reload to retry."
                      : planError}
                  </span>
                  {!authError && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-my-2 size-8 shrink-0"
                      onClick={clearError}
                      aria-label="Dismiss error"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <Page />
          </div>
        </main>
      </div>
    </div>
  );
}
