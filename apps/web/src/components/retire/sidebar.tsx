"use client";

import {
  ChevronLeft,
  FlaskConical,
  Globe,
  Home,
  LineChart,
  Settings,
  SlidersHorizontal,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type PageId =
  | "overview"
  | "sensitivity"
  | "projections"
  | "plan"
  | "accounts"
  | "assumptions"
  | "settings";

const NAV: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "sensitivity", label: "Sensitivity", icon: FlaskConical },
  { id: "projections", label: "Projections", icon: LineChart },
  { id: "plan", label: "Profile", icon: SlidersHorizontal },
  { id: "accounts", label: "Accounts", icon: Wallet },
  { id: "assumptions", label: "Assumptions", icon: Globe },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  active,
  onNav,
  collapsed,
  onToggleCollapsed,
  userName,
  userEmail,
}: {
  active: PageId;
  onNav: (id: PageId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  userName: string;
  userEmail: string;
}) {
  const initials =
    userName
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className={cn(
          "bg-sidebar text-sidebar-foreground border-sidebar-border relative flex h-full shrink-0 flex-col border-r transition-[width] duration-200 ease-out",
          collapsed ? "w-[60px]" : "w-[232px]",
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex h-14 items-center gap-2 px-3",
            collapsed && "justify-center px-2",
          )}
        >
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-sm font-semibold">
            R
          </div>
          {!collapsed && (
            <span className="text-sidebar-foreground min-w-0 truncate text-sm font-semibold tracking-tight">
              Retire
            </span>
          )}
        </div>

        <Separator className="bg-sidebar-border" />

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            const button = (
              <Button
                variant="ghost"
                size={collapsed ? "icon" : "sm"}
                data-active={isActive}
                onClick={() => onNav(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full",
                  !collapsed && "justify-start gap-2 px-2",
                  "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-medium",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Button>
            );
            if (!collapsed) return <div key={item.id}>{button}</div>;
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Footer / user */}
        <Separator className="bg-sidebar-border" />
        <div
          className={cn(
            "flex items-center gap-2 p-3",
            collapsed && "justify-center p-2",
          )}
        >
          <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-sidebar-foreground truncate text-xs font-semibold">
                {userName}
              </span>
              <span className="text-muted-foreground truncate text-[11px]">
                {userEmail}
              </span>
            </div>
          )}
        </div>

        {/* Collapse handle */}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="border-sidebar-border bg-sidebar text-muted-foreground hover:text-foreground absolute top-12 -right-3 z-10 flex size-6 items-center justify-center rounded-full border shadow-sm transition-colors"
        >
          <ChevronLeft
            className={cn(
              "size-3 transition-transform",
              collapsed && "rotate-180",
            )}
          />
        </button>
      </aside>
    </TooltipProvider>
  );
}
