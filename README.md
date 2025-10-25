# RetirePlan 🏦

> A modern, academically-grounded retirement planning tool built with Next.js and TypeScript

RetirePlan helps you model retirement outcomes using Monte Carlo simulations, progressive tax calculations, and sophisticated withdrawal strategies. Plan your financial future with confidence using real market data and proven methodologies.

## ✨ Features

- 🎯 **Monte Carlo Projections** - Run thousands of scenarios to model market uncertainty
- 💰 **Multi-Account Support** - Traditional 401k, Roth IRA, HSA, and taxable accounts
- 📊 **Tax-Aware Withdrawals** - Optimized withdrawal strategies with progressive tax calculations
- 🔄 **Social Security Integration** - Estimate benefits with flexible claiming strategies
- 📈 **Interactive Visualizations** - Wealth projections with confidence bands and success probability
- ⚡ **Real-time Updates** - Instant recalculation as you adjust parameters

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **pnpm** ([Install guide](https://pnpm.io/installation))
- **Neon PostgreSQL** account ([Sign up](https://neon.tech)) - Free tier available

### Installation

```bash
# Clone the repository
git clone https://github.com/Ficke/retire.git
cd retire

# Install dependencies
pnpm install

# Set up environment variables
cp apps/web/.env.example apps/web/.env.local
# Edit apps/web/.env.local and add your Neon DATABASE_URL

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### Database Setup (Neon PostgreSQL)

1. **Create a Neon account** at [neon.tech](https://neon.tech)
2. **Create a new project** in the Neon console
3. **Copy the connection string** (use the pooler endpoint for better performance)
4. **Add to `.env.local`**:
   ```
   DATABASE_URL=postgresql://[user]:[password]@[host]-pooler.neon.tech/[dbname]?sslmode=require
   ```
5. **Run the app** - migrations will apply automatically on first start

**Important:** Make sure you don't have a `DATABASE_URL` environment variable set in your shell, as it will override the `.env.local` file.

## 📋 Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build optimized production bundle |
| `pnpm start` | Start production server |
| `pnpm test` | Run unit tests with Vitest |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Run ESLint (if configured) |

## 🏗️ Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **State:** Zustand
- **Charts:** Recharts
- **Testing:** Vitest + Testing Library
- **Package Manager:** pnpm

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