import type { ReactNode } from "react";
import { useId } from "react";
import { LogIn, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { cloudComputeEnabled, usePlan } from "@/state/usePlan";
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
import { stateTaxProfileOf } from "@/data/state-tax";
import { TAX_LAW_YEAR } from "@/data/tax-brackets-2025";
import { MAIN_PATHS, SWEEP_PATHS } from "@/services/simulation";
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
import { fmtCurrency } from "../format";
import { getRmdStartAge } from "@/data/rmd-tables";
import { birthYearOf } from "@/domain/age";

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
  const cloudCompute = usePlan(cloudComputeEnabled);
  const { user, cloudReady } = useAuth();
  const navigate = useNavigate();
  const updateAssumptions = (
    assumptions: Parameters<typeof updatePlan>[0]["assumptions"],
  ) => updatePlan({ assumptions });
  const a = plan.assumptions;
  const hc = plan.profile.retirementHealthcare;

  const signedIn = user != null && authUser != null;
  const dataMode = signedIn && cloudSyncEnabled && cloudAvailable ? "cloud" : "local";
  const DATA_RANGE = `${DATA_FIRST_YEAR}–${DATA_LAST_YEAR}`;
  const stateTax = stateTaxProfileOf(plan.profile.state);
  // Both ends of the conversion window are derived, so the plan stores neither.
  const conversionWindow = {
    from: plan.profile.retirementAge,
    to: getRmdStartAge(birthYearOf(plan.profile.birthDate)) - 1,
  };

  return (
    <PageShell>
        <PageHeader
          title="Settings"
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
                : "You're not signed in, so your profile and accounts exist only in this browser. Nothing is stored in the cloud. Sign in to keep your plan and use it across devices."
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
              <Button variant="outline" size="sm" onClick={() => navigate("/auth/signin")}>
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
            helper="Cloud sends balances and allocations, never account names, and stores nothing. Local never leaves this device. This setting is independent from cloud data sync."
            badge={
              <Badge
                variant="secondary"
                className="bg-success/15 text-success gap-1.5"
              >
                <span className="bg-success size-1.5 rounded-full" />
                {cloudCompute ? "Cloud" : "Local"}
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
            helper={`Historical replays real market years (${DATA_RANGE}) in blocks, keeping runs like 2008 → 2009 intact. Parametric samples a model fit to that history.`}
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
          description={`A run counts as a success only if every year it models can be paid for, from today through the end of your life. A working year that runs short fails the same way a retirement year does. Every figure here is in today's dollars, and the market figures cover ${DATA_RANGE}. The headline number runs ${MAIN_PATHS.toLocaleString()} paths; each point on a sensitivity curve runs ${SWEEP_PATHS.toLocaleString()}.`}
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
                label="Stocks: real return / volatility"
                value={`${(US_STOCK_REAL_RETURNS.mean * 100).toFixed(1)}% / ${(US_STOCK_REAL_RETURNS.volatility * 100).toFixed(1)}%`}
                source="S&P 500 total return (Damodaran)"
              />
              <ReferenceRow
                label="Bonds: real return / volatility"
                value={`${(US_BOND_REAL_RETURNS.mean * 100).toFixed(1)}% / ${(US_BOND_REAL_RETURNS.volatility * 100).toFixed(1)}%`}
                source="10-year US Treasury (Damodaran)"
              />
              <ReferenceRow
                label="Stock/bond correlation"
                value={STOCK_BOND_CORRELATION.toFixed(2)}
                source="S&P 500 and 10-year Treasury (Damodaran)"
              />
              <ReferenceRow
                label="Long-run inflation (CPI)"
                value={`${(US_INFLATION.mean * 100).toFixed(1)}%`}
                source="CPI-U Dec/Dec (BLS)"
              />
              <ReferenceRow
                label="Tax brackets"
                value={
                  stateTax.status === "modeled"
                    ? `${TAX_LAW_YEAR} federal and ${stateTax.name}`
                    : stateTax.status === "no-income-tax"
                      ? `${TAX_LAW_YEAR} federal; ${stateTax.name} has no income tax`
                      : `${TAX_LAW_YEAR} federal; state tax not modeled`
                }
                source={stateTax.status === "modeled" ? `IRS and ${stateTax.name}` : "IRS"}
              />
              <ReferenceRow
                label="RMD table"
                value="SECURE 2.0 (2024+)"
                source="IRS Pub. 590-B"
              />
              <ReferenceRow
                label="Contribution limits"
                value={String(TAX_LAW_YEAR)}
                source="IRS"
              />
              <ReferenceRow
                label="Taxable withdrawal gain share"
                value={`${(a.taxableGainRatio * 100).toFixed(0)}%`}
                source="Tax model, below"
              />
              <ReferenceRow
                label="Marketplace premium credit"
                value="2026 tables, 400% cliff"
                source="IRC 36B, Rev. Proc. 2025-25"
              />
              <ReferenceRow
                label="Medicare IRMAA"
                value="2026 tiers, 2-year lookback"
                source="CMS"
              />
              <ReferenceRow
                label="Retirement healthcare: before / from 65"
                value={`${fmtCurrency(hc.preMedicarePremium + hc.outOfPocket)} / ${fmtCurrency(hc.medicarePremium + hc.outOfPocket)}`}
                source="Profile page"
              />
            </TableBody>
          </Table>
        </DashboardCard>

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Roth conversions
        </h2>
        <DashboardCard>
          <Setting
            label="Convert pre-tax savings to Roth"
            helper="Fills up the low-income years between retiring and your first RMD, so the balance RMDs are calculated from is smaller. You pay the tax now instead of later, which only wins if your rate is lower now."
            badge={
              a.rothConversion.enabled ? (
                <Badge variant="secondary" className="bg-info/15 text-info">
                  Ages {conversionWindow.from}–{conversionWindow.to}
                </Badge>
              ) : undefined
            }
          >
            <ToggleGroup
              type="single"
              value={a.rothConversion.enabled ? "on" : "off"}
              onValueChange={(v) => {
                if (!v) return;
                updateAssumptions({
                  rothConversion: { ...a.rothConversion, enabled: v === "on" },
                });
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="off">Off</ToggleGroupItem>
              <ToggleGroupItem value="on">On</ToggleGroupItem>
            </ToggleGroup>
          </Setting>
          <div className="border-border mt-4 border-t pt-4">
            <Setting
              label="Convert up to"
              helper="Each year converts as much as fits under this ceiling. Higher fills faster but pays a higher rate to do it."
            >
              <Select
                value={a.rothConversion.ceiling}
                onValueChange={(value) =>
                  updateAssumptions({
                    rothConversion: {
                      ...a.rothConversion,
                      ceiling: value as typeof a.rothConversion.ceiling,
                    },
                  })
                }
                disabled={!a.rothConversion.enabled}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="irmaaTier">Under the Medicare surcharge</SelectItem>
                  <SelectItem value="bracket12">Top of the 12% bracket</SelectItem>
                  <SelectItem value="bracket22">Top of the 22% bracket</SelectItem>
                  <SelectItem value="bracket24">Top of the 24% bracket</SelectItem>
                  <SelectItem value="bracket32">Top of the 32% bracket</SelectItem>
                </SelectContent>
              </Select>
            </Setting>
          </div>
        </DashboardCard>

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Tax model
        </h2>
        <DashboardCard>
          <p className="text-muted-foreground mb-5 text-sm leading-relaxed">
            {TAX_LAW_YEAR} law, held constant in real dollars. Standard deductions only, with
            no itemizing, credits, or AMT. Ages and limits apply to one earner; a
            spouse&apos;s details are not inferred.
          </p>
          <Setting
            label="Taxable withdrawal gain share"
            helper="How much of a brokerage withdrawal is gain rather than your original investment."
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
          <div className="border-border mt-4 border-t pt-4">
            <Setting
              label="Tax rate on pre-tax money left at the end"
              helper="Prices the bill still owed on whatever sits in Traditional and HSA at the end, so a Roth dollar and a pre-tax dollar can be compared. Around 30% if heirs will draw it down, lower if you will."
            >
              <div className="flex max-w-40 items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Number((a.terminalTaxRate * 100).toFixed(1))}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) {
                      updateAssumptions({
                        terminalTaxRate: Math.max(0, Math.min(100, value)) / 100,
                      });
                    }
                  }}
                />
                <span className="text-muted-foreground text-sm">%</span>
              </div>
            </Setting>
          </div>
        </DashboardCard>

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Simulation seed
        </h2>
        <DashboardCard>
          <SeedValueRow
            value={a.randomSeed}
            onChange={(v) => updateAssumptions({ randomSeed: v })}
          />
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
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-foreground text-sm font-semibold">
        Seed value
      </Label>
      <p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
        Shared by the headline simulation and every sensitivity curve. The default is 42.
      </p>
      <div className="mt-1 flex gap-2">
        <Input
          id={id}
          type="number"
          min={0}
          max={2 ** 32 - 1}
          className="font-mono"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") return;
            const n = parseInt(v, 10);
            if (!Number.isNaN(n) && n >= 0 && n <= 2 ** 32 - 1) onChange(n);
          }}
        />
        <Button
          variant="outline"
          onClick={() => onChange(Math.floor(Math.random() * 1e9))}
        >
          <RefreshCw className="size-4" />
          New
        </Button>
      </div>
    </div>
  );
}
