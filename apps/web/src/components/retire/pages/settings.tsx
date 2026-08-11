"use client";

import type { ReactNode } from "react";
import { useId } from "react";
import { LogIn, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { usePlan } from "@/state/usePlan";
import { useAuth } from "@/lib/firebase";
import type { SimulationModel } from "@/domain/types";
import {
  US_STOCK_REAL_RETURNS,
  US_BOND_REAL_RETURNS,
  US_INFLATION,
  STOCK_BOND_CORRELATION,
  DATA_FIRST_YEAR,
  DATA_LAST_YEAR,
} from "@/data/market-history";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DashboardCard,
  PageHeader,
  PageShell,
} from "@/components/retire/ui";

export function PageSettings() {
  const {
    plan,
    updatePlan,
    useServerSideCalculations,
    setUseServerSideCalculations,
    cloudSyncEnabled,
    cloudAvailable,
    setCloudSyncEnabled,
    authUser,
    bootstrap,
  } = usePlan();
  const { user, cloudReady } = useAuth();
  const router = useRouter();
  const updateAssumptions = (
    assumptions: Parameters<typeof updatePlan>[0]["assumptions"],
  ) => updatePlan({ assumptions });
  const a = plan.assumptions;

  const seedMode = a.randomSeed != null ? "fixed" : "random";
  const signedIn = user != null && authUser != null;
  const dataMode = signedIn && cloudSyncEnabled && cloudAvailable ? "cloud" : "local";
  const DATA_RANGE = `${DATA_FIRST_YEAR}–${DATA_LAST_YEAR}`;

  return (
    <PageShell>
        <PageHeader
          title="Settings"
          description="Where your data lives, where calculations run, and how the model behaves."
        />

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Your data
        </h2>
        <DashboardCard>
          <Setting
            label="Storage"
            helper={
              signedIn
                ? cloudReady
                  ? "Cloud syncs across devices. Browser-only mode copies the current plan but never uploads later edits; switching back reloads the cloud copy. Browser-only data is lost if you clear this browser."
                  : "Your identity is signed in, but its cloud data record is unavailable. This account remains isolated in browser-only storage until cloud setup succeeds."
                : "You're not signed in, so your profile and accounts exist only in this browser — nothing is stored in the cloud. Sign in to keep your plan and use it across devices."
            }
            badge={
              <Badge variant="secondary" className="bg-info/15 text-info gap-1.5">
                <span className="bg-info size-1.5 rounded-full" />
                {dataMode === "cloud" ? "Cloud" : "This browser"}
              </Badge>
            }
          >
            {signedIn ? (
              <ToggleGroup
                type="single"
                value={cloudSyncEnabled ? "cloud" : "local"}
                onValueChange={(v) => {
                  if (!v) return;
                  void setCloudSyncEnabled(v === "cloud");
                }}
                variant="outline"
                size="sm"
                disabled={!cloudReady}
              >
                <ToggleGroupItem value="cloud">Cloud (synced)</ToggleGroupItem>
                <ToggleGroupItem value="local">This browser only</ToggleGroupItem>
              </ToggleGroup>
            ) : (
              <Button variant="outline" size="sm" onClick={() => router.push("/auth/signin")}>
                <LogIn className="size-4" />
                Sign in
              </Button>
            )}
          </Setting>
          {signedIn && cloudReady && cloudSyncEnabled && !cloudAvailable && (
            <div className="border-border mt-4 flex items-center justify-between gap-4 border-t pt-4">
              <p className="text-muted-foreground text-sm">
                Cloud reads did not complete. Browser edits remain local; retrying reloads the
                cloud copy.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void bootstrap(authUser, true)}
              >
                <RefreshCw className="size-4" />
                Retry cloud
              </Button>
            </div>
          )}
        </DashboardCard>

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Compute engine
        </h2>
        <DashboardCard>
          <Setting
            label="Where simulations run"
            helper="Cloud engine: each run sends model inputs, balances, and allocations to our server, but strips account names, institutions, owner IDs, and timestamps. It computes in memory and stores nothing. Local engine: calculations never leave this device (slower on large sweeps)."
            badge={
              <Badge
                variant="secondary"
                className="bg-success/15 text-success gap-1.5"
              >
                <span className="bg-success size-1.5 rounded-full" />
                {useServerSideCalculations ? "Cloud" : "Local"}
              </Badge>
            }
          >
            <Select
              value={useServerSideCalculations ? "server" : "local"}
              onValueChange={(v) => setUseServerSideCalculations(v === "server")}
            >
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="server">Cloud (fast, nothing stored)</SelectItem>
                <SelectItem value="local">Local (never leaves device)</SelectItem>
              </SelectContent>
            </Select>
          </Setting>
        </DashboardCard>

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Market model
        </h2>
        <DashboardCard>
          <Setting
            label="Returns model"
            helper={`Historical: replays past US market years (${DATA_RANGE}) in 3-year blocks, preserving sequences like 2008 → 2009. Parametric: samples a statistical model fit to that history (Student-t equities, Normal bonds, log-space).`}
          >
            <ToggleGroup
              type="single"
              value={a.simulationModel}
              onValueChange={(v) => {
                if (!v) return;
                updateAssumptions({ simulationModel: v as SimulationModel });
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="historical">Historical bootstrap</ToggleGroupItem>
              <ToggleGroupItem value="parametric">Parametric</ToggleGroupItem>
            </ToggleGroup>
          </Setting>
        </DashboardCard>

        <DashboardCard
          title="What the model assumes"
          description={`Derived from US asset-class history, ${DATA_RANGE}. Real (after-inflation) annual returns; 5,000 Monte Carlo paths per run over your Profile horizon.`}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assumption</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <ReferenceRow
                label="Stocks — real return / volatility"
                value={`${(US_STOCK_REAL_RETURNS.mean * 100).toFixed(1)}% / ${(US_STOCK_REAL_RETURNS.volatility * 100).toFixed(1)}%`}
                source="S&P 500 total return (Damodaran)"
              />
              <ReferenceRow
                label="Bonds — real return / volatility"
                value={`${(US_BOND_REAL_RETURNS.mean * 100).toFixed(1)}% / ${(US_BOND_REAL_RETURNS.volatility * 100).toFixed(1)}%`}
                source="10-year US Treasury (Damodaran)"
              />
              <ReferenceRow
                label="Stock/bond correlation"
                value={STOCK_BOND_CORRELATION.toFixed(2)}
                source={`Real annual returns, ${DATA_RANGE}`}
              />
              <ReferenceRow
                label="Long-run inflation (CPI)"
                value={`${(US_INFLATION.mean * 100).toFixed(1)}%`}
                source="CPI-U Dec/Dec (BLS) — engine works in real dollars"
              />
              <ReferenceRow
                label="Tax brackets"
                value={
                  plan.profile.state === "CA"
                    ? "Federal + CA 2025 estimate"
                    : plan.profile.state === "TX" || plan.profile.state === "FL"
                      ? "Federal 2025; no state income tax"
                      : "Federal 2025; state/local excluded"
                }
                source={`IRS${plan.profile.state === "CA" ? " / FTB" : ""}`}
              />
              <ReferenceRow
                label="RMD table"
                value="SECURE 2.0 (2024+)"
                source="IRS Pub. 590-B"
              />
              <ReferenceRow label="Contribution limits" value="2025" source="IRS" />
              <ReferenceRow
                label="Taxable withdrawal gain share"
                value={`${(a.taxableGainRatio * 100).toFixed(0)}%`}
                source="Your modeling assumption"
              />
            </TableBody>
          </Table>
        </DashboardCard>

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Tax model
        </h2>
        <DashboardCard>
          <p className="text-muted-foreground mb-5 text-sm leading-relaxed">
            Tax rules and limits use 2025 law held constant in real dollars. Estimates use standard
            deductions and omit itemized deductions, tax credits, AMT, local taxes, and income
            categories the profile does not collect. Age-based deductions and contribution limits
            apply to the primary person; married plans do not infer a spouse&apos;s age, earnings,
            contributions, or Social Security benefit. Married filing separately assumes the filer
            lived with their spouse during the year for Social Security taxation. Recurring cash
            flows, including RMDs, are prorated from the as-of date in the first modeled year because
            the plan does not collect year-to-date amounts.
          </p>
          <Setting
            label="Taxable withdrawal gain share"
            helper="The portion of each taxable-brokerage withdrawal treated as long-term capital gain; the remainder is return of cost basis. Use 0% for all basis and 100% for all gain. HSA withdrawals are assumed to pay qualified medical expenses and remain tax-free."
          >
            <div className="flex max-w-40 items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={Number((a.taxableGainRatio * 100).toFixed(1))}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    updateAssumptions({ taxableGainRatio: Math.max(0, Math.min(100, value)) / 100 });
                  }
                }}
              />
              <span className="text-muted-foreground text-sm">%</span>
            </div>
          </Setting>
        </DashboardCard>

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Randomness
        </h2>
        <DashboardCard>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Setting
              label="Seed mode"
              helper="Fixed seed = identical results across runs (good for screenshots and regression tests). Random = fresh sample each run."
            >
              <ToggleGroup
                type="single"
                value={seedMode}
                onValueChange={(v) => {
                  if (!v) return;
                  updateAssumptions({
                    randomSeed: v === "fixed" ? a.randomSeed ?? 42 : undefined,
                  });
                }}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="fixed">Fixed</ToggleGroupItem>
                <ToggleGroupItem value="random">Random</ToggleGroupItem>
              </ToggleGroup>
            </Setting>
            <SeedValueRow
              value={a.randomSeed}
              onChange={(v) => updateAssumptions({ randomSeed: v })}
            />
          </div>
        </DashboardCard>

      </PageShell>
  );
}

function ReferenceRow({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: string;
}) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right font-mono">{value}</TableCell>
      <TableCell className="text-muted-foreground">{source}</TableCell>
    </TableRow>
  );
}

function Setting({
  label,
  helper,
  badge,
  children,
}: {
  label: string;
  helper: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-foreground text-sm font-semibold">{label}</Label>
        {badge}
      </div>
      <p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
        {helper}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SeedValueRow({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const id = useId();
  const disabled = value == null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-foreground text-sm font-semibold">
        Seed value
      </Label>
      <p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
        Used when seed mode is fixed.
      </p>
      <div className="mt-1 flex gap-2">
        <Input
          id={id}
          type="number"
          className="font-mono"
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") return onChange(undefined);
            const n = parseInt(v, 10);
            if (!Number.isNaN(n) && n >= 0) onChange(n);
          }}
        />
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => onChange(Math.floor(Math.random() * 1e9))}
        >
          <RefreshCw className="size-4" />
          New
        </Button>
      </div>
    </div>
  );
}
