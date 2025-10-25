"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, Loader2, AlertTriangle, CheckCircle, ThumbsUp, ThumbsDown } from 'lucide-react';

interface TransactionOcrUploaderProps {
  accountId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

interface GatekeeperOutput {
  is_financial_document: boolean;
  is_legible: boolean;
  reason?: string;
}

interface TransactionData {
  extractedData: Record<string, any>;
  confidenceScores: Record<string, number>;
}

interface ExtractorOutput {
  transactions: TransactionData[];
}

interface ValidatedTransaction {
  validatedData: Record<string, any>;
  confidenceScores: Record<string, number>;
  warnings: string[];
}

interface AuditorOutput {
  transactions: ValidatedTransaction[];
}

interface OcrResult {
  success: boolean;
  imagePath: string;
  gatekeeperOutput: GatekeeperOutput;
  extractorOutput: ExtractorOutput;
  auditorOutput: AuditorOutput;
  error?: string;
}

export function TransactionOcrUploader({ accountId, onSuccess, onCancel }: TransactionOcrUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<string>('');
  const [currentTransactionIndex, setCurrentTransactionIndex] = useState(0);
  const [transactionFormData, setTransactionFormData] = useState<Record<string, any>[]>([]);
  const [originalFormData, setOriginalFormData] = useState<Record<string, any>[]>([]); // Track original OCR values
  const [fieldFeedback, setFieldFeedback] = useState<Record<number, Record<string, 'correct' | 'incorrect' | null>>>({});
  const [isSaving, setIsSaving] = useState(false);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    setSelectedFile(file);
    setError('');

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const processImage = async () => {
    if (!selectedFile || !imagePreview) return;

    setIsProcessing(true);
    setError('');

    try {
      // Define the target schema for transaction extraction
      const targetSchema = {
        date: 'string (YYYY-MM-DD format)',
        symbol: 'string (stock ticker symbol)',
        shares: 'number',
        pricePerShare: 'number',
        transactionType: 'string (BUY or SELL)',
        description: 'string (optional description)'
      };

      // Call OCR API (new 3-stage pipeline)
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData: imagePreview,
          targetSchema
        })
      });

      if (!response.ok) {
        throw new Error('Failed to process image');
      }

      const result = await response.json() as OcrResult;
      console.log('OCR Result:', result);
      setOcrResult(result);

      // Initialize form data for all transactions with auditor's validated data
      if (result.success && result.auditorOutput && result.auditorOutput.transactions.length > 0) {
        const formData = result.auditorOutput.transactions.map(t => t.validatedData);
        console.log('Initializing transactionFormData:', formData);
        setTransactionFormData(formData);
        setOriginalFormData(formData.map(d => ({ ...d }))); // Deep copy for comparison
        setCurrentTransactionIndex(0);
      } else {
        console.warn('Failed to initialize form data:', {
          success: result.success,
          hasAuditorOutput: !!result.auditorOutput,
          transactionCount: result.auditorOutput?.transactions?.length || 0
        });
      }
    } catch (err) {
      console.error('OCR processing error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process image');
    } finally {
      setIsProcessing(false);
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  const handleFieldChange = (field: string, value: string) => {
    setTransactionFormData(prev => {
      const newData = [...prev];
      newData[currentTransactionIndex] = {
        ...newData[currentTransactionIndex],
        [field]: value
      };
      return newData;
    });
  };

  const handleFieldFeedback = (field: string, feedback: 'correct' | 'incorrect') => {
    setFieldFeedback(prev => ({
      ...prev,
      [currentTransactionIndex]: {
        ...(prev[currentTransactionIndex] || {}),
        [field]: prev[currentTransactionIndex]?.[field] === feedback ? null : feedback
      }
    }));
  };

  const currentTransaction = ocrResult?.auditorOutput.transactions[currentTransactionIndex];
  const currentFormData = transactionFormData[currentTransactionIndex] || {};

  // Helper function to check if a field was edited
  const isFieldEdited = (fieldKey: string): boolean => {
    const originalData = originalFormData[currentTransactionIndex];
    if (!originalData) return false;
    return String(currentFormData[fieldKey]) !== String(originalData[fieldKey]);
  };

  const submitFeedback = async () => {
    if (!ocrResult || !currentTransaction) return;

    // Auto-detect if user made any corrections by comparing current vs original
    const originalData = originalFormData[currentTransactionIndex];
    const hasCorrections = originalData && Object.keys(currentFormData).some(
      key => String(currentFormData[key]) !== String(originalData[key])
    );
    const feedbackType = hasCorrections ? 'CORRECTED' : 'APPROVED';

    // Auto-generate field-level feedback based on edits
    const autoFieldFeedback: Record<string, 'correct' | 'incorrect'> = {};
    if (originalData) {
      Object.keys(currentFormData).forEach(key => {
        const wasEdited = String(currentFormData[key]) !== String(originalData[key]);
        // If user manually gave feedback, use that; otherwise auto-detect
        const manualFeedback = fieldFeedback[currentTransactionIndex]?.[key];
        if (manualFeedback) {
          autoFieldFeedback[key] = manualFeedback;
        } else {
          autoFieldFeedback[key] = wasEdited ? 'incorrect' : 'correct';
        }
      });
    }

    console.log('submitFeedback called:', {
      feedbackType,
      hasCorrections,
      currentTransactionIndex,
      transactionFormData,
      currentFormData,
      originalData,
      autoFieldFeedback,
      currentTransaction
    });

    // Validate that we have the required fields
    if (!currentFormData.symbol || !currentFormData.shares || !currentFormData.transactionType) {
      setError(
        `Missing required transaction data. Please ensure the OCR correctly identified:\n` +
        `${!currentFormData.symbol ? '- Stock symbol\n' : ''}` +
        `${!currentFormData.shares ? '- Number of shares\n' : ''}` +
        `${!currentFormData.transactionType ? '- Transaction type (BUY/SELL)\n' : ''}` +
        `\nThis may be a cash contribution, which is not yet supported.`
      );
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      // 1. Submit feedback for training data (including field-level feedback)
      const feedbackResponse = await fetch('/api/ocr/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imagePath: ocrResult.imagePath,
          targetSchema: {
            date: 'string (YYYY-MM-DD format)',
            symbol: 'string (stock ticker symbol)',
            shares: 'number',
            pricePerShare: 'number',
            transactionType: 'string (BUY or SELL)',
            description: 'string (optional description)'
          },
          gatekeeperOutput: ocrResult.gatekeeperOutput,
          extractorOutput: { transactions: [ocrResult.extractorOutput.transactions[currentTransactionIndex]] },
          auditorOutput: { transactions: [currentTransaction] },
          correctedData: currentFormData,
          userFeedback: feedbackType,
          traceId: (ocrResult as any).traceId, // Pass traceId for Langfuse linking
          fieldFeedback: autoFieldFeedback, // Auto-detected + manual field-level feedback
        })
      });

      if (!feedbackResponse.ok) {
        throw new Error('Failed to submit feedback');
      }

      // 2. Fetch price from market-data API (same as normal transaction flow)
      let pricePerShare: number | null = null;
      try {
        const priceResponse = await fetch(`/api/market-data/${currentFormData.symbol}?date=${currentFormData.date}`);
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          pricePerShare = priceData.price;
        }
      } catch (priceErr) {
        console.warn('Price fetch failed, proceeding without price:', priceErr);
        // Allow transaction to proceed without price (unlike normal form which throws)
      }

      // 3. Create the actual transaction using the existing transactions API
      const transactionResponse = await fetch(`/api/accounts/${accountId}/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: currentFormData.symbol,
          shares: Number(currentFormData.shares),
          transactionDate: currentFormData.date,
          transactionType: currentFormData.transactionType,
          pricePerShare: pricePerShare || undefined,
          description: currentFormData.description,
        })
      });

      if (!transactionResponse.ok) {
        const errorData = await transactionResponse.json().catch(() => ({}));

        // Handle duplicate transaction (409 Conflict)
        if (transactionResponse.status === 409) {
          const duplicateMessage = errorData.message || 'This transaction already exists';
          console.warn('Duplicate transaction detected:', duplicateMessage);
          setError(`⚠️ Duplicate Transaction: ${duplicateMessage}\n\nSkipping to next transaction...`);

          // Auto-advance to next transaction after a brief delay to show the message
          setTimeout(() => {
            if (currentTransactionIndex < ocrResult.auditorOutput.transactions.length - 1) {
              setCurrentTransactionIndex(prev => prev + 1);
              setError('');
            } else {
              onSuccess();
            }
          }, 2000);
          return;
        }

        const errorMessage = errorData.error || `Failed to create transaction (${transactionResponse.status})`;
        console.error('Transaction creation failed:', errorMessage, 'Request body:', {
          symbol: currentFormData.symbol,
          shares: Number(currentFormData.shares),
          transactionDate: currentFormData.date,
          transactionType: currentFormData.transactionType,
          pricePerShare: pricePerShare || undefined,
          description: currentFormData.description,
        });
        throw new Error(errorMessage);
      }

      // Move to next transaction or finish
      if (currentTransactionIndex < ocrResult.auditorOutput.transactions.length - 1) {
        setCurrentTransactionIndex(prev => prev + 1);
        setError('');
      } else {
        // All transactions processed - refresh the account data
        onSuccess();
      }
    } catch (err) {
      console.error('Feedback submission error:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {!ocrResult ? (
        <>
          {/* File Upload Section */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="transaction-image">Transaction Image</Label>
              <Input
                id="transaction-image"
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                disabled={isProcessing}
              />
            </div>

            {imagePreview && (
              <div className="border rounded-lg p-4">
                <img
                  src={imagePreview}
                  alt="Transaction preview"
                  className="max-w-full h-auto max-h-96 mx-auto"
                />
              </div>
            )}

            {error && (
              <div className="text-red-600 text-sm">{error}</div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={processImage}
                disabled={!selectedFile || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Process Image
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
                Cancel
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Gatekeeper Failure */}
          {!ocrResult.success && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 text-red-800 font-semibold mb-2">
                <AlertTriangle className="h-5 w-5" />
                Quality Check Failed
              </div>
              <p className="text-red-700">{ocrResult.error}</p>
              <Button variant="outline" onClick={() => setOcrResult(null)} className="mt-3">
                Try Different Image
              </Button>
            </div>
          )}

          {/* Validation Section */}
          {ocrResult.success && (
            <div className="grid grid-cols-2 gap-4">
              {/* Image Preview */}
              <div>
                <h3 className="font-semibold mb-2">Original Image</h3>
                <div className="border rounded-lg p-2">
                  <img
                    src={imagePreview}
                    alt="Transaction"
                    className="max-w-full h-auto"
                  />
                </div>
              </div>

              {/* Extracted Data Form */}
              <div>
                {/* Transaction Navigation */}
                {ocrResult.auditorOutput.transactions.length > 1 && (
                  <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded flex items-center justify-between">
                    <span className="text-sm font-semibold text-blue-800">
                      Transaction {currentTransactionIndex + 1} of {ocrResult.auditorOutput.transactions.length}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentTransactionIndex(prev => Math.max(0, prev - 1))}
                        disabled={currentTransactionIndex === 0}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentTransactionIndex(prev => Math.min(ocrResult.auditorOutput.transactions.length - 1, prev + 1))}
                        disabled={currentTransactionIndex === ocrResult.auditorOutput.transactions.length - 1}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}

                <h3 className="font-semibold mb-2">Extracted Data</h3>

                {/* Auditor Warnings */}
                {currentTransaction && currentTransaction.warnings.length > 0 && (
                  <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                    <div className="flex items-center gap-2 text-yellow-800 font-semibold mb-1">
                      <AlertTriangle className="h-4 w-4" />
                      Warnings
                    </div>
                    <ul className="text-sm text-yellow-700 space-y-1">
                      {currentTransaction.warnings.map((warning, idx) => (
                        <li key={idx}>• {warning}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-3">
                  {currentTransaction && currentTransaction.validatedData && Object.entries(currentTransaction.validatedData).map(([key, value]) => {
                    const confidence = currentTransaction.confidenceScores[key] || 0;
                    const isLowConfidence = confidence < 0.7;
                    const currentFeedback = fieldFeedback[currentTransactionIndex]?.[key];
                    const wasEdited = isFieldEdited(key);

                    return (
                      <div key={key}>
                        <Label htmlFor={key} className="flex items-center justify-between">
                          <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <span className={`text-xs ${getConfidenceColor(confidence)}`}>
                            {(confidence * 100).toFixed(0)}% confidence
                          </span>
                        </Label>
                        <div className="flex gap-2 items-center mt-1">
                          <Input
                            id={key}
                            value={currentFormData[key] ?? String(value)}
                            onChange={(e) => handleFieldChange(key, e.target.value)}
                            className={`transition-colors ${
                              wasEdited
                                ? 'bg-white border-blue-400 shadow-sm'
                                : isLowConfidence
                                  ? 'border-yellow-400 bg-yellow-50/30'
                                  : 'bg-slate-50/50'
                            }`}
                          />
                          <div className="flex gap-1 flex-shrink-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className={`h-9 w-9 p-0 ${currentFeedback === 'correct' ? 'bg-green-100 text-green-700' : 'text-gray-400'}`}
                              onClick={() => handleFieldFeedback(key, 'correct')}
                              title="Mark as correct"
                            >
                              <ThumbsUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className={`h-9 w-9 p-0 ${currentFeedback === 'incorrect' ? 'bg-red-100 text-red-700' : 'text-gray-400'}`}
                              onClick={() => handleFieldFeedback(key, 'incorrect')}
                              title="Mark as incorrect"
                            >
                              <ThumbsDown className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex gap-2 mt-4">
                  <Button onClick={submitFeedback} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Save & Continue
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => setOcrResult(null)} disabled={isSaving}>
                    Try Again
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
