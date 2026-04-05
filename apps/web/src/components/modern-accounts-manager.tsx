/**
 * Account manager with inline balance and allocation editing
 */

"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePlan, usePlanSelectors } from '@/state/usePlan';
import type { AccountType, CreateAccountData } from '@/domain/types';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Trash2, Building, CreditCard, AlertCircle, Loader2, Pencil, Check, X } from 'lucide-react';

interface EditingState {
  accountId: string;
  balance: string;
  stocksPct: string;
}

interface NewAccountState {
  name: string;
  institution: string;
  type: AccountType;
  balance: string;
  stocksPct: string;
}

export function ModernAccountsManager() {
  const { createAccount, updateAccount, deleteAccount, loadAccounts } = usePlan();

  const accountsWithHoldings = usePlanSelectors.useAccountsWithHoldings();
  const accountsLoading = usePlanSelectors.useAccountsLoading();
  const error = usePlanSelectors.useError();
  const isReady = usePlanSelectors.useIsReady();

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const balanceInputRef = useRef<HTMLInputElement>(null);

  const [newAccount, setNewAccount] = useState<NewAccountState>({
    name: '',
    institution: '',
    type: 'Taxable',
    balance: '',
    stocksPct: '60',
  });

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Focus balance input when entering edit mode
  useEffect(() => {
    if (editing && balanceInputRef.current) {
      balanceInputRef.current.focus();
      balanceInputRef.current.select();
    }
  }, [editing?.accountId]);

  const handleAddAccount = useCallback(async () => {
    if (!newAccount.name.trim()) return;

    const balance = parseFloat(newAccount.balance) || 0;
    const stocksPct = parseFloat(newAccount.stocksPct) / 100 || 0.6;

    try {
      await createAccount({
        name: newAccount.name.trim(),
        institution: newAccount.institution.trim() || '',
        type: newAccount.type,
        balance,
        stocksPct,
        bondsPct: 1 - stocksPct,
      });
      setNewAccount({ name: '', institution: '', type: 'Taxable', balance: '', stocksPct: '60' });
    } catch {
      // Error handled by store
    }
  }, [newAccount, createAccount]);

  const startEditing = useCallback((accountId: string, balance: number, stocksPct: number) => {
    setEditing({
      accountId,
      balance: balance > 0 ? balance.toString() : '',
      stocksPct: (stocksPct * 100).toFixed(0),
    });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditing(null);
  }, []);

  const saveEditing = useCallback(async () => {
    if (!editing || saving) return;

    const balance = parseFloat(editing.balance) || 0;
    const stocksPct = parseFloat(editing.stocksPct) / 100;
    const bondsPct = 1 - stocksPct;

    if (isNaN(stocksPct) || stocksPct < 0 || stocksPct > 1) return;

    setSaving(true);
    try {
      await updateAccount(editing.accountId, {
        balance,
        assetWeights: { stocks: stocksPct, bonds: bondsPct },
        balanceAsOf: new Date().toISOString().split('T')[0],
      });
      setEditing(null);
    } catch {
      // Error handled by store
    } finally {
      setSaving(false);
    }
  }, [editing, saving, updateAccount]);

  if (accountsLoading === 'loading') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Building className="h-5 w-5" />
            <span>Account Management</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8">
            <div className="text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
              <p className="text-muted-foreground">Loading your accounts...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (accountsLoading === 'error' && error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Building className="h-5 w-5" />
            <span>Account Management</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => loadAccounts()} className="ml-4">
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Building className="h-5 w-5" />
          <span>Accounts</span>
        </CardTitle>
        <CardDescription>
          Set your account balances and stock/bond allocation. Click the pencil to edit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Stocks %</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accountsWithHoldings.map(({ account, currentBalance }) => {
                const isEditing = editing?.accountId === account.id;

                return (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <CreditCard className="h-3 w-3 text-blue-600" />
                        <div>
                          <span className="font-medium">{account.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">{account.institution}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{account.type}</Badge>
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Input
                          ref={balanceInputRef}
                          type="number"
                          value={editing.balance}
                          onChange={(e) => setEditing({ ...editing, balance: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && saveEditing()}
                          className="w-32"
                        />
                      ) : (
                        <span className="font-medium">{formatCurrency(currentBalance || 0)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <div className="flex items-center space-x-1">
                          <Input
                            type="number"
                            value={editing.stocksPct}
                            onChange={(e) => setEditing({ ...editing, stocksPct: e.target.value })}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditing()}
                            className="w-16"
                            min={0}
                            max={100}
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                      ) : (
                        <span>{(account.assetWeights.stocks * 100).toFixed(0)}%</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-1">
                        {isEditing ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={saveEditing} disabled={saving}>
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={cancelEditing}>
                              <X className="h-3 w-3" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEditing(account.id, account.balance, account.assetWeights.stocks)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteAccount(account.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}

              {/* Total row */}
              {accountsWithHoldings.length > 0 && (
                <TableRow className="border-t-2 bg-muted/50">
                  <TableCell colSpan={2} className="font-semibold">Total</TableCell>
                  <TableCell className="font-bold">
                    {formatCurrency(accountsWithHoldings.reduce((sum, a) => sum + (a.currentBalance || 0), 0))}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              )}

              {/* Add new account row */}
              <TableRow>
                <TableCell>
                  <div className="flex space-x-2">
                    <Input
                      placeholder="Name"
                      value={newAccount.name}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, name: e.target.value }))}
                      className="w-28"
                    />
                    <Input
                      placeholder="Institution"
                      value={newAccount.institution}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, institution: e.target.value }))}
                      className="w-28"
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={newAccount.type}
                    onValueChange={(value: AccountType) => setNewAccount(prev => ({ ...prev, type: value }))}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Taxable">Taxable</SelectItem>
                      <SelectItem value="Traditional">Traditional</SelectItem>
                      <SelectItem value="Roth">Roth</SelectItem>
                      <SelectItem value="HSA">HSA</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    placeholder="Balance"
                    value={newAccount.balance}
                    onChange={(e) => setNewAccount(prev => ({ ...prev, balance: e.target.value }))}
                    className="w-32"
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center space-x-1">
                    <Input
                      type="number"
                      value={newAccount.stocksPct}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, stocksPct: e.target.value }))}
                      className="w-16"
                      min={0}
                      max={100}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Button onClick={handleAddAccount} disabled={!newAccount.name.trim()} size="sm">
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {accountsWithHoldings.length === 0 && isReady && (
          <div className="text-center py-8">
            <Building className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No accounts yet</h3>
            <p className="text-muted-foreground">Add your first account above to start projecting your retirement.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
