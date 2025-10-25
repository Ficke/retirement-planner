/**
 * Modern unified account manager - single holdings-enabled interface
 * Replaces dual account system with consolidated holdings-first design
 */

"use client";

import { useState, useCallback, useEffect } from 'react';
import { usePlan, usePlanSelectors } from '@/state/usePlan';
import { getHoldingsClient } from '@/services/client/holdings-client';
import type { AccountType, CreateAccountData } from '@/domain/types';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Trash2, TrendingUp, Building, CreditCard, AlertCircle, Loader2 } from 'lucide-react';
import { AccountDetailView } from './account-detail-view';
import { TransactionUploadForm } from './transaction-upload-form';

export function ModernAccountsManager() {
  const { createAccount, updateAccount, deleteAccount, loadAccounts } = usePlan();

  // Modern selectors with enhanced loading states
  const accountsWithHoldings = usePlanSelectors.useAccountsWithHoldings();
  const loadingState = usePlanSelectors.useLoadingState();
  const accountsLoading = usePlanSelectors.useAccountsLoading();
  const error = usePlanSelectors.useError();
  const isReady = usePlanSelectors.useIsReady();

  const [selectedAccountForDetail, setSelectedAccountForDetail] = useState<string | null>(null);

  const [newAccount, setNewAccount] = useState<CreateAccountData>({
    name: '',
    institution: '',
    type: 'Taxable',
  });

  // Load accounts and portfolio values on mount
  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Refresh account balances when navigating back to accounts page
  // This ensures fresh data from database (single source of truth)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadAccounts();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadAccounts]);

  // Portfolio values are now included in accountsWithHoldings.currentBalance
  // No separate loading needed

  const handleAddAccount = useCallback(async () => {
    if (!newAccount.name.trim() || !newAccount.institution.trim()) {
      return;
    }

    try {
      await createAccount(newAccount);
      setNewAccount({
        name: '',
        institution: '',
        type: 'Taxable',
      });
    } catch (error) {
      // Error is handled by the store
    }
  }, [newAccount, createAccount]);

  const handleUpdateAccount = useCallback(async (
    id: string,
    field: keyof Omit<CreateAccountData, 'id' | 'createdAt'>,
    value: string
  ) => {
    try {
      await updateAccount(id, { [field]: value });
    } catch (error) {
      // Error is handled by the store
    }
  }, [updateAccount]);

  const handleAccountClick = useCallback((accountId: string) => {
    setSelectedAccountForDetail(accountId);
  }, []);

  const handleBackToAccounts = useCallback(() => {
    setSelectedAccountForDetail(null);
    // Refresh account list to show updated balances
    loadAccounts();
  }, [loadAccounts]);


  // If viewing account details, show that instead
  if (selectedAccountForDetail) {
    const individualAccount = accountsWithHoldings.find(acc => acc.account.id === selectedAccountForDetail);
    if (individualAccount) {
      return (
        <AccountDetailView
          account={individualAccount.account}
          onBack={handleBackToAccounts}
        />
      );
    }
  }

  // Show loading state with modern design
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

  // Show error state with retry option
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadAccounts()}
                className="ml-4"
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Building className="h-5 w-5" />
            <span>Holdings-Enabled Accounts</span>
          </CardTitle>
          <CardDescription>
            Manage all your accounts with comprehensive holdings tracking and automatic market data integration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Modern Single Account Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Current Balance</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Existing Accounts */}
                {accountsWithHoldings.map((accountWithHoldings) => {
                  const { account, currentBalance } = accountWithHoldings;
                  const portfolioValue = currentBalance ?? 0;

                  return (
                    <TableRow
                      key={account.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleAccountClick(account.id)}
                    >
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <div className="p-1 bg-blue-100 rounded">
                            <CreditCard className="h-3 w-3 text-blue-600" />
                          </div>
                          <span className="font-medium">{account.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          <Building className="h-3 w-3 text-gray-500" />
                          <span>{account.institution}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{account.type}</Badge>
                      </TableCell>
                      <TableCell>
                        {portfolioValue !== null && portfolioValue > 0 ? (
                          <div className="flex items-center space-x-1">
                            <span className="font-medium">{formatCurrency(portfolioValue)}</span>
                            <TrendingUp className="h-3 w-3 text-green-500" />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">No holdings</span>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex space-x-2">
                          {/* Transaction form now inline in detail view */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteAccount(account.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {/* Total Assets Row */}
                {accountsWithHoldings.length > 0 && (
                  <TableRow className="border-t-2 border-primary bg-muted/50">
                    <TableCell colSpan={3} className="font-semibold">
                      Total Assets
                    </TableCell>
                    <TableCell className="font-bold text-lg">
                      {formatCurrency(
                        accountsWithHoldings.reduce((sum, acc) => sum + (acc.currentBalance || 0), 0)
                      )}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                )}

                {/* Add new account row */}
                <TableRow>
                  <TableCell>
                    <Input
                      placeholder="Account name"
                      value={newAccount.name}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      placeholder="Institution"
                      value={newAccount.institution}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, institution: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={newAccount.type}
                      onValueChange={(value: AccountType) => setNewAccount(prev => ({ ...prev, type: value }))}
                    >
                      <SelectTrigger>
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
                  <TableCell>-</TableCell>
                  <TableCell>
                    <Button
                      onClick={handleAddAccount}
                      disabled={!newAccount.name.trim() || !newAccount.institution.trim()}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Empty state */}
          {accountsWithHoldings.length === 0 && isReady && (
            <div className="text-center py-8">
              <Building className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No accounts yet</h3>
              <p className="text-muted-foreground mb-4">
                Add your first account to start tracking holdings and projecting your retirement.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction form now inline in account detail view */}
    </div>
  );
}