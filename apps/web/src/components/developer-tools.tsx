"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Database, Download, Upload, Trash2, Info } from 'lucide-react';
// import { clearStoredData, exportStoredData, importStoredData } from '@/services/database';

export function DeveloperTools() {
  const [message, setMessage] = useState<string>('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [isVisible, setIsVisible] = useState(false);

  const showMessage = (msg: string, type: 'success' | 'error' = 'success') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleExport = () => {
    try {
      // const data = exportStoredData();
      const data = 'Export functionality temporarily disabled during PostgreSQL migration';
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `retire-accounts-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showMessage('Data exported successfully!');
    } catch (error) {
      showMessage('Failed to export data', 'error');
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        // await importStoredData(text);
        throw new Error('Import functionality temporarily disabled during PostgreSQL migration');
        showMessage('Data imported successfully! Refresh the page to see changes.');
      } catch (error) {
        showMessage('Failed to import data: ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
      }
    };
    input.click();
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to clear all stored account data? This cannot be undone.')) {
      try {
        // clearStoredData();
        throw new Error('Clear functionality temporarily disabled during PostgreSQL migration');
        showMessage('All data cleared successfully! Refresh the page to see changes.');
      } catch (error) {
        showMessage('Failed to clear data', 'error');
      }
    }
  };

  const getStorageInfo = () => {
    if (typeof window === 'undefined') return { size: 0, hasData: false };

    const accounts = localStorage.getItem('retire_individual_accounts');
    const snapshots = localStorage.getItem('retire_account_snapshots');
    const catchUps = localStorage.getItem('retire_catch_up_calculations');

    const size = (accounts?.length || 0) + (snapshots?.length || 0) + (catchUps?.length || 0);
    const hasData = !!(accounts || snapshots || catchUps);

    return { size, hasData };
  };

  const storageInfo = getStorageInfo();

  // Only show in development
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isVisible ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsVisible(true)}
          className="bg-background shadow-lg"
        >
          <Database className="h-4 w-4 mr-1" />
          Dev Tools
        </Button>
      ) : (
        <Card className="w-80 shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center">
                <Database className="h-4 w-4 mr-2" />
                Developer Tools
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsVisible(false)}
              >
                ×
              </Button>
            </div>
            <CardDescription>
              Manage localStorage data for individual accounts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Storage Info */}
            <div className="flex items-center justify-between text-sm">
              <span>Storage Status:</span>
              <Badge variant={storageInfo.hasData ? 'default' : 'outline'}>
                {storageInfo.hasData ? `${Math.round(storageInfo.size / 1024)}KB used` : 'No data'}
              </Badge>
            </div>

            {/* Message */}
            {message && (
              <Alert variant={messageType === 'error' ? 'destructive' : 'default'}>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {message}
                </AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                className="w-full"
                disabled={!storageInfo.hasData}
              >
                <Download className="h-3 w-3 mr-2" />
                Export Data
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleImport}
                className="w-full"
              >
                <Upload className="h-3 w-3 mr-2" />
                Import Data
              </Button>

              <Button
                variant="destructive"
                size="sm"
                onClick={handleClear}
                className="w-full"
                disabled={!storageInfo.hasData}
              >
                <Trash2 className="h-3 w-3 mr-2" />
                Clear All Data
              </Button>
            </div>

            <div className="text-xs text-muted-foreground border-t pt-2">
              Data is stored in browser localStorage and persists between sessions.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}