"use client";

import { useMemo } from "react";

import { ageOn } from "@/domain/age";
import type { ProjectionSettings, UserProfile } from "@/domain/types";
import { calculateWorkingCashFlow } from "@/engine/tax";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardCard } from "@/components/retire/ui";
import { fmtCurrency, fmtPercent } from "./format";
import { cn } from "@/lib/utils";

/**
 * The working year the plan starts from, as a waterfall: gross income, less
 * tax and spending, with the remainder saved. It sits beside the spending lever
 * because it is that lever's consequence.
 */
export function CashFlowCard({
  profile,
  assumptions,
}: {
  profile: UserProfile;
  assumptions: ProjectionSettings;
}) {
  const { hsaEligible, useBackdoorRoth } = assumptions;
  const age = ageOn(profile.birthDate, profile.asOfDate);
  const salary = profile.currentSalary;
  const spending = profile.currentSpending;

  const cashFlow = useMemo(() => {
    try {
      return calculateWorkingCashFlow(
        salary,
        spending,
        age,
        profile.filingStatus,
        profile.state,
        { hsaEligible, useBackdoorRoth },
      );
    } catch {
      return null;
    }
  }, [salary, spending, age, profile.filingStatus, profile.state, hsaEligible, useBackdoorRoth]);

  const contributions = cashFlow?.contributions ?? { hsa: 0, traditional: 0, roth: 0, taxable: 0 };
  const totalTax = cashFlow?.tax.totalTax ?? 0;
  const effectiveRate = cashFlow?.tax.effectiveRate ?? 0;
  const preTax = contributions.hsa + contributions.traditional;
  const afterTax = contributions.roth + contributions.taxable;
  const takeHome = salary - totalTax - preTax;
  const totalSaved = cashFlow?.totalContributions ?? 0;
  const fundingGap = cashFlow?.fundingGap ?? 0;
  const share = (amount: number) => (salary > 0 ? amount / salary : 0);

  return (
    <DashboardCard
      title="Cash flow"
      description={
        fundingGap > 0
          ? "Spending is above take-home pay. The gap comes out of your portfolio."
          : undefined
      }
      flush
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Flow</TableHead>
            <TableHead className="text-right">Annual</TableHead>
            <TableHead className="text-right">% of gross</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <FlowRow label="Gross salary" amount={fmtCurrency(salary)} pct="100%" strong />
          <FlowRow
            label="− Estimated taxes (federal + state + FICA)"
            amount={`-${fmtCurrency(totalTax)}`}
            pct={fmtPercent(effectiveRate, 1)}
            tone="negative"
            indent
          />
          <FlowRow
            label="− HSA + Traditional contributions"
            amount={`-${fmtCurrency(preTax)}`}
            pct={fmtPercent(share(preTax), 1)}
            tone="negative"
            indent
          />
          <FlowRow
            label="Take-home pay"
            amount={fmtCurrency(takeHome)}
            pct={fmtPercent(share(takeHome), 1)}
            strong
          />
          <FlowRow
            label="− Annual spending"
            amount={`-${fmtCurrency(spending)}`}
            pct={fmtPercent(share(spending), 1)}
            tone="negative"
            indent
          />
          <FlowRow
            label="→ Roth + Taxable contributions"
            amount={fmtCurrency(afterTax)}
            pct={fmtPercent(share(afterTax), 1)}
            indent
          />
          <FlowRow
            label={fundingGap > 0 ? "Drawn from portfolio" : "Total saved"}
            amount={fundingGap > 0 ? `-${fmtCurrency(fundingGap)}` : fmtCurrency(totalSaved)}
            pct={fmtPercent(fundingGap > 0 ? -share(fundingGap) : share(totalSaved), 1)}
            tone={fundingGap > 0 ? "negative" : undefined}
            strong
          />
        </TableBody>
      </Table>
      <div className="bg-muted/40 border-border text-muted-foreground border-t px-4 py-2.5 text-[11px]">
        {profile.state === "CA" ? "Federal + California 2025" : "Federal 2025"} brackets and FICA.
      </div>
    </DashboardCard>
  );
}

function FlowRow({
  label,
  amount,
  pct,
  tone,
  strong,
  indent,
}: {
  label: string;
  amount: string;
  pct: string;
  tone?: "negative";
  strong?: boolean;
  indent?: boolean;
}) {
  return (
    <TableRow className={cn(strong && "bg-muted/40")}>
      <TableCell
        className={cn(
          tone === "negative" && "text-danger",
          strong && "font-semibold",
          indent && "pl-8",
        )}
      >
        {label}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono",
          tone === "negative" && "text-danger",
          strong && "font-semibold",
        )}
      >
        {amount}
      </TableCell>
      <TableCell className="text-muted-foreground text-right font-mono">{pct}</TableCell>
    </TableRow>
  );
}
