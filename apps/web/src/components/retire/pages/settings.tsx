"use client";

import type { ReactNode } from "react";
import { useId } from "react";
import { RefreshCw } from "lucide-react";

import { usePlan } from "@/state/usePlan";
import type { SimulationModel } from "@/domain/types";
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
    privateAccountsMode,
    setPrivateAccountsMode,
  } = usePlan();
  const updateAssumptions = (
    assumptions: Parameters<typeof updatePlan>[0]["assumptions"],
  ) => updatePlan({ assumptions });
  const a = plan.assumptions;

  const seedMode = a.randomSeed != null ? "fixed" : "random";

  return (
    <PageShell>
        <PageHeader
          title="Settings"
          description="Runtime, randomness, and strategy options. The market model itself lives on Assumptions."
        />

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Compute
        </h2>
        <DashboardCard>
          <Setting
            label="Engine"
            helper="Server is faster. Local keeps the calculation on your device."
            badge={
              <Badge
                variant="secondary"
                className="bg-success/15 text-success gap-1.5"
              >
                <span className="bg-success size-1.5 rounded-full" />
                {useServerSideCalculations ? "Server" : "Local"}
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
                <SelectItem value="server">Server (Rust microservice)</SelectItem>
                <SelectItem value="local">Local (browser worker)</SelectItem>
              </SelectContent>
            </Select>
          </Setting>
        </DashboardCard>

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Privacy
        </h2>
        <DashboardCard>
          <Setting
            label="Account storage"
            helper="Private: accounts stay in this browser. Stored: synced to your account across devices."
          >
            <ToggleGroup
              type="single"
              value={privateAccountsMode ? "private" : "stored"}
              onValueChange={(v) => {
                if (!v) return;
                void setPrivateAccountsMode(v === "private");
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="stored">Stored</ToggleGroupItem>
              <ToggleGroupItem value="private">Private (browser only)</ToggleGroupItem>
            </ToggleGroup>
          </Setting>
        </DashboardCard>

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Market model
        </h2>
        <DashboardCard>
          <Setting
            label="Returns model"
            helper="Historical: replays past US market years (1928–2024). Parametric: samples from a statistical model fit to that history."
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

        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
          Strategy
        </h2>
        <DashboardCard>
          <Setting
            label="Backdoor Roth"
            helper="Convert post-tax dollars into Roth annually when income exceeds direct-Roth limits."
          >
            <ToggleGroup
              type="single"
              value={a.useBackdoorRoth ? "on" : "off"}
              onValueChange={(v) => {
                if (!v) return;
                updateAssumptions({ useBackdoorRoth: v === "on" });
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="on">On</ToggleGroupItem>
              <ToggleGroupItem value="off">Off</ToggleGroupItem>
            </ToggleGroup>
          </Setting>
        </DashboardCard>
      </PageShell>
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
