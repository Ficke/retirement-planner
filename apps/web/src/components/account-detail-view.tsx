"use client";

import { useState, useEffect } from 'react';
import { getHoldingsClient } from '@/services/client/holdings-client';
import { usePlan } from '@/state/usePlan';
import type { Account, SecurityHolding, AccountTransaction } from '@/domain/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Building, CreditCard, TrendingUp, Plus, Edit, Trash2, Upload } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { TransactionUploadForm } from '@/components/transaction-upload-form';
import { TransactionOcrUploader } from '@/components/transaction-ocr-uploader';

interface AccountDetailViewProps {
  account: Account;
  onBack: () => void;
}

export function AccountDetailView({ account, onBack }: AccountDetailViewProps) {
  const [holdings, setHoldings] = useState<SecurityHolding[]>([]);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [isLoadingHoldings, setIsLoadingHoldings] = useState(true);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
  const [error, setError] = useState<string>('');
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [showOcrUploader, setShowOcrUploader] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<AccountTransaction | null>(null);
  const { refreshAggregation, clearSimulationResults } = usePlan();

  // Simple function to refresh all data from database
  const refreshData = async () => {
    await Promise.all([loadHoldings(), loadTransactions()]);
    // No global refresh needed - account list will update when user navigates back
  };

  // Load holdings from database
  const loadHoldings = async () => {
    try {
      setIsLoadingHoldings(true);
      const holdingsClient = getHoldingsClient();
      const holdingsData = await holdingsClient.getHoldings(account.id);

      if (holdingsData && holdingsData.holdings) {
        setHoldings(holdingsData.holdings);
      } else {
        setHoldings([]);
      }
      setError('');
    } catch (err) {
      console.error('Holdings loading error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load holdings');
      setHoldings([]);
    } finally {
      setIsLoadingHoldings(false);
    }
  };

  // Load holdings on mount and account change
  useEffect(() => {
    loadHoldings();
  }, [account.id]);

  // Load transactions from database
  const loadTransactions = async () => {
    try {
      setIsLoadingTransactions(true);
      const { getAccountsClient } = await import('@/services/client/accounts-client');
      const accountsClient = getAccountsClient();
      const transactionsData = await accountsClient.getTransactions(account.id);
      setTransactions(transactionsData);
      setError('');
    } catch (err) {
      console.error('Transactions loading error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
      setTransactions([]);
    } finally {
      setIsLoadingTransactions(false);
    }
  };

  // Load transactions on mount and account change
  useEffect(() => {
    loadTransactions();
  }, [account.id]);

  const handleTransactionEdit = (transactionId: string) => {
    const transaction = transactions.find(t => t.id === transactionId);
    if (!transaction) return;

    setEditingTransaction(transaction);
    setShowTransactionForm(true);
  };

  const handleTransactionDelete = async (transactionId: string) => {
    if (!confirm('Are you sure you want to delete this transaction?')) {
      return;
    }

    try {
      const { getAccountsClient } = await import('@/services/client/accounts-client');
      const accountsClient = getAccountsClient();
      await accountsClient.deleteTransaction(account.id, transactionId);

      // Simple: just refresh all data from database
      await refreshData();
      setError('');
    } catch (err) {
      console.error('Transaction delete error:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete transaction');
    }
  };

  const calculateTotalValue = () => {
    return holdings.reduce((total, holding) => total + holding.currentValue, 0);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Accounts
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <CreditCard className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">{account.name}</h2>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <Building className="h-4 w-4" />
                  {account.institution}
                </div>
                <Badge variant="outline">{account.type}</Badge>
                {holdings.length > 0 && (
                  <Badge variant="default" className="bg-green-100 text-green-800 border-green-200">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    Securities Tracked
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setShowOcrUploader(!showOcrUploader);
              setShowTransactionForm(false);
            }}
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Transaction
          </Button>
          <Button onClick={() => {
            setShowTransactionForm(!showTransactionForm);
            setShowOcrUploader(false);
            setEditingTransaction(null); // Clear edit mode when toggling
          }}>
            <Plus className="h-4 w-4 mr-2" />
            {showTransactionForm ? 'Cancel' : 'Transact'}
          </Button>
        </div>
      </div>

      {/* OCR Upload Form */}
      {showOcrUploader && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Transaction Image</CardTitle>
            <CardDescription>
              Upload an image of your transaction and we'll extract the details automatically
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TransactionOcrUploader
              accountId={account.id}
              onSuccess={async () => {
                setShowOcrUploader(false);
                await refreshData();
              }}
              onCancel={() => {
                setShowOcrUploader(false);
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Inline Transaction Form */}
      {showTransactionForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add Transaction</CardTitle>
            <CardDescription>
              Add a buy or sell transaction for {account.name}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TransactionUploadForm
              accountId={account.id}
              editTransaction={editingTransaction ? {
                id: editingTransaction.id,
                symbol: editingTransaction.symbol,
                shares: editingTransaction.shares,
                transactionDate: editingTransaction.transactionDate,
                transactionType: editingTransaction.transactionType,
                description: editingTransaction.description
              } : undefined}
              onSuccess={async () => {
                setShowTransactionForm(false);
                setEditingTransaction(null);
                await refreshData(); // Refresh all data from database
              }}
              onCancel={() => {
                setShowTransactionForm(false);
                setEditingTransaction(null);
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Tabbed Content */}
      <Tabs defaultValue="holdings" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="holdings">Current Balance</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
        </TabsList>

        <TabsContent value="holdings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Securities Holdings</CardTitle>
              <CardDescription>
                Current portfolio value: {formatCurrency(calculateTotalValue())}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingHoldings ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...Array(3)].map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><div className="h-4 bg-gray-200 rounded w-16 animate-pulse"></div></TableCell>
                        <TableCell className="text-right"><div className="h-4 bg-gray-200 rounded w-20 animate-pulse ml-auto"></div></TableCell>
                        <TableCell className="text-right"><div className="h-4 bg-gray-200 rounded w-16 animate-pulse ml-auto"></div></TableCell>
                        <TableCell className="text-right"><div className="h-4 bg-gray-200 rounded w-24 animate-pulse ml-auto"></div></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : error && !isLoadingHoldings ? (
                <div className="text-red-600 text-center py-4">{error}</div>
              ) : holdings.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <TrendingUp className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p>No securities holdings found</p>
                  <p className="text-sm">Add your first transaction to get started</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {holdings.map((holding) => (
                      <TableRow key={holding.symbol}>
                        <TableCell className="font-medium">{holding.symbol}</TableCell>
                        <TableCell className="text-right">{holding.totalShares.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{formatCurrency(holding.currentPrice || 0)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(holding.currentValue)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold border-t-2">
                      <TableCell colSpan={3}>Total</TableCell>
                      <TableCell className="text-right">{formatCurrency(calculateTotalValue())}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Transaction History</CardTitle>
              <CardDescription>
                All buy/sell transactions for this account
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingTransactions ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...Array(3)].map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><div className="h-4 bg-gray-200 rounded w-20 animate-pulse"></div></TableCell>
                        <TableCell><div className="h-4 bg-gray-200 rounded w-16 animate-pulse"></div></TableCell>
                        <TableCell><div className="h-4 bg-gray-200 rounded w-12 animate-pulse"></div></TableCell>
                        <TableCell className="text-right"><div className="h-4 bg-gray-200 rounded w-20 animate-pulse ml-auto"></div></TableCell>
                        <TableCell className="text-right"><div className="h-4 bg-gray-200 rounded w-16 animate-pulse ml-auto"></div></TableCell>
                        <TableCell className="text-right"><div className="h-6 bg-gray-200 rounded w-16 animate-pulse ml-auto"></div></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : error && !isLoadingTransactions ? (
                <div className="text-red-600 text-center py-4">{error}</div>
              ) : !Array.isArray(transactions) || transactions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <CreditCard className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p>No transactions found</p>
                  <p className="text-sm">Your transaction history will appear here</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.isArray(transactions) ? transactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell>
                          {new Date(transaction.transactionDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-medium">{transaction.symbol}</TableCell>
                        <TableCell>
                          <Badge variant={transaction.transactionType === 'BUY' ? 'default' : 'destructive'}>
                            {transaction.transactionType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{transaction.shares.toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          {transaction.pricePerShare ? formatCurrency(transaction.pricePerShare) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTransactionEdit(transaction.id)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTransactionDelete(transaction.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )) : null}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}