# Architecture Documentation

This directory contains detailed architecture documentation for the Retirement Planner application.

## Documents

### [Simulation Architecture](./simulation-architecture.md)
Reference for the Monte Carlo simulation architecture, including:
- Cloud and local execution models
- Seed and path identity
- Parallelization and cancellation
- Rolling-deployment compatibility
- Correctness invariants

### [Asset Routing and Stale Chunks](./asset-routing-plan.md)
Proposed fix for the SPA fallback answering missing asset paths with the shell:
real 404s for asset misses, client recovery when a deploy retires a chunk a
loaded tab still needs, and the deploy gate that follows from both.

### [Edge Compute Plan](./edge-compute-plan.md)
Proposed migration of the web tier from Cloud Run into the Cloudflare Worker:
static assets at the edge, Hono on Workers, Neon through Hyperdrive, and a
Worker-minted OIDC token for the retained Rust simulation service.

## Runtime properties

- **Parallelization**: Rayon in the native service; bounded ordinary Workers in the browser
- **Isolation**: Each path is a pure function with no shared state

## Implementation Status

✅ **Phase 1: Unified Rust Simulation Core** - COMPLETED
- One projection and aggregation implementation for native and WebAssembly targets
- Tax calculations (federal/state/FICA)
- RMD calculations
- Social Security benefits (AIME/PIA)
- Complete projection engine with tax-efficient withdrawals
- Native/WebAssembly contract tests compare complete results within the suite's
  numerical policy

✅ **Phase 2: Vite/Hono Integration** - COMPLETED
- User preference for server-side vs client-side
- Public, rate-limited Hono proxy endpoints
- Graceful fallback mechanisms
- Browser WebAssembly adapter with explicit ABI and artifact provenance

✅ **Phase 3: Production Deployment** - COMPLETED
- Docker containerization
- Cloud Run deployment behind the Cloudflare edge proxy
- Terraform-managed scaling and monitoring
