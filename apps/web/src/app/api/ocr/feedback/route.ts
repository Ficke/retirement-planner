import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedDatabaseService } from '@/services/server/database';
import { getLangfuse } from '@/lib/langfuse';

interface FeedbackRequest {
  imagePath: string;
  targetSchema: Record<string, unknown>;
  gatekeeperOutput: Record<string, unknown>;
  extractorOutput: Record<string, unknown>;
  auditorOutput: Record<string, unknown>;
  correctedData: Record<string, unknown>;
  userFeedback: 'APPROVED' | 'CORRECTED';
  traceId?: string;
  fieldFeedback?: Record<string, 'correct' | 'incorrect'>;
}

export async function POST(request: NextRequest) {
  const langfuse = getLangfuse();

  try {
    const body = await request.json() as FeedbackRequest;
    const {
      imagePath,
      targetSchema,
      gatekeeperOutput,
      extractorOutput,
      auditorOutput,
      correctedData,
      userFeedback,
      traceId,
      fieldFeedback,
    } = body;

    // Validate required parameters
    if (!imagePath || !targetSchema || !gatekeeperOutput || !extractorOutput || !auditorOutput || !correctedData || !userFeedback) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    if (!['APPROVED', 'CORRECTED'].includes(userFeedback)) {
      return NextResponse.json(
        { error: 'userFeedback must be either APPROVED or CORRECTED' },
        { status: 400 }
      );
    }

    // Save feedback to database (for training data only)
    const db = getUnifiedDatabaseService();
    await db.initialize();

    await db.saveOcrFeedback({
      imagePath,
      targetSchema,
      gatekeeperOutput,
      extractorOutput,
      auditorOutput,
      correctedData,
      userFeedback,
    });

    // Track user feedback as Langfuse score
    if (traceId) {
      langfuse.score({
        traceId,
        name: 'user-feedback',
        value: userFeedback === 'APPROVED' ? 1 : 0,
        comment: userFeedback === 'CORRECTED' ? 'User made corrections' : 'User approved without changes',
      });

      // If corrections were made, add a detailed score with the changes
      if (userFeedback === 'CORRECTED') {
        // Calculate accuracy per field by comparing auditorOutput to correctedData
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const auditedTransactions = (auditorOutput as any).transactions || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const correctedTransactions = (correctedData as any).transactions || [];

        let totalFields = 0;
        let correctFields = 0;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        auditedTransactions.forEach((auditedTx: any, index: number) => {
          const correctedTx = correctedTransactions[index];
          if (!correctedTx) return;

          const auditedData = auditedTx.validatedData || {};
          const correctedTxData = correctedTx;

          Object.keys(auditedData).forEach(key => {
            totalFields++;
            // Simple equality check (could be enhanced with fuzzy matching)
            if (String(auditedData[key]) === String(correctedTxData[key])) {
              correctFields++;
            }
          });
        });

        const accuracy = totalFields > 0 ? correctFields / totalFields : 0;

        langfuse.score({
          traceId,
          name: 'field-accuracy',
          value: accuracy,
          comment: `${correctFields}/${totalFields} fields correct before user corrections`,
        });
      }

      // Track field-level feedback (thumbs up/down)
      if (fieldFeedback && Object.keys(fieldFeedback).length > 0) {
        const correctCount = Object.values(fieldFeedback).filter(f => f === 'correct').length;
        const incorrectCount = Object.values(fieldFeedback).filter(f => f === 'incorrect').length;
        const totalFeedback = correctCount + incorrectCount;

        if (totalFeedback > 0) {
          langfuse.score({
            traceId,
            name: 'field-level-feedback',
            value: correctCount / totalFeedback,
            comment: `User marked ${correctCount} correct, ${incorrectCount} incorrect`,
            metadata: fieldFeedback,
          });
        }
      }
    }

    await langfuse.flushAsync();

    return NextResponse.json({
      success: true,
      message: 'Feedback recorded successfully',
    });

  } catch (error) {
    console.error('Feedback recording error:', error);
    return NextResponse.json(
      { error: 'Failed to record feedback' },
      { status: 500 }
    );
  }
}
