import { describe, it, expect } from 'vitest';
import { runDeterministicValidation } from '@/lib/ocr-validation';

describe('OCR Deterministic Validation', () => {
  describe('Date Validation', () => {
    it('should accept valid recent dates', () => {
      const today = new Date().toISOString().split('T')[0];
      const input = {
        transactions: [
          {
            extractedData: { date: today },
            confidenceScores: { date: 0.95 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toHaveLength(0);
      expect(result.transactions[0].confidenceScores.date).toBe(0.95);
    });

    it('should flag future dates', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const input = {
        transactions: [
          {
            extractedData: { date: futureDateStr },
            confidenceScores: { date: 0.95 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toContain(
        `Date ${futureDateStr} is in the future`
      );
      expect(result.transactions[0].confidenceScores.date).toBe(0.5);
    });

    it('should flag dates more than 10 years old', () => {
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 11);
      const oldDateStr = oldDate.toISOString().split('T')[0];

      const input = {
        transactions: [
          {
            extractedData: { date: oldDateStr },
            confidenceScores: { date: 0.95 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toContain(
        `Date ${oldDateStr} is more than 10 years ago`
      );
      expect(result.transactions[0].confidenceScores.date).toBe(0.7);
    });
  });

  describe('Symbol Validation', () => {
    it('should accept valid stock symbols', () => {
      const input = {
        transactions: [
          {
            extractedData: { symbol: 'AAPL' },
            confidenceScores: { symbol: 0.95 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toHaveLength(0);
      expect(result.transactions[0].confidenceScores.symbol).toBe(0.95);
    });

    it('should flag invalid symbol formats', () => {
      const input = {
        transactions: [
          {
            extractedData: { symbol: 'TOOLONG' },
            confidenceScores: { symbol: 0.95 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toContain(
        `Symbol "TOOLONG" doesn't match standard format (1-5 uppercase letters)`
      );
      expect(result.transactions[0].confidenceScores.symbol).toBe(0.6);
    });

    it('should flag symbols with numbers', () => {
      const input = {
        transactions: [
          {
            extractedData: { symbol: 'ABC123' },
            confidenceScores: { symbol: 0.95 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions).toHaveLength(1);
      const transaction = result.transactions[0]!;
      expect(transaction.warnings).toBeDefined();
      expect(transaction.warnings!.length).toBeGreaterThan(0);
      expect(transaction.confidenceScores.symbol).toBe(0.6);
    });
  });

  describe('Numeric Validation', () => {
    it('should accept positive shares and prices', () => {
      const input = {
        transactions: [
          {
            extractedData: {
              shares: 100,
              pricePerShare: 50.25,
            },
            confidenceScores: {
              shares: 0.95,
              pricePerShare: 0.9,
            },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toHaveLength(0);
      expect(result.transactions[0].confidenceScores.shares).toBe(0.95);
      expect(result.transactions[0].confidenceScores.pricePerShare).toBe(0.9);
    });

    it('should flag negative or zero shares', () => {
      const input = {
        transactions: [
          {
            extractedData: { shares: -10 },
            confidenceScores: { shares: 0.95 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toContain(
        'Shares must be a positive number'
      );
      expect(result.transactions[0].confidenceScores.shares).toBe(0.3);
    });

    it('should flag negative or zero prices', () => {
      const input = {
        transactions: [
          {
            extractedData: { pricePerShare: 0 },
            confidenceScores: { pricePerShare: 0.95 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toContain(
        'Price per share must be a positive number'
      );
      expect(result.transactions[0].confidenceScores.pricePerShare).toBe(0.3);
    });
  });

  describe('Math Validation', () => {
    it('should accept correct calculations', () => {
      const input = {
        transactions: [
          {
            extractedData: {
              shares: 100,
              pricePerShare: 50.25,
              totalAmount: 5025.0,
            },
            confidenceScores: {
              shares: 0.95,
              pricePerShare: 0.9,
              totalAmount: 0.85,
            },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toHaveLength(0);
    });

    it('should flag math mismatches beyond 1%', () => {
      const input = {
        transactions: [
          {
            extractedData: {
              shares: 100,
              pricePerShare: 50.0,
              totalAmount: 6000.0, // Should be 5000
            },
            confidenceScores: {
              shares: 0.95,
              pricePerShare: 0.9,
              totalAmount: 0.85,
            },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions).toHaveLength(1);
      const transaction = result.transactions[0]!;
      expect(transaction.warnings).toBeDefined();
      expect(transaction.warnings!.length).toBeGreaterThan(0);
      expect(transaction.warnings![0]).toContain("doesn't match");
      expect(transaction.confidenceScores.totalAmount).toBe(0.6);
    });

    it('should allow 1% rounding tolerance', () => {
      const input = {
        transactions: [
          {
            extractedData: {
              shares: 100,
              pricePerShare: 50.254,
              totalAmount: 5025.0, // 0.4 cent difference
            },
            confidenceScores: {
              shares: 0.95,
              pricePerShare: 0.9,
              totalAmount: 0.85,
            },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toHaveLength(0);
    });
  });

  describe('Transaction Type Validation', () => {
    it('should accept valid transaction types', () => {
      const validTypes = ['BUY', 'SELL', 'SPLIT', 'DIVIDEND_REINVEST'];

      validTypes.forEach((type) => {
        const input = {
          transactions: [
            {
              extractedData: { transactionType: type },
              confidenceScores: { transactionType: 0.95 },
            },
          ],
        };

        const result = runDeterministicValidation(input);

        expect(result.transactions[0].warnings).toHaveLength(0);
      });
    });

    it('should flag invalid transaction types', () => {
      const input = {
        transactions: [
          {
            extractedData: { transactionType: 'INVALID_TYPE' },
            confidenceScores: { transactionType: 0.95 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toContain(
        'Transaction type "INVALID_TYPE" should be one of: BUY, SELL, SPLIT, DIVIDEND_REINVEST'
      );
      expect(result.transactions[0].confidenceScores.transactionType).toBe(0.5);
    });

    it('should normalize transaction type to uppercase', () => {
      const input = {
        transactions: [
          {
            extractedData: { transactionType: 'buy' },
            confidenceScores: { transactionType: 0.95 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions[0].warnings).toHaveLength(0);
    });
  });

  describe('Multiple Transactions', () => {
    it('should validate all transactions independently', () => {
      const input = {
        transactions: [
          {
            extractedData: { symbol: 'AAPL', shares: 100 },
            confidenceScores: { symbol: 0.95, shares: 0.9 },
          },
          {
            extractedData: { symbol: 'TOOLONG', shares: -10 },
            confidenceScores: { symbol: 0.95, shares: 0.9 },
          },
        ],
      };

      const result = runDeterministicValidation(input);

      expect(result.transactions).toHaveLength(2);

      // First transaction should be valid
      expect(result.transactions[0]!.warnings).toHaveLength(0);

      // Second transaction should have warnings
      const secondTransaction = result.transactions[1]!;
      expect(secondTransaction.warnings).toBeDefined();
      expect(secondTransaction.warnings!.length).toBeGreaterThan(0);
    });
  });
});
