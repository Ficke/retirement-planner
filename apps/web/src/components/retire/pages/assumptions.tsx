"use client";

import { usePlan } from "@/state/usePlan";
import {
  US_STOCK_REAL_RETURNS_1926_2024,
  US_BOND_REAL_RETURNS_1926_2024,
  US_INFLATION_1926_2024,
  ASSET_CORRELATION_MATRIX_1926_2024,
} from "@/data/market-history";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DashboardCard,
  PageHeader,
  PageShell,
} from "@/components/retire/ui";
import { Donut } from "@/components/ui/charts";

const ENGINE = {
  stocks: {
    mean: US_STOCK_REAL_RETURNS_1926_2024.mean,
    vol: US_STOCK_REAL_RETURNS_1926_2024.volatility,
  },
  bonds: {
    mean: US_BOND_REAL_RETURNS_1926_2024.mean,
    vol: US_BOND_REAL_RETURNS_1926_2024.volatility,
  },
  inflation: {
    mean: US_INFLATION_1926_2024.mean,
    vol: US_INFLATION_1926_2024.volatility,
  },
  correlation: ASSET_CORRELATION_MATRIX_1926_2024.stocks_bonds,
} as const;

const STOCK_COLOR = "var(--color-account-traditional)";
const BOND_COLOR = "var(--color-account-hsa)";

export function PageAssumptions() {
  const { plan } = usePlan();

  const totalBal = plan.accounts.reduce((s, a) => s + a.balance, 0);
  const stockWeight =
    totalBal > 0
      ? plan.accounts.reduce((s, a) => s + a.balance * a.assetWeights.stocks, 0) /
        totalBal
      : 0.6;
  const bondWeight = 1 - stockWeight;

  const expectedReturn =
    (ENGINE.stocks.mean * stockWeight + ENGINE.bonds.mean * bondWeight) * 100;
  const expectedVol =
    Math.sqrt(
      Math.pow(ENGINE.stocks.vol * stockWeight, 2) +
        Math.pow(ENGINE.bonds.vol * bondWeight, 2) +
        2 *
          stockWeight *
          bondWeight *
          ENGINE.stocks.vol *
          ENGINE.bonds.vol *
          ENGINE.correlation,
    ) * 100;

  return (
    <PageShell>
      <PageHeader
        title="Assumptions"
        description="The inputs behind the simulation. Returns reflect US asset-class history (1926–2024)."
      />

      <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
        Market model
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard
          title="Asset class assumptions"
          description="Real (after-inflation) returns."
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset class</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Expected return</TableHead>
                <TableHead className="text-right">Volatility</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: STOCK_COLOR }}
                    />
                    Stocks
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {(stockWeight * 100).toFixed(0)}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  {(ENGINE.stocks.mean * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  {(ENGINE.stocks.vol * 100).toFixed(1)}%
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: BOND_COLOR }}
                    />
                    Bonds
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {(bondWeight * 100).toFixed(0)}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  {(ENGINE.bonds.mean * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  {(ENGINE.bonds.vol * 100).toFixed(1)}%
                </TableCell>
              </TableRow>
            </TableBody>
            <TableFooter className="bg-muted/40">
              <TableRow>
                <TableCell className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Portfolio (derived)
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  100%
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  {expectedReturn.toFixed(1)}%
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  {expectedVol.toFixed(1)}%
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </DashboardCard>

        <DashboardCard title="Allocation">
          <div className="flex items-center gap-6">
            <Donut
              data={[
                { value: stockWeight, color: STOCK_COLOR },
                { value: bondWeight, color: BOND_COLOR },
              ]}
              size={140}
              thickness={20}
              centerLabel="Stocks"
              centerValue={`${(stockWeight * 100).toFixed(0)}%`}
            />
            <p className="text-muted-foreground flex-1 text-xs leading-relaxed">
              Allocation is portfolio-weighted from each account&rsquo;s stock/bond split.
              Edit individual account allocations on the Accounts page.
            </p>
          </div>
        </DashboardCard>
      </div>

      <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
        Economic &amp; rule assumptions
      </h2>
      <DashboardCard flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Assumption</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <RuleRow
              label="Long-run inflation (CPI)"
              value={`${(ENGINE.inflation.mean * 100).toFixed(1)}%`}
              source="US 1926–2024, real returns net of inflation"
            />
            <RuleRow
              label="Stock/bond correlation"
              value={ENGINE.correlation.toFixed(2)}
              source="US 1926–2024 historical"
            />
            <RuleRow
              label="Tax brackets"
              value={
                plan.profile.state === "CA"
                  ? "Federal 2025 + CA 2025"
                  : "Federal 2025"
              }
              source={`IRS${plan.profile.state === "CA" ? " / FTB" : ""}`}
            />
            <RuleRow
              label="RMD table"
              value="SECURE 2.0 (2024+)"
              source="IRS Pub. 590-B"
            />
            <RuleRow label="Contribution limits" value="2025" source="IRS" />
          </TableBody>
        </Table>
      </DashboardCard>

      <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
        Simulation parameters
      </h2>
      <DashboardCard flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parameter</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <RuleRow
              label="Method"
              value={
                plan.assumptions.simulationModel === "parametric"
                  ? "Parametric (log-normal)"
                  : "Historical bootstrap"
              }
              source={
                plan.assumptions.simulationModel === "parametric"
                  ? "Student-t (df=6) equities + Normal bonds, sampled in log space"
                  : "Resamples real US 1926–2024 years in 3-year blocks"
              }
            />
            <RuleRow
              label="Paths per simulation"
              value="5,000"
              source="Independent Monte Carlo trajectories"
            />
            <RuleRow
              label="Time horizon"
              value={`Age ${plan.profile.age} → ${plan.profile.lifeExpectancy}`}
              source="Set on Profile"
            />
            <RuleRow
              label="Step size"
              value="Annual"
              source="End-of-year valuation"
            />
            <RuleRow
              label="Bootstrap block size"
              value="3 years"
              source="Preserves multi-year sequences (e.g. 2008 → 2009)"
            />
          </TableBody>
        </Table>
      </DashboardCard>
    </PageShell>
  );
}

function RuleRow({
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
