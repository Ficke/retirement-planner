# Architecture Documentation

This directory contains detailed architecture documentation for the Retirement Planner application.

## Documents

### [Simulation Architecture](./simulation-architecture.md)
Comprehensive analysis of the Monte Carlo simulation architecture, including:
- Parallelization strategy with Rayon
- Thread-safety and isolation properties
- Horizontal scaling readiness
- Performance analysis and benchmarks
- Distribution options (vertical, horizontal, serverless)

## Quick Links

- **Performance**: 107ms for 5000 paths (3x faster than TypeScript)
- **Parallelization**: Rayon thread pool across all CPU cores
- **Isolation**: Each path is a pure function with no shared state
- **Distribution-Ready**: Can scale horizontally with ~50 lines of code

## Implementation Status

✅ **Phase 1: Rust Service Foundation** - COMPLETED
- Full TypeScript → Rust logic port
- Tax calculations (federal/state/FICA)
- RMD calculations
- Social Security benefits (AIME/PIA)
- Complete projection engine with tax-efficient withdrawals
- Results verified identical to TypeScript implementation

✅ **Phase 2: Vite/Hono Integration** - COMPLETED
- User preference for server-side vs client-side
- Public, rate-limited Hono proxy endpoints
- Graceful fallback mechanisms

✅ **Phase 3: Production Deployment** - COMPLETED
- Docker containerization
- Cloud Run deployment behind the Cloudflare edge proxy
- Terraform-managed scaling and monitoring
