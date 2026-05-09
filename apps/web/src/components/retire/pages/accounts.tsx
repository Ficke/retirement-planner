"use client";

import { useEffect, useState } from 'react';
import { usePlan, usePlanSelectors } from '@/state/usePlan';
import type { AccountType, CreateAccountData } from '@/domain/types';
import { Card } from '../primitives';
import { Icon } from '../icons';
import { fmtCurrency } from '../format';

const KIND_META: Record<AccountType, { label: string; color: string }> = {
  Taxable:     { label: 'Taxable',     color: 'var(--r-c-taxable)' },
  Traditional: { label: 'Traditional', color: 'var(--r-c-traditional)' },
  Roth:        { label: 'Roth',        color: 'var(--r-c-roth)' },
  HSA:         { label: 'HSA',         color: 'var(--r-c-hsa)' },
};
const KIND_KEYS: AccountType[] = ['Taxable', 'Traditional', 'Roth', 'HSA'];

export function PageAccounts() {
  const { loadAccounts, createAccount, deleteAccount, updateAccount } = usePlan();
  const accountsWithHoldings = usePlanSelectors.useAccountsWithHoldings();
  const isReady = usePlanSelectors.useIsReady();

  const [filter, setFilter] = useState<'all' | AccountType>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<CreateAccountData>({ name: '', institution: '', type: 'Taxable' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; institution: string; type: AccountType } | null>(null);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const totals: Record<string, number> = {};
  let grand = 0;
  for (const a of accountsWithHoldings) {
    totals[a.account.type] = (totals[a.account.type] || 0) + (a.currentBalance || 0);
    grand += a.currentBalance || 0;
  }
  const filtered = filter === 'all' ? accountsWithHoldings : accountsWithHoldings.filter(a => a.account.type === filter);

  const handleAdd = async () => {
    if (!draft.name.trim() || !draft.institution.trim()) return;
    await createAccount(draft);
    setDraft({ name: '', institution: '', type: 'Taxable' });
    setShowAdd(false);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editDraft) return;
    await updateAccount(id, { name: editDraft.name, institution: editDraft.institution, type: editDraft.type });
    setEditingId(null); setEditDraft(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete account "${name}"? This cannot be undone.`)) return;
    await deleteAccount(id);
  };

  return (
    <>
      <div className="r-page-head">
        <div>
          <h1>Accounts</h1>
          <div className="sub">
            {accountsWithHoldings.length} {accountsWithHoldings.length === 1 ? 'account' : 'accounts'} across {Object.keys(totals).length || 0} {Object.keys(totals).length === 1 ? 'category' : 'categories'}. Total {fmtCurrency(grand, true)}.
          </div>
        </div>
        <div className="right">
          <button type="button" className="r-btn btn-primary r-btn-primary" onClick={() => setShowAdd(s => !s)}>
            <Icon name="plus" /> Add account
          </button>
        </div>
      </div>

      <div className="r-kpi-row" style={{ gridTemplateColumns: `repeat(${KIND_KEYS.length + 1}, 1fr)` }}>
        <Bucket label="All" value={grand} active={filter === 'all'} onClick={() => setFilter('all')} color="var(--r-ink)" />
        {KIND_KEYS.map(k => (
          <Bucket key={k} label={KIND_META[k].label} value={totals[k] || 0} color={KIND_META[k].color} active={filter === k} onClick={() => setFilter(k)} />
        ))}
      </div>

      {showAdd && (
        <Card title="New account" actions={
          <button type="button" className="r-btn r-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
        }>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <div className="r-field">
              <label>Name</label>
              <input className="r-input" type="text" value={draft.name} placeholder="e.g. Joint Brokerage"
                     onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="r-field">
              <label>Institution</label>
              <input className="r-input" type="text" value={draft.institution} placeholder="e.g. Fidelity"
                     onChange={e => setDraft({ ...draft, institution: e.target.value })} />
            </div>
            <div className="r-field">
              <label>Type</label>
              <select className="r-select" value={draft.type}
                      onChange={e => setDraft({ ...draft, type: e.target.value as AccountType })}>
                {KIND_KEYS.map(k => <option key={k} value={k}>{KIND_META[k].label}</option>)}
              </select>
            </div>
            <button type="button" className="r-btn r-btn-primary" onClick={handleAdd}>Create</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--r-ink-3)', marginTop: 8 }}>
            New accounts start with $0. Add holdings or import a statement from the account detail view.
          </div>
        </Card>
      )}

      <Card flush
            title={filter === 'all' ? 'All accounts' : KIND_META[filter].label + ' accounts'}
            sub={`${filtered.length} ${filtered.length === 1 ? 'account' : 'accounts'}`}>
        {!isReady && filtered.length === 0 ? (
          <div className="r-empty">Loading accounts…</div>
        ) : filtered.length === 0 ? (
          <div className="r-empty">No accounts in this bucket yet.</div>
        ) : (
          <table className="r-tbl">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Institution</th>
                <th className="r">Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ account, currentBalance }) => {
                const isEditing = editingId === account.id;
                return (
                  <tr key={account.id}>
                    <td>
                      {isEditing ? (
                        <input className="r-input" type="text" value={editDraft?.name ?? ''}
                               onChange={e => setEditDraft(d => d ? { ...d, name: e.target.value } : d)} />
                      ) : (
                        <div style={{ fontWeight: 500 }}>{account.name}</div>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <select className="r-select" value={editDraft?.type ?? account.type}
                                onChange={e => setEditDraft(d => d ? { ...d, type: e.target.value as AccountType } : d)}>
                          {KIND_KEYS.map(k => <option key={k} value={k}>{KIND_META[k].label}</option>)}
                        </select>
                      ) : (
                        <span className="r-chip" style={{ background: 'transparent', borderColor: KIND_META[account.type].color, color: KIND_META[account.type].color }}>
                          <span className="r-dot" style={{ background: KIND_META[account.type].color }} />
                          {KIND_META[account.type].label}
                        </span>
                      )}
                    </td>
                    <td style={{ color: 'var(--r-ink-2)' }}>
                      {isEditing ? (
                        <input className="r-input" type="text" value={editDraft?.institution ?? ''}
                               onChange={e => setEditDraft(d => d ? { ...d, institution: e.target.value } : d)} />
                      ) : account.institution}
                    </td>
                    <td className="r mono" style={{ fontWeight: 600 }}>{fmtCurrency(currentBalance || 0)}</td>
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <>
                          <button type="button" className="r-btn r-btn-ghost r-btn-icon" title="Save"
                                  onClick={() => handleSaveEdit(account.id)}><Icon name="check" /></button>
                          <button type="button" className="r-btn r-btn-ghost r-btn-icon" title="Cancel"
                                  onClick={() => { setEditingId(null); setEditDraft(null); }}>×</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="r-btn r-btn-ghost r-btn-icon" title="Edit"
                                  onClick={() => { setEditingId(account.id); setEditDraft({ name: account.name, institution: account.institution, type: account.type }); }}>
                            <Icon name="edit" />
                          </button>
                          <button type="button" className="r-btn r-btn-ghost r-btn-icon" title="Delete"
                                  onClick={() => handleDelete(account.id, account.name)}>
                            <Icon name="trash" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div style={{ fontSize: 11, color: 'var(--r-ink-3)' }}>
        Need to populate holdings? Open an account&rsquo;s detail view (legacy UI) to upload a statement via OCR or add transactions.
      </div>
    </>
  );
}

function Bucket({ label, value, color, active, onClick }: { label: string; value: number; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'var(--r-surface)',
        border: '1px solid ' + (active ? 'var(--r-ink)' : 'var(--r-line)'),
        borderRadius: 'var(--r-radius-lg)',
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 6,
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="r-dot" style={{ background: color, width: 8, height: 8 }} />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--r-ink-3)' }}>{label}</span>
      </div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--r-ink)' }}>{fmtCurrency(value, true)}</div>
    </button>
  );
}
