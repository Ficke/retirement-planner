# RetirePlan 🏦

[![Tests](https://github.com/Ficke/retirement-planner/actions/workflows/test.yml/badge.svg)](https://github.com/Ficke/retirement-planner/actions/workflows/test.yml)

> A modern, academically-grounded retirement planning tool built with Next.js and TypeScript

RetirePlan helps you model retirement outcomes using Monte Carlo simulations, progressive tax calculations, and sophisticated withdrawal strategies. Plan your financial future with confidence using real market data and proven methodologies.

## ✨ Features

- 🎯 **Monte Carlo Projections** - Run thousands of scenarios to model market uncertainty
- 🚀 **High-Performance Rust Engine** - Server-side simulations 10x faster than JavaScript
- 💰 **Multi-Account Support** - Traditional 401k, Roth IRA, HSA, and taxable accounts
- 📊 **Tax-Aware Withdrawals** - Optimized withdrawal strategies with progressive tax calculations
- 🔄 **Social Security Integration** - Estimate benefits with flexible claiming strategies
- 📈 **Interactive Visualizations** - Wealth projections with confidence bands and success probability
- ⚡ **Real-time Updates** - Instant recalculation as you adjust parameters
- 🔒 **Privacy-First** - Optional client-side calculations for sensitive data

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **pnpm** ([Install guide](https://pnpm.io/installation))
- **Rust** (for simulation service) ([Install guide](https://rustup.rs/))
- **Google Cloud CLI** ([Install guide](https://cloud.google.com/sdk/docs/install))
- **Neon PostgreSQL** account ([Sign up](https://neon.tech)) - Free tier available

### Installation

```bash
# Clone the repository
git clone https://github.com/Ficke/retirement-planner.git
cd retirement-planner

# Install dependencies
pnpm install

# Authenticate with Google Cloud (required for secrets)
gcloud auth login

# Pull environment variables from GCP Secret Manager
./scripts/pull-secrets.sh
```

This will create `apps/web/.env.local` with all required secrets from GCP Secret Manager.

### Running the Development Environment

The application consists of two services that run in parallel:

#### 1. Next.js Web Application (port 3000)
```bash
pnpm dev
```

#### 2. Rust Simulation Service (port 8081)
```bash
cd rust-simulation-service
cargo run
```

**Recommended:** Run both services in separate terminal windows.

Open [http://localhost:3000](http://localhost:3000) to view the application.

### First-Time Setup Notes

- The **secrets script** pulls all configuration from GCP Secret Manager (database URL, API keys, Firebase credentials)
- **Migrations** will apply automatically when you first start the Next.js app
- The **Rust service** provides high-performance Monte Carlo simulations (10x faster than JavaScript)
- If the Rust service is unavailable, the app will gracefully fall back to client-side calculations

**Important:** Don't have a `DATABASE_URL` environment variable set in your shell - it will override `.env.local`.

## 📋 Available Scripts

### Next.js Web Application

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build optimized production bundle |
| `pnpm start` | Start production server |
| `pnpm test` | Run unit tests with Vitest |
| `pnpm test:ui` | Run unit tests with UI |
| `pnpm e2e` | Run end-to-end tests with Playwright |
| `pnpm e2e:ui` | Run end-to-end tests with UI |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Run ESLint |

### Rust Simulation Service

| Command | Description |
|---------|-------------|
| `cargo run` | Start simulation service (from rust-simulation-service/) |
| `cargo build --release` | Build optimized production binary |
| `cargo test` | Run Rust unit tests |

## 🏗️ Tech Stack

### Frontend
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **State:** Zustand
- **Charts:** Recharts
- **Testing:** Vitest + Testing Library + Playwright
- **Package Manager:** pnpm

### Backend
- **Simulation Engine:** Rust (Warp + Rayon)
- **Database:** PostgreSQL (Neon)
- **Authentication:** Firebase Auth
- **Observability:** Langfuse (OCR tracing)

## 🎮 How to Use

1. **📝 Inputs** - Enter your age, income, expenses, and retirement goals
2. **💳 Accounts** - Configure your retirement accounts with current balances and asset allocations
3. **⚙️ Assumptions** - Adjust market return expectations and economic parameters
4. **📊 Results** - View your retirement projections with success probability and wealth trajectories

## 🧮 Methodology

RetirePlan uses academically sound financial modeling:

- **Asset Returns:** Correlated normal distributions with fat-tail adjustments
- **Inflation:** Explicit CPI modeling for real vs. nominal calculations  
- **Taxes:** Progressive federal/state brackets with capital gains stacking
- **Social Security:** AIME/PIA calculations with claiming age adjustments
- **Withdrawals:** Tax-optimized withdrawal order (Taxable → Traditional → Roth)

## 📄 License

This project is licensed under the MIT License.

---

Built with ❤️ for better retirement planning