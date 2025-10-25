"use client";

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getAccountsClient } from '@/services/client/accounts-client';
import { getMarketDataClient } from '@/services/client/market-data-client';
import { searchSecurities } from '@/data/securities-master';
import type { Account, TransactionType } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { X, TrendingUp, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

interface TransactionUploadFormProps {
  accountId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  editTransaction?: {
    id: string;
    symbol: string;
    shares: number;
    transactionDate: string;
    transactionType: TransactionType;
    description?: string;
  };
}

export function TransactionUploadForm({ accountId, onSuccess, onCancel, editTransaction }: TransactionUploadFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isPriceFetching, setIsPriceFetching] = useState(false);
  const [error, setError] = useState<string>("");
  const [account, setAccount] = useState<Account | null>(null);

  const [newTransaction, setNewTransaction] = useState({
    symbol: editTransaction?.symbol || '',
    shares: editTransaction?.shares?.toString() || '',
    transactionDate: editTransaction?.transactionDate || new Date().toISOString().split('T')[0],
    transactionType: editTransaction?.transactionType || 'BUY' as TransactionType,
    description: editTransaction?.description || '',
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [symbolSearch, setSymbolSearch] = useState(editTransaction?.symbol || '');
  const [suggestedSecurities, setSuggestedSecurities] = useState<Array<{symbol: string, name: string}>>([]);
  const [fetchedPrice, setFetchedPrice] = useState<number | null>(null);
  const [priceWarning, setPriceWarning] = useState<string>('');

  // Load account info
  useEffect(() => {
    const loadAccount = async () => {
      try {
        const accountsClient = getAccountsClient();
        const account = await accountsClient.getAccount(accountId);
        setAccount(account);
      } catch (err) {
        setError('Failed to load account information');
      }
    };
    loadAccount();
  }, [accountId]);

  const handleSymbolSearch = useCallback((query: string) => {
    setSymbolSearch(query);
    if (query.length >= 1) {
      const securities = searchSecurities(query).slice(0, 5);
      setSuggestedSecurities(securities);
    } else {
      setSuggestedSecurities([]);
    }
  }, []);

  // Validation helper function
  const getFieldError = useCallback((field: string, value: string): string => {
    switch (field) {
      case 'symbol':
        return !value.trim() ? 'Security symbol is required' : '';
      case 'shares':
        if (!value.trim()) return 'Number of shares is required';
        if (isNaN(parseFloat(value)) || parseFloat(value) <= 0) return 'Must be a positive number';
        return '';
      case 'transactionDate':
        if (!value) return 'Transaction date is required';
        if (new Date(value) > new Date()) return 'Date cannot be in the future';
        return '';
      default:
        return '';
    }
  }, []);

  // Handle field changes with validation
  const handleFieldChange = useCallback((field: string, value: string) => {
    setNewTransaction(prev => ({ ...prev, [field]: value }));

    // Immediate validation feedback
    const fieldError = getFieldError(field, value);
    setFieldErrors(prev => ({
      ...prev,
      [field]: fieldError
    }));
  }, [getFieldError]);

  // Handle shares input specifically (remove commas and validate number)
  const handleSharesChange = useCallback((value: string) => {
    const cleanValue = value.replace(/,/g, '');
    handleFieldChange('shares', cleanValue);
  }, [handleFieldChange]);

  const selectSecurity = useCallback((symbol: string, name: string) => {
    const upperSymbol = symbol.toUpperCase();
    setNewTransaction(prev => ({ ...prev, symbol: upperSymbol }));
    setSymbolSearch(`${upperSymbol} - ${name}`);
    setSuggestedSecurities([]);
    setFieldErrors(prev => ({ ...prev, symbol: '' }));
    setFetchedPrice(null);
  }, []);

  // Fetch price during form submission only
  const fetchPriceForSubmission = useCallback(async (symbol: string, date: string): Promise<number | null> => {
    try {
      const marketDataClient = getMarketDataClient();
      const price = await marketDataClient.getPrice(symbol, date);
      return price;
    } catch (err) {
      console.warn('Failed to fetch price:', err);

      // Re-throw with user-friendly message
      throw new Error(
        err instanceof Error && err.message.includes('404')
          ? `Price data not available for ${symbol} on ${date}. Historical data may not be available for this date.`
          : `Unable to fetch current price for ${symbol}. Please check your internet connection and try again.`
      );
    }
  }, []);

  // Check if form is valid for submit button state
  const isFormValid = useMemo(() => {
    return !!(
      newTransaction.symbol &&
      newTransaction.symbol.trim() &&
      newTransaction.shares &&
      newTransaction.shares.trim() &&
      !isNaN(parseFloat(newTransaction.shares)) &&
      parseFloat(newTransaction.shares) > 0 &&
      newTransaction.transactionDate &&
      new Date(newTransaction.transactionDate) <= new Date() // Allow today and past dates
    );
  }, [newTransaction]);

  const validateForm = useCallback(() => {
    const errors: Record<string, string> = {
      symbol: getFieldError('symbol', newTransaction.symbol),
      shares: getFieldError('shares', newTransaction.shares),
      transactionDate: getFieldError('transactionDate', newTransaction.transactionDate),
    };

    const filteredErrors = Object.fromEntries(
      Object.entries(errors).filter(([, error]) => error !== '')
    );

    setFieldErrors(filteredErrors);
    return Object.keys(filteredErrors).length === 0;
  }, [newTransaction, getFieldError]);

  const handleAddTransaction = useCallback(async () => {
    setError("");

    if (!validateForm()) {
      setError('Please fix the errors above and try again');
      return;
    }

    setIsLoading(true);

    try {
      const symbol = newTransaction.symbol.toUpperCase().trim();
      const accountsClient = getAccountsClient();
      let submissionPrice: number | null = null;

      // Try to fetch price, but handle failures differently for edit vs create
      let priceWarning = '';
      try {
        submissionPrice = await fetchPriceForSubmission(symbol, newTransaction.transactionDate);
      } catch (priceError) {
        if (editTransaction) {
          // For edits, allow transaction to proceed without price update
          console.warn('Price fetch failed during transaction edit, proceeding without price update:', priceError);
          priceWarning = priceError instanceof Error ? priceError.message : 'Could not fetch updated price';
        } else {
          // For new transactions, require a price
          throw priceError;
        }
      }

      if (editTransaction) {
        // Update existing transaction
        const updateData: any = {
          shares: parseFloat(newTransaction.shares),
          transactionDate: newTransaction.transactionDate,
          transactionType: newTransaction.transactionType,
          description: newTransaction.description.trim() || undefined,
        };

        // Only update price if we successfully fetched one
        if (submissionPrice !== null) {
          updateData.pricePerShare = submissionPrice;
        }

        await accountsClient.updateTransaction(accountId, editTransaction.id, updateData);
      } else {
        // Create new transaction
        await accountsClient.addAccountTransaction({
          accountId: accountId,
          symbol: symbol,
          shares: parseFloat(newTransaction.shares),
          transactionDate: newTransaction.transactionDate,
          transactionType: newTransaction.transactionType,
          pricePerShare: submissionPrice || undefined,
          description: newTransaction.description.trim() || undefined,
        });
      }

      // Store the fetched price and warning for display
      setFetchedPrice(submissionPrice);
      setPriceWarning(priceWarning);

      // Reset form only on success
      setNewTransaction({
        symbol: '',
        shares: '',
        transactionDate: new Date().toISOString().split('T')[0],
        transactionType: 'BUY',
        description: '',
      });
      setSymbolSearch('');
      setSuggestedSecurities([]);
      setFieldErrors({});

      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add transaction');
    } finally {
      setIsLoading(false);
    }
  }, [newTransaction, accountId, editTransaction, fetchPriceForSubmission, validateForm, onSuccess]);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              {editTransaction ? 'Edit Transaction' : 'Add Transaction'}
            </CardTitle>
            <CardDescription>
              {editTransaction
                ? `Update transaction in ${account?.name || 'account'}`
                : (account ? `Add holdings to ${account.name}` : 'Add securities transaction')
              }
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <Alert className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}


        <div className="grid gap-4">
          {/* Symbol Search */}
          <div className="grid gap-2">
            <Label htmlFor="symbol">
              Security Symbol *
              {editTransaction && <span className="text-xs text-gray-500 ml-1">(Cannot be changed)</span>}
            </Label>
            <div className="relative">
              <Input
                id="symbol"
                placeholder="Search by symbol or name (e.g., VTI, NTSX)"
                value={symbolSearch}
                onChange={(e) => {
                  const inputValue = e.target.value;
                  handleSymbolSearch(inputValue);
                  if (!suggestedSecurities.length || inputValue.length <= 4) {
                    handleFieldChange('symbol', inputValue.toUpperCase());
                  }
                }}
                disabled={isLoading || !!editTransaction}
                className={fieldErrors.symbol ? 'border-red-500' : ''}
              />
              {suggestedSecurities.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
                  {suggestedSecurities.map((security) => (
                    <button
                      key={security.symbol}
                      className="w-full px-3 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                      onClick={() => selectSecurity(security.symbol, security.name)}
                    >
                      <div className="font-medium">{security.symbol}</div>
                      <div className="text-sm text-gray-600">{security.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {fieldErrors.symbol && (
              <p className="text-sm text-red-600">{fieldErrors.symbol}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Transaction Type */}
            <div className="grid gap-2">
              <Label htmlFor="transactionType">Type *</Label>
              <Select
                value={newTransaction.transactionType}
                onValueChange={(value: TransactionType) =>
                  setNewTransaction(prev => ({ ...prev, transactionType: value }))
                }
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUY">Buy</SelectItem>
                  <SelectItem value="SELL">Sell</SelectItem>
                  <SelectItem value="DIVIDEND_REINVEST">Dividend Reinvest</SelectItem>
                  <SelectItem value="SPLIT">Stock Split</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Shares */}
            <div className="grid gap-2">
              <Label htmlFor="shares">Shares *</Label>
              <Input
                id="shares"
                type="text"
                placeholder="100"
                value={newTransaction.shares}
                onChange={(e) => handleSharesChange(e.target.value)}
                disabled={isLoading}
                className={fieldErrors.shares ? 'border-red-500' : ''}
              />
              {fieldErrors.shares && (
                <p className="text-sm text-red-600">{fieldErrors.shares}</p>
              )}
            </div>
          </div>

          {/* Transaction Date */}
          <div className="grid gap-2">
            <Label htmlFor="transactionDate">Date *</Label>
            <Input
              id="transactionDate"
              type="date"
              value={newTransaction.transactionDate}
              onChange={(e) => handleFieldChange('transactionDate', e.target.value)}
              disabled={isLoading}
              className={fieldErrors.transactionDate ? 'border-red-500' : ''}
            />
            {fieldErrors.transactionDate && (
              <p className="text-sm text-red-600">{fieldErrors.transactionDate}</p>
            )}
          </div>


          {/* Description */}
          <div className="grid gap-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Input
              id="description"
              placeholder="Optional notes about this transaction"
              value={newTransaction.description}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Price Display Section */}
        {fetchedPrice !== null && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-800">
                Market Price Fetched: ${fetchedPrice.toFixed(2)} per share
              </span>
            </div>
            <p className="text-xs text-green-700 mt-1">
              Transaction successfully created with current market price from {newTransaction.transactionDate}
            </p>
          </div>
        )}

        {/* Price Warning Section */}
        {priceWarning && (
          <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-medium text-orange-800">
                Transaction Updated Successfully
              </span>
            </div>
            <p className="text-xs text-orange-700 mt-1">
              {priceWarning}. The transaction was saved but the price was not updated.
            </p>
          </div>
        )}

        <div className="space-y-2 mt-6">
          {!isFormValid && (
            <div className="text-sm text-orange-600 bg-orange-50 p-2 rounded border">
              ℹ️ Please fill in all required fields to continue
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddTransaction}
              disabled={isLoading || !isFormValid}
              className={!isFormValid ? 'opacity-50 cursor-not-allowed' : ''}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {editTransaction ? 'Updating...' : 'Adding...'}
                </>
              ) : (
                editTransaction ? 'Update Transaction' : 'Add Transaction'
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}