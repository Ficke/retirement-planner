/**
 * OCR Deterministic Validation
 * Apply hard business rules that don't require AI judgment
 */

interface TransactionData {
  extractedData: Record<string, any>;
  confidenceScores: Record<string, number>;
  warnings?: string[];
}

interface ExtractorOutput {
  transactions: TransactionData[];
}

export function runDeterministicValidation(extractorOutput: ExtractorOutput): ExtractorOutput {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to start of day

  const validatedTransactions = extractorOutput.transactions.map(transaction => {
    const warnings: string[] = [];
    let updatedConfidenceScores = { ...transaction.confidenceScores };

    // Date validation
    if (transaction.extractedData.date) {
      const transactionDate = new Date(transaction.extractedData.date);
      transactionDate.setHours(0, 0, 0, 0);

      // Check if date is in the future (with 1-day tolerance for timezone issues)
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      if (transactionDate > tomorrow) {
        warnings.push(`Date ${transaction.extractedData.date} is in the future`);
        updatedConfidenceScores.date = Math.min(updatedConfidenceScores.date || 0, 0.5);
      }

      // Check if date is too far in the past (>10 years)
      const tenYearsAgo = new Date(today);
      tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);

      if (transactionDate < tenYearsAgo) {
        warnings.push(`Date ${transaction.extractedData.date} is more than 10 years ago`);
        updatedConfidenceScores.date = Math.min(updatedConfidenceScores.date || 0, 0.7);
      }
    }

    // Symbol format validation
    if (transaction.extractedData.symbol) {
      const symbol = String(transaction.extractedData.symbol).toUpperCase();
      if (!/^[A-Z]{1,5}$/.test(symbol)) {
        warnings.push(`Symbol "${symbol}" doesn't match standard format (1-5 uppercase letters)`);
        updatedConfidenceScores.symbol = Math.min(updatedConfidenceScores.symbol || 0, 0.6);
      }
    }

    // Numeric validation
    if (transaction.extractedData.shares !== undefined) {
      const shares = Number(transaction.extractedData.shares);
      if (isNaN(shares) || shares <= 0) {
        warnings.push('Shares must be a positive number');
        updatedConfidenceScores.shares = Math.min(updatedConfidenceScores.shares || 0, 0.3);
      }
    }

    if (transaction.extractedData.pricePerShare !== undefined) {
      const price = Number(transaction.extractedData.pricePerShare);
      if (isNaN(price) || price <= 0) {
        warnings.push('Price per share must be a positive number');
        updatedConfidenceScores.pricePerShare = Math.min(updatedConfidenceScores.pricePerShare || 0, 0.3);
      }
    }

    // Math validation: price * shares ≈ total (if total is provided)
    if (transaction.extractedData.shares && transaction.extractedData.pricePerShare && transaction.extractedData.totalAmount) {
      const shares = Number(transaction.extractedData.shares);
      const price = Number(transaction.extractedData.pricePerShare);
      const total = Number(transaction.extractedData.totalAmount);

      if (!isNaN(shares) && !isNaN(price) && !isNaN(total)) {
        const calculatedTotal = shares * price;
        const percentDiff = Math.abs(calculatedTotal - total) / total;

        // Allow 1% difference for rounding
        if (percentDiff > 0.01) {
          warnings.push(
            `Total amount ($${total.toFixed(2)}) doesn't match shares × price ($${calculatedTotal.toFixed(2)})`
          );
          updatedConfidenceScores.totalAmount = Math.min(updatedConfidenceScores.totalAmount || 0, 0.6);
        }
      }
    }

    // Transaction type validation
    if (transaction.extractedData.transactionType) {
      const validTypes = ['BUY', 'SELL', 'SPLIT', 'DIVIDEND_REINVEST'];
      const type = String(transaction.extractedData.transactionType).toUpperCase();

      if (!validTypes.includes(type)) {
        warnings.push(`Transaction type "${type}" should be one of: ${validTypes.join(', ')}`);
        updatedConfidenceScores.transactionType = Math.min(updatedConfidenceScores.transactionType || 0, 0.5);
      }
    }

    return {
      extractedData: transaction.extractedData,
      confidenceScores: updatedConfidenceScores,
      warnings,
    };
  });

  return {
    transactions: validatedTransactions,
  };
}
