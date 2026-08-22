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

## Runtime properties

- **Parallelization**: Rayon thread pool sized to the service's CPU allocation
- **Isolation**: Each path is a pure function with no shared state

## Implementation Status

✅ **Phase 1: Rust Service Foundation** - COMPLETED
- Full TypeScript → Rust logic port
- Tax calculations (federal/state/FICA)
- RMD calculations
- Social Security benefits (AIME/PIA)
- Complete projection engine with tax-efficient withdrawals
- Cross-engine contract tests compare financial semantics within the suite's
  numerical tolerances

✅ **Phase 2: Vite/Hono Integration** - COMPLETED
- User preference for server-side vs client-side
- Public, rate-limited Hono proxy endpoints
- Graceful fallback mechanisms

✅ **Phase 3: Production Deployment** - COMPLETED
- Docker containerization
- Cloud Run deployment behind the Cloudflare edge proxy
- Terraform-managed scaling and monitoring
