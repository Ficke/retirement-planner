## 🚀 OCR TRANSACTION UPLOAD IMPLEMENTATION PLAN

This plan outlines the implementation of a new feature that allows users to upload images of financial transactions and have the data automatically extracted using an OCR pipeline. The implementation is divided into three phases to ensure a modular and manageable development process.

### Phase 1: Backend OCR Service (Microservice)

**Goal**: Create a self-contained API endpoint that takes an image and a target schema, and returns structured data with confidence scores.

**Acceptance Criteria**:
- A new API endpoint at `/api/ocr/process-transaction` is created.
- The endpoint accepts a POST request with a base64 encoded image and a target schema.
- The endpoint uses the Gemini API to perform OCR and information extraction.
- The endpoint returns a JSON object with the extracted data, confidence scores for each field, and the raw OCR text.
- The Gemini API key is securely managed using environment variables.

**Steps**:
1.  Create a new API route file at `apps/web/src/app/api/ocr/process-transaction/route.ts`.
2.  Add a `GEMINI_API_KEY` to the `.env.example` file and instruct the user to create a `.env.local` file with their key.
3.  Implement the `POST` handler in the new API route.
4.  The handler should receive the `imageData` and `targetSchema` from the request body.
5.  Implement the logic to call the Gemini API with the image data and a prompt to extract the text and structure it according to the `targetSchema`.
6.  Return the structured data and confidence scores as a JSON response.

### Phase 2: Frontend UI for Upload and Validation

**Goal**: Create the user interface for uploading an image and validating the extracted data.

**Acceptance Criteria**:
- A new "Upload Transaction" button is added to the `AccountDetailView` component.
- Clicking the button opens a modal with a file upload input for PNG images.
- On image upload, the client-side code pre-processes the image and sends it to the `/api/ocr/process-transaction` endpoint.
- A new validation component displays the uploaded image and the returned data side-by-side.
- Each extracted field is displayed in an input, with its confidence score visually represented.
- The user can edit the extracted data and fill in any missing fields.

**Steps**:
1.  Add an "Upload Transaction" button to `apps/web/src/components/account-detail-view.tsx`.
2.  Create a new component `apps/web/src/components/transaction-ocr-uploader.tsx` that contains the file upload logic and the validation UI.
3.  Implement the client-side image pre-processing (e.g., resizing, converting to grayscale).
4.  Implement the API call to the `/api/ocr/process-transaction` endpoint.
5.  Create the UI for the validation screen, showing the image and the editable form with confidence scores.

### Phase 3: Integration and Finalization

**Goal**: Connect the OCR pipeline to the existing transaction creation process.

**Acceptance Criteria**:
- The "Save" button in the validation UI sends the validated data to the existing transaction creation endpoint.
- The `TransactionUploadForm` is updated to handle the data from the OCR pipeline.
- End-to-end error handling and loading states are implemented for the entire flow.
- The user is returned to the account detail view after a successful upload, with the new transaction visible in the list.

**Steps**:
1.  Integrate the `TransactionUploadForm` with the new validation component to pre-fill it with the OCR data.
2.  On save, the validation component should call the `createTransaction` function from the `accounts-client`.
3.  Ensure that after a successful transaction creation, the account detail view is refreshed to show the new transaction.
4.  Add loading indicators for the OCR processing and saving steps.
5.  Implement comprehensive error handling for API failures and validation errors.