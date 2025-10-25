"use client";

import { useState, useEffect } from 'react';
import { getHoldingsClient } from '@/services/client/holdings-client';
import type { Account } from '@/domain/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';

interface SecuritiesHoldingsProps {
  account: Account;
  onHoldingsChange?: () => void;
}

export function SecuritiesHoldings({ account, onHoldingsChange }: SecuritiesHoldingsProps) {
  const [holdings, setHoldings] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadHoldings = async () => {
      try {
        setIsLoading(true);
        const holdingsClient = getHoldingsClient();
        const holdingsData = await holdingsClient.getHoldings(account.id);
        setHoldings(holdingsData);
        setError('');
        // Note: onHoldingsChange removed to prevent infinite loops
        // Holdings changes will be reflected through natural re-renders
      } catch (err) {
        console.error('Holdings loading error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load holdings');
      } finally {
        setIsLoading(false);
      }
    };

    loadHoldings();
  }, [account.id]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading Holdings...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-gray-300 rounded w-full"></div>
            <div className="h-4 bg-gray-300 rounded w-3/4"></div>
            <div className="h-4 bg-gray-300 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-600">Error Loading Holdings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-700">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!holdings || !holdings.holdings || holdings.holdings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Holdings Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-700">
            Add securities transactions to see your holdings here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalValue = holdings.holdings.reduce((sum: number, holding: any) => sum + holding.currentValue, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Securities Holdings</span>
          <span className="text-lg font-semibold text-green-600">
            {formatCurrency(totalValue)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
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
              {holdings.holdings.map((holding: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>
                    <span className="font-semibold">{holding.symbol}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {holding.totalShares.toLocaleString('en-US', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 3
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(holding.currentPrice)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-semibold">
                      {formatCurrency(holding.currentValue)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}