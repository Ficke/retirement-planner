"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Dashboard-shaped composites built on shadcn/ui primitives.
 * Generic primitives live in components/ui/. Anything dashboard-specific
 * (fixed layouts, KPI patterns, page-level wrappers) lives here.
 */

// -- PageShell ---------------------------------------------------------------

export function PageShell({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {children}
    </div>
  );
}

// -- PageHeader --------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex flex-col gap-1">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// -- KPIGrid -----------------------------------------------------------------

export function KPIGrid({
  className,
  children,
  cols = 4,
}: {
  className?: string;
  children: React.ReactNode;
  cols?: 2 | 3 | 4;
}) {
  const grid = {
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-3",
    4: "grid-cols-2 md:grid-cols-4",
  }[cols];
  return <div className={cn("grid gap-4", grid, className)}>{children}</div>;
}

// -- Stat --------------------------------------------------------------------

const statTrendVariants = cva("text-xs font-medium", {
  variants: {
    tone: {
      neutral: "text-muted-foreground",
      positive: "text-success",
      negative: "text-danger",
      warn: "text-warn",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type StatTone = NonNullable<VariantProps<typeof statTrendVariants>["tone"]>;

export function Stat({
  label,
  value,
  unit,
  trend,
  tone = "neutral",
  pending = false,
  children,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  trend?: React.ReactNode;
  tone?: StatTone;
  /** The value is one edit behind while a new one computes. */
  pending?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-2 py-4", className)}>
      <CardHeader className="px-4">
        <CardDescription className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <div
          className={cn(
            "flex items-baseline gap-1.5 transition-opacity",
            pending && "opacity-40",
          )}
          aria-busy={pending || undefined}
        >
          <span className="text-foreground text-2xl font-semibold tabular-nums">
            {value}
          </span>
          {unit && (
            <span className="text-muted-foreground text-sm font-medium">{unit}</span>
          )}
        </div>
        {(trend || pending) && (
          <div className={statTrendVariants({ tone: pending ? "neutral" : tone })}>
            {pending ? "Calculating…" : trend}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

// -- DashboardCard -----------------------------------------------------------

export function DashboardCard({
  title,
  description,
  actions,
  flush,
  children,
  className,
  contentClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const hasHeader = title || actions || description;
  return (
    <Card className={className}>
      {hasHeader && (
        <CardHeader className="has-data-[slot=card-action]:grid-cols-1 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
          {actions && (
            <CardAction className="col-start-1 row-start-3 row-span-1 justify-self-start sm:col-start-2 sm:row-start-1 sm:row-span-2 sm:justify-self-end">
              {actions}
            </CardAction>
          )}
        </CardHeader>
      )}
      <CardContent className={cn(flush && "px-0", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

// -- SegmentedTabs -----------------------------------------------------------

export function SegmentedTabs<T extends string>({
  value,
  onValueChange,
  options,
  className,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      className={className}
    >
      <TabsList>
        {options.map((o) => (
          <TabsTrigger key={o.value} value={o.value}>
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
