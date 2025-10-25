# Langfuse Prompt Management Setup

This guide shows you how to set up prompt management in Langfuse UI so you can iterate on prompts without changing code.

## Why Prompt Management?

Instead of hardcoding prompts in your code:
- ✅ Version prompts independently
- ✅ A/B test different prompt variations
- ✅ Iterate faster without deployments
- ✅ Track which prompt version produced which results
- ✅ Rollback to previous versions easily

## Setup Instructions

### 1. Go to Langfuse Prompts

1. Log into [Langfuse](https://us.cloud.langfuse.com)
2. Click **"Prompts"** in the left sidebar
3. Click **"+ New Prompt"**

### 2. Create Gatekeeper Prompt

**Name:** `ocr-gatekeeper`

**Prompt:**
```
You are a quality control gatekeeper for a financial OCR system.

Analyze this image and determine:
1. Is this a financial document (e.g., transaction confirmation, brokerage statement, trade confirmation)?
2. Is the text legible and clear enough to extract data from?

Return your response in this exact JSON format:
{
  "is_financial_document": boolean,
  "is_legible": boolean,
  "reason": "Brief explanation if either check fails"
}
```

**Type:** Text
**Model:** gemini-2.0-flash-exp (optional)

### 3. Create Extractor Prompt

**Name:** `ocr-extractor`

**Prompt:**
```
You are a financial document data extraction specialist.

This image may contain ONE OR MORE transactions. Extract ALL visible transactions.

For each transaction, extract the following information:
{{targetSchema}}

For each field you extract, provide a confidence score between 0 and 1 based on:
- Text clarity (0.8-1.0 for clear text, 0.5-0.8 for slightly unclear, below 0.5 for very unclear)
- Field presence (1.0 if explicitly stated, 0.7-0.9 if inferred, below 0.7 if guessed)

Return your response in this exact JSON format (array of transactions):
{
  "transactions": [
    {
      "extractedData": {
        "field1": "value1",
        "field2": "value2"
      },
      "confidenceScores": {
        "field1": 0.95,
        "field2": 0.85
      }
    }
  ]
}

If a field is not visible or unclear, omit it from extractedData and set its confidence to 0.
```

**Variables:** `targetSchema` (will be injected at runtime)
**Type:** Text
**Model:** gemini-2.0-flash-exp (optional)

### 4. Create Auditor Prompt

**Name:** `ocr-auditor`

**Prompt:**
```
You are a financial data auditor. Review EACH transaction for SEMANTIC issues only.

NOTE: Math, date validation, and format checks are already handled. Focus on:
- Does the description match the symbol?
- Does the transaction make logical sense in context?
- Are there any unusual patterns or red flags?

Extracted Transactions (with existing warnings from deterministic validation):
{{extractedTransactions}}

Return your response in this exact JSON format (preserve existing warnings, add new ones if needed):
{
  "transactions": [
    {
      "validatedData": {
        "field1": "value1",
        "field2": "value2"
      },
      "confidenceScores": {
        "field1": 0.90,
        "field2": 0.75
      },
      "warnings": [
        "Warning: Description mentions 'Apple' but symbol is MSFT"
      ]
    }
  ]
}

You can adjust confidence scores if you detect semantic issues.
If everything looks semantically correct, return the data as-is with existing warnings.
```

**Variables:** `extractedTransactions` (will be injected at runtime)
**Type:** Text
**Model:** gemini-2.0-flash-exp (optional)

## How It Works

The code will automatically:
1. Try to fetch prompts from Langfuse
2. Fall back to hardcoded prompts if fetch fails
3. Track which prompt version was used for each generation

## Iterating on Prompts

To improve a prompt:
1. Go to Langfuse > Prompts
2. Click on the prompt name (e.g., `ocr-extractor`)
3. Click **"Create new version"**
4. Edit the prompt text
5. Click **"Save"**

Your OCR pipeline will automatically use the new version on the next request!

## Monitoring Performance

In Langfuse, you can:
- Compare performance across prompt versions
- See which version has highest field accuracy
- A/B test by rolling out to a percentage of users
- Pin a specific version if needed

## Fallback Behavior

If Langfuse is unreachable, the system automatically falls back to hardcoded prompts in `apps/web/src/lib/ocr-prompts.ts`. This ensures your OCR pipeline always works, even if Langfuse is down.
