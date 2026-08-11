"use client";

import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { usePlan } from "@/state/usePlan";
import type { Account, AccountType, CreateAccountData } from "@/domain/types";
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
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DashboardCard,
  PageHeader,
  PageShell,
} from "@/components/retire/ui";
import { fmtCurrency } from "../format";
import { cn } from "@/lib/utils";
import { MAX_PLAN_ACCOUNTS } from "@/domain/constants";

const KIND_META: Record<AccountType, { label: string; color: string }> = {
  Taxable: { label: "Taxable", color: "var(--color-account-taxable)" },
  Traditional: { label: "Traditional", color: "var(--color-account-traditional)" },
  Roth: { label: "Roth", color: "var(--color-account-roth)" },
  HSA: { label: "HSA", color: "var(--color-account-hsa)" },
};
const KIND_KEYS: AccountType[] = ["Taxable", "Traditional", "Roth", "HSA"];

interface AccountDraft {
  name: string;
  institution: string;
  type: AccountType;
  balance: string;
  stocksPct: number; // 0-100
}

const EMPTY_DRAFT: AccountDraft = {
  name: "",
  institution: "",
  type: "Taxable",
  balance: "",
  stocksPct: 60,
};

type EditorMode =
  | { kind: "create" }
  | { kind: "edit"; id: string };

export function PageAccounts() {
  const { createAccount, deleteAccount, updateAccount } = usePlan();
  const accounts = usePlan((s) => s.plan.accounts);
  const bootstrapped = usePlan((s) => s.bootstrapped);

  const [filter, setFilter] = useState<"all" | AccountType>("all");
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_DRAFT);

  const totals: Record<string, number> = {};
  let grand = 0;
  for (const a of accounts) {
    totals[a.type] = (totals[a.type] || 0) + (a.balance || 0);
    grand += a.balance || 0;
  }
  const filtered =
    filter === "all" ? accounts : accounts.filter((a) => a.type === filter);

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setEditor({ kind: "create" });
  };

  const openEdit = (account: Account) => {
    setDraft({
      name: account.name,
      institution: account.institution,
      type: account.type,
      balance: account.balance ? String(account.balance) : "",
      stocksPct: Math.round((account.assetWeights?.stocks ?? 0.6) * 100),
    });
    setEditor({ kind: "edit", id: account.id });
  };

  const closeEditor = () => {
    setEditor(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleSubmit = async () => {
    if (!editor) return;
    if (!draft.name.trim()) return;
    const balance = parseFloat(draft.balance) || 0;
    const stocks = Math.max(0, Math.min(1, draft.stocksPct / 100));
    const bonds = 1 - stocks;

    if (editor.kind === "create") {
      const payload: CreateAccountData = {
        name: draft.name.trim(),
        institution: draft.institution.trim(),
        type: draft.type,
        balance,
        stocksPct: stocks,
        bondsPct: bonds,
      };
      await createAccount(payload);
    } else {
      await updateAccount(editor.id, {
        name: draft.name.trim(),
        institution: draft.institution.trim(),
        type: draft.type,
        balance,
        assetWeights: { stocks, bonds },
        balanceAsOf: new Date().toISOString().split("T")[0],
      });
    }
    closeEditor();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete account "${name}"? This cannot be undone.`)) return;
    await deleteAccount(id);
    if (editor?.kind === "edit" && editor.id === id) closeEditor();
  };

  return (
    <PageShell>
      <PageHeader
        title="Accounts"
        actions={
          <Button
            onClick={openCreate}
            disabled={accounts.length >= MAX_PLAN_ACCOUNTS}
            title={accounts.length >= MAX_PLAN_ACCOUNTS
              ? `Plans support up to ${MAX_PLAN_ACCOUNTS} accounts`
              : undefined}
          >
            <Plus className="size-4" />
            {accounts.length >= MAX_PLAN_ACCOUNTS ? "Account limit reached" : "Add account"}
          </Button>
        }
      />

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${KIND_KEYS.length + 1}, minmax(0, 1fr))`,
        }}
      >
        <BucketTile
          label="All"
          value={grand}
          color="var(--color-foreground)"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {KIND_KEYS.map((k) => (
          <BucketTile
            key={k}
            label={KIND_META[k].label}
            value={totals[k] || 0}
            color={KIND_META[k].color}
            active={filter === k}
            onClick={() => setFilter(k)}
          />
        ))}
      </div>

      {editor && (
        <DashboardCard
          title={editor.kind === "create" ? "New account" : "Edit account"}
          actions={
            <Button variant="ghost" size="sm" onClick={closeEditor}>
              Cancel
            </Button>
          }
        >
          <AccountFormFields draft={draft} onChange={setDraft} />
          <div className="mt-4 flex items-center justify-between gap-2">
            <div>
              {editor.kind === "edit" && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDelete(editor.id, draft.name)}
                >
                  <Trash2 className="size-4" />
                  Delete account
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closeEditor}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!draft.name.trim()}>
                {editor.kind === "create" ? "Create account" : "Save changes"}
              </Button>
            </div>
          </div>
        </DashboardCard>
      )}

      <DashboardCard
        title={filter === "all" ? "All accounts" : `${KIND_META[filter].label} accounts`}
        flush
      >
        {!bootstrapped && filtered.length === 0 ? (
          <div className="text-muted-foreground py-6 text-center text-sm">
            Loading accounts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground py-6 text-center text-sm">
            No accounts in this bucket yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Institution</TableHead>
                <TableHead className="w-44">Allocation</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((account) => {
                const meta = KIND_META[account.type];
                const stocks = Math.round((account.assetWeights?.stocks ?? 0) * 100);
                const bonds = Math.max(0, 100 - stocks);
                const isEditing =
                  editor?.kind === "edit" && editor.id === account.id;
                return (
                  <TableRow
                    key={account.id}
                    className={cn(
                      "cursor-pointer",
                      isEditing && "bg-muted/40",
                    )}
                    onClick={() => openEdit(account)}
                  >
                    <TableCell>
                      <span className="font-medium hover:underline underline-offset-4">
                        {account.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border bg-transparent px-2 py-0.5 text-xs"
                        style={{ borderColor: meta.color, color: meta.color }}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ background: meta.color }}
                        />
                        {meta.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.institution || "—"}
                    </TableCell>
                    <TableCell>
                      <AllocationBar stocks={stocks} bonds={bonds} />
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {fmtCurrency(account.balance || 0)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DashboardCard>
    </PageShell>
  );
}

function AccountFormFields({
  draft,
  onChange,
}: {
  draft: AccountDraft;
  onChange: (d: AccountDraft) => void;
}) {
  const stocks = draft.stocksPct;
  const bonds = 100 - stocks;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FieldInput
        label="Name"
        value={draft.name}
        placeholder="e.g. Joint Brokerage"
        onChange={(v) => onChange({ ...draft, name: v })}
      />
      <FieldInput
        label="Institution"
        value={draft.institution}
        placeholder="e.g. Fidelity"
        onChange={(v) => onChange({ ...draft, institution: v })}
      />
      <FieldSelect
        label="Type"
        value={draft.type}
        onChange={(v) => onChange({ ...draft, type: v })}
      />
      <FieldInput
        label="Balance"
        value={draft.balance}
        placeholder="0"
        inputMode="decimal"
        prefix="$"
        onChange={(v) => onChange({ ...draft, balance: v.replace(/[^0-9.]/g, "") })}
      />
      <div className="md:col-span-2">
        <div className="mb-2 flex items-baseline justify-between">
          <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Allocation
          </Label>
          <div className="font-mono text-xs tabular-nums">
            <span className="text-foreground font-semibold">{stocks}%</span>
            <span className="text-muted-foreground"> stocks · </span>
            <span className="text-foreground font-semibold">{bonds}%</span>
            <span className="text-muted-foreground"> bonds</span>
          </div>
        </div>
        <Slider
          value={[stocks]}
          min={0}
          max={100}
          step={1}
          onValueChange={(v) => onChange({ ...draft, stocksPct: v[0] ?? 0 })}
        />
      </div>
    </div>
  );
}

function AllocationBar({
  stocks,
  bonds,
  className,
}: {
  stocks: number;
  bonds: number;
  className?: string;
}) {
  const total = stocks + bonds || 1;
  const stocksPct = (stocks / total) * 100;
  const bondsPct = 100 - stocksPct;
  const stockColor = "var(--color-account-traditional, hsl(220 70% 55%))";
  const bondColor = "var(--color-account-roth, hsl(160 55% 45%))";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full">
        {stocksPct > 0 && (
          <div style={{ width: `${stocksPct}%`, background: stockColor }} />
        )}
        {bondsPct > 0 && (
          <div style={{ width: `${bondsPct}%`, background: bondColor }} />
        )}
      </div>
      <span
        className="text-xs tabular-nums whitespace-nowrap text-muted-foreground"
        title={`${stocks}% stocks · ${bonds}% bonds`}
      >
        <span className="text-foreground font-medium">{stocks}%</span>
        <span> / </span>
        <span className="text-foreground font-medium">{bonds}%</span>
      </span>
    </div>
  );
}

function BucketTile({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "bg-card flex flex-col gap-1.5 rounded-lg border p-4 text-left transition-colors",
        active ? "border-foreground" : "border-border hover:border-foreground/40",
      )}
    >
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
        <span className="size-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="text-foreground font-mono text-lg font-semibold tabular-nums">
        {fmtCurrency(value, true)}
      </div>
    </button>
  );
}

function FieldInput({
  label,
  value,
  placeholder,
  onChange,
  inputMode,
  prefix,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  inputMode?: "decimal" | "numeric" | "text";
  prefix?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={id}
        className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
      >
        {label}
      </Label>
      <div className="relative">
        {prefix && (
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm">
            {prefix}
          </span>
        )}
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
          className={prefix ? "pl-7" : undefined}
        />
      </div>
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: AccountType;
  onChange: (v: AccountType) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={id}
        className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
      >
        {label}
      </Label>
      <Select value={value} onValueChange={(v) => onChange(v as AccountType)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {KIND_KEYS.map((k) => (
            <SelectItem key={k} value={k}>
              {KIND_META[k].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
