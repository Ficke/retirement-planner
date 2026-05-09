"use client";

import { useEffect, useId, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { usePlan, usePlanSelectors } from "@/state/usePlan";
import type { AccountType, CreateAccountData } from "@/domain/types";
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

const KIND_META: Record<AccountType, { label: string; color: string }> = {
  Taxable: { label: "Taxable", color: "var(--color-account-taxable)" },
  Traditional: { label: "Traditional", color: "var(--color-account-traditional)" },
  Roth: { label: "Roth", color: "var(--color-account-roth)" },
  HSA: { label: "HSA", color: "var(--color-account-hsa)" },
};
const KIND_KEYS: AccountType[] = ["Taxable", "Traditional", "Roth", "HSA"];

export function PageAccounts() {
  const { loadAccounts, createAccount, deleteAccount, updateAccount } = usePlan();
  const accountsWithHoldings = usePlanSelectors.useAccountsWithHoldings();
  const isReady = usePlanSelectors.useIsReady();

  const [filter, setFilter] = useState<"all" | AccountType>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<CreateAccountData>({
    name: "",
    institution: "",
    type: "Taxable",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] =
    useState<{ name: string; institution: string; type: AccountType } | null>(null);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const totals: Record<string, number> = {};
  let grand = 0;
  for (const a of accountsWithHoldings) {
    totals[a.account.type] = (totals[a.account.type] || 0) + (a.currentBalance || 0);
    grand += a.currentBalance || 0;
  }
  const filtered =
    filter === "all"
      ? accountsWithHoldings
      : accountsWithHoldings.filter((a) => a.account.type === filter);

  const handleAdd = async () => {
    if (!draft.name.trim() || !draft.institution.trim()) return;
    await createAccount(draft);
    setDraft({ name: "", institution: "", type: "Taxable" });
    setShowAdd(false);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editDraft) return;
    await updateAccount(id, editDraft);
    setEditingId(null);
    setEditDraft(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete account "${name}"? This cannot be undone.`)) return;
    await deleteAccount(id);
  };

  const summary = `${accountsWithHoldings.length} ${
    accountsWithHoldings.length === 1 ? "account" : "accounts"
  } across ${Object.keys(totals).length || 0} ${
    Object.keys(totals).length === 1 ? "category" : "categories"
  }. Total ${fmtCurrency(grand, true)}.`;

  return (
    <PageShell>
      <PageHeader
        title="Accounts"
        description={summary}
        actions={
          <Button onClick={() => setShowAdd((s) => !s)}>
            <Plus className="size-4" />
            Add account
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

      {showAdd && (
        <DashboardCard
          title="New account"
          actions={
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          }
        >
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[2fr_2fr_1fr_auto]">
            <FieldInput
              label="Name"
              value={draft.name}
              placeholder="e.g. Joint Brokerage"
              onChange={(v) => setDraft({ ...draft, name: v })}
            />
            <FieldInput
              label="Institution"
              value={draft.institution}
              placeholder="e.g. Fidelity"
              onChange={(v) => setDraft({ ...draft, institution: v })}
            />
            <FieldSelect
              label="Type"
              value={draft.type}
              onChange={(v) => setDraft({ ...draft, type: v as AccountType })}
            />
            <Button onClick={handleAdd}>Create</Button>
          </div>
          <p className="text-muted-foreground mt-2 text-[11px]">
            New accounts start with $0. Add holdings or import a statement from the
            account detail view.
          </p>
        </DashboardCard>
      )}

      <DashboardCard
        title={filter === "all" ? "All accounts" : `${KIND_META[filter].label} accounts`}
        description={`${filtered.length} ${
          filtered.length === 1 ? "account" : "accounts"
        }`}
        flush
      >
        {!isReady && filtered.length === 0 ? (
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
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(({ account, currentBalance }) => {
                const isEditing = editingId === account.id;
                const meta = KIND_META[account.type];
                return (
                  <TableRow key={account.id}>
                    <TableCell>
                      {isEditing ? (
                        <Input
                          value={editDraft?.name ?? ""}
                          onChange={(e) =>
                            setEditDraft((d) => (d ? { ...d, name: e.target.value } : d))
                          }
                        />
                      ) : (
                        <span className="font-medium">{account.name}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Select
                          value={editDraft?.type ?? account.type}
                          onValueChange={(v) =>
                            setEditDraft((d) =>
                              d ? { ...d, type: v as AccountType } : d,
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
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
                      ) : (
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
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {isEditing ? (
                        <Input
                          value={editDraft?.institution ?? ""}
                          onChange={(e) =>
                            setEditDraft((d) =>
                              d ? { ...d, institution: e.target.value } : d,
                            )
                          }
                        />
                      ) : (
                        account.institution
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {fmtCurrency(currentBalance || 0)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {isEditing ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Save"
                            onClick={() => handleSaveEdit(account.id)}
                          >
                            <Check className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Cancel"
                            onClick={() => {
                              setEditingId(null);
                              setEditDraft(null);
                            }}
                          >
                            <X className="size-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Edit"
                            onClick={() => {
                              setEditingId(account.id);
                              setEditDraft({
                                name: account.name,
                                institution: account.institution,
                                type: account.type,
                              });
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Delete"
                            onClick={() => handleDelete(account.id, account.name)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DashboardCard>

      <p className="text-muted-foreground text-[11px]">
        Need to populate holdings? Open an account&rsquo;s detail view (legacy UI) to
        upload a statement via OCR or add transactions.
      </p>
    </PageShell>
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
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
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
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
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
