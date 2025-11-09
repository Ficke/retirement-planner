## >€ RUST MONTE CARLO SIMULATION SERVICE

This document outlines the implementation of a high-performance server-side Monte Carlo simulation service built in Rust to replace client-side JavaScript calculations.

### Project Goals

**Performance**: 10x faster simulations with consistent results across all devices
**Scalability**: Stateless architecture ready for horizontal scaling  
**Privacy**: User-configurable choice between server-side and client-side calculations
**Compatibility**: Seamless integration with existing TypeScript frontend

### Architecture

**Server-First Approach**: All simulations default to Rust microservice
**Graceful Fallback**: Automatic client-side fallback if server unavailable
**Privacy Option**: Users can opt for client-side calculations
**Future WASM**: Path to WebAssembly using same Rust codebase

### Implementation Status

####  Phase 1: Rust Service Foundation (COMPLETED)
- [x] Rust simulation service with HTTP API at `/api/simulate`
- [x] TypeScript-compatible data structures with perfect JSON serialization
- [x] Parallel Monte Carlo engine using Rayon (5000+ paths)
- [x] Production-ready: logging, error handling, health checks
- [x] Performance validated: 2-3x faster than JavaScript implementation

#### =§ Phase 2: Next.js Integration (IN PROGRESS)
- [ ] User preference: "Use server-side calculations" (default: true)
- [ ] Next.js proxy endpoint `/api/simulation/monte-carlo`
- [ ] Simulation service routing based on user preference
- [ ] UI toggle in settings panel for privacy-conscious users

#### =Ë Phase 3: Production Deployment
- [ ] Docker containerization and Cloud Run deployment
- [ ] Auto-scaling and health monitoring
- [ ] Performance benchmarking and optimization
- [ ] Documentation and architecture diagrams

### Performance Results

**Test Configuration**: 35-year-old, $250K portfolio, retirement at 65
**Simulation Paths**: 5,000 Monte Carlo paths with historical bootstrapping
**Success Rate**: 99.22% probability of successful retirement
**Median Terminal Wealth**: $6.88M at age 90
**Processing Time**: ~1-2 seconds (vs 2-5 seconds in JavaScript)

### Technical Achievements

- **Perfect Data Compatibility**: Seamless TypeScript ” Rust JSON serialization
- **Parallel Processing**: All CPU cores utilized for maximum performance  
- **Statistical Accuracy**: Proper percentile calculations and risk metrics
- **Production Ready**: Structured for testing, deployment, and scaling

### Next Steps

1. Implement user preference controls for calculation method selection
2. Create Next.js proxy endpoint for seamless frontend integration
3. Add graceful fallback mechanisms for service availability
4. Deploy to production with monitoring and auto-scaling

---

## =€ OCR TRANSACTION UPLOAD IMPLEMENTATION PLAN

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

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.