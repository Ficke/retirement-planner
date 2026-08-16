/// Core retirement projection engine
/// Ports TypeScript projection.ts logic to Rust (lines 32-922)
/// Implements deterministic single-path projection with proper withdrawal ordering:
/// Taxable → Traditional → Roth → HSA
use anyhow::Result;
use chrono::Datelike;
use rand::rngs::StdRng;
use rand::SeedableRng;

use super::historical_data;
use super::parametric_returns;
use super::age::{age_on, birth_year_of};
use super::rmd::{calculate_rmd, get_rmd_start_age};
use super::ssa::{calculate_ssa_benefit, estimate_salary_history};
use super::tax::{
    calculate_retirement_tax, calculate_working_cash_flow, ContributionPolicy, OtherIncome,
};

use crate::types::{
    Account, AccountType, AssetWeights, FilingStatus, PathProjection,
    PathResult, RetirementPlan, State, PLAN_SCHEMA_VERSION,
};

const BUCKET_ORDER: [AccountType; 4] = [
    AccountType::Taxable,
    AccountType::Traditional,
    AccountType::Roth,
    AccountType::Hsa,
];

/// Cash tolerance, in dollars, below which a shortfall is considered funded.
const SHORTFALL_TOLERANCE: f64 = 1.0;

#[derive(Debug, Default, Clone, Copy)]
struct OrderedWithdrawal {
    taxable: f64,
    traditional: f64,
    roth: f64,
    hsa: f64,
    total: f64,
}

/// Drain buckets in the withdrawal order until `amount` is raised or nothing is left.
fn withdraw_in_order(accounts: &mut [Account], amount: f64) -> OrderedWithdrawal {
    let mut drawn = OrderedWithdrawal::default();
    let mut remaining = amount.max(0.0);
    for account_type in BUCKET_ORDER {
        if remaining <= 0.0 {
            break;
        }
        let Some(bucket) = accounts
            .iter_mut()
            .find(|account| account.account_type == account_type && account.balance > 0.0)
        else {
            continue;
        };
        let withdrawal = remaining.min(bucket.balance);
        bucket.balance -= withdrawal;
        remaining -= withdrawal;
        drawn.total += withdrawal;
        match account_type {
            AccountType::Taxable => drawn.taxable += withdrawal,
            AccountType::Traditional => drawn.traditional += withdrawal,
            AccountType::Roth => drawn.roth += withdrawal,
            AccountType::Hsa => drawn.hsa += withdrawal,
        }
    }
    drawn
}

/// Collapse accounts into one bucket per type. Splitting a balance across two
/// accounts of the same type must not change the projection, so weights blend by
/// balance; an empty bucket keeps the plain average so later deposits still land
/// at the intended allocation.
fn to_buckets(accounts: &[Account]) -> Vec<Account> {
    let mut buckets = Vec::with_capacity(BUCKET_ORDER.len());
    for account_type in BUCKET_ORDER {
        let members: Vec<&Account> = accounts
            .iter()
            .filter(|account| account.account_type == account_type)
            .collect();
        if members.is_empty() {
            continue;
        }
        let balance: f64 = members.iter().map(|account| account.balance).sum();
        let stocks = if balance > 0.0 {
            members
                .iter()
                .map(|account| account.balance * account.asset_weights.stocks)
                .sum::<f64>()
                / balance
        } else {
            members
                .iter()
                .map(|account| account.asset_weights.stocks)
                .sum::<f64>()
                / members.len() as f64
        };
        buckets.push(Account {
            account_type,
            balance,
            asset_weights: AssetWeights {
                stocks,
                bonds: 1.0 - stocks,
            },
            is_surplus_cash: false,
        });
    }
    buckets
}

#[derive(Debug, Clone)]
pub struct ProjectionConfig {
    pub seed: u64,
    pub use_historical_bootstrap: bool,
    pub block_size: usize,
}

/// Market returns generator interface
pub trait MarketReturnsGenerator {
    fn next(&mut self) -> (f64, f64); // (stock_return, bond_return)
}

/// Single year bootstrap generator
pub struct SingleBootstrapGenerator {
    rng: StdRng,
}

impl SingleBootstrapGenerator {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: StdRng::seed_from_u64(seed),
        }
    }
}

impl MarketReturnsGenerator for SingleBootstrapGenerator {
    fn next(&mut self) -> (f64, f64) {
        historical_data::sample_historical_returns(&mut self.rng)
    }
}

/// Block bootstrap generator
pub struct BlockBootstrapGenerator {
    rng: StdRng,
    block_size: usize,
    current_block: Vec<(f64, f64)>,
    block_index: usize,
}

impl BlockBootstrapGenerator {
    pub fn new(seed: u64, block_size: usize) -> Self {
        let mut generator = Self {
            rng: StdRng::seed_from_u64(seed),
            block_size,
            current_block: Vec::new(),
            block_index: 0,
        };
        generator.generate_new_block();
        generator
    }

    fn generate_new_block(&mut self) {
        self.current_block = historical_data::sample_block(&mut self.rng, self.block_size);
        self.block_index = 0;
    }
}

impl MarketReturnsGenerator for BlockBootstrapGenerator {
    fn next(&mut self) -> (f64, f64) {
        if self.block_index >= self.current_block.len() {
            self.generate_new_block();
        }

        let returns = self.current_block[self.block_index];
        self.block_index += 1;
        returns
    }
}

/// Parametric returns generator
pub struct ParametricReturnsGenerator {
    rng: StdRng,
}

impl ParametricReturnsGenerator {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: StdRng::seed_from_u64(seed),
        }
    }
}

impl MarketReturnsGenerator for ParametricReturnsGenerator {
    fn next(&mut self) -> (f64, f64) {
        let returns = parametric_returns::generate_parametric_returns(&mut self.rng).unwrap_or(
            parametric_returns::MarketReturns {
                stock_return: 0.07,
                bond_return: 0.03,
            },
        );
        (returns.stock_return, returns.bond_return)
    }
}

/// Core retirement projection engine - matches TypeScript projectScenario()
pub fn project_scenario(plan: &RetirementPlan, config: ProjectionConfig) -> Result<PathResult> {
    let profile = &plan.profile;
    let mut accounts = to_buckets(&plan.accounts);

    // Calculate fraction of current year remaining
    let as_of_date = chrono::NaiveDate::parse_from_str(&profile.as_of_date, "%Y-%m-%d")?;
    let current_year = as_of_date.year();
    let birth_year = birth_year_of(&profile.birth_date)?;
    let age = age_on(&profile.birth_date, &profile.as_of_date)?;
    let rmd_start_age = get_rmd_start_age(birth_year);
    let start_of_year = chrono::NaiveDate::from_ymd_opt(current_year, 1, 1).unwrap();
    let days_in_year = if is_leap_year(current_year) {
        366.0
    } else {
        365.0
    };
    let day_of_year = (as_of_date - start_of_year).num_days() as f64 + 1.0;
    let remaining_year_fraction =
        ((days_in_year - day_of_year + 1.0) / days_in_year).clamp(0.0, 1.0);

    // Simulate current age through life expectancy, inclusive. Deriving the
    // horizon directly also avoids unsigned underflow for already-retired plans.
    let total_years = profile.life_expectancy - age + 1;

    let mut projections = Vec::with_capacity(total_years as usize);
    let mut portfolio_value: f64 = accounts.iter().map(|acc| acc.balance).sum();

    // Track previous year's traditional balance for RMD
    let mut previous_year_traditional_balance = 0.0;

    // Create market returns generator
    let mut returns_generator = create_market_returns_generator(plan, &config);

    for year in 0..total_years {
        let current_age = age + year;
        let is_retired = current_age >= profile.retirement_age;

        // Calculate RMD amount for this year
        let mut rmd_amount = 0.0;
        if current_age >= rmd_start_age {
            let balance_for_rmd = if previous_year_traditional_balance > 0.0 {
                previous_year_traditional_balance
            } else {
                accounts
                    .iter()
                    .filter(|acc| matches!(acc.account_type, AccountType::Traditional))
                    .map(|acc| acc.balance)
                    .sum()
            };
            rmd_amount = calculate_rmd(balance_for_rmd, current_age, rmd_start_age);
        }

        // Yearly tracking variables — income/spending/taxes/savings are assigned
        // in both the working and retirement branches below.
        let income;
        let spending;
        let taxes;
        let savings;
        let mut social_security_benefit = 0.0;
        let mut withdrawal_taxable = 0.0;
        let mut withdrawal_traditional = 0.0;
        let mut withdrawal_roth = 0.0;
        let mut withdrawal_hsa = 0.0;
        let deposit_taxable;
        let mut deposit_traditional = 0.0;
        let mut deposit_roth = 0.0;
        let mut deposit_hsa = 0.0;
        let insufficient_funds;

        if !is_retired {
            // WORKING PHASE
            let annual_salary =
                profile.current_salary * (1.0 + profile.salary_growth_rate).powi(year as i32);
            let annual_working_spending = if plan.schema_version >= PLAN_SCHEMA_VERSION {
                profile.current_spending
                    * (1.0 + profile.working_spending_growth_rate).powi(year as i32)
            } else {
                // Compatibility for requests from web revisions deployed
                // before the phase-based spending model.
                profile.current_spending
            };
            let policy = ContributionPolicy {
                hsa_eligible: plan.assumptions.hsa_eligible,
                use_backdoor_roth: plan.assumptions.use_backdoor_roth,
            };
            let period_fraction = if year == 0 {
                remaining_year_fraction
            } else {
                1.0
            };

            // Generate market returns
            let (stock_return, bond_return) = returns_generator.next();

            // Apply returns to each account
            for account in &mut accounts {
                let account_return = account.asset_weights.stocks * stock_return
                    + account.asset_weights.bonds * bond_return;

                let effective_return = if year == 0 {
                    account_return * remaining_year_fraction
                } else {
                    account_return
                };

                account.balance *= 1.0 + effective_return;
                // Clamp to 0 to prevent negative balances from extreme market downturns
                account.balance = account.balance.max(0.0);
            }

            // RMDs apply even while the primary person is still working. The
            // first modeled year's annual flows are prorated uniformly because
            // the plan does not collect year-to-date distributions.
            let mut rmd_remaining = rmd_amount * period_fraction;
            for account in &mut accounts {
                if matches!(account.account_type, AccountType::Traditional)
                    && account.balance > 0.0
                    && rmd_remaining > 0.0
                {
                    let withdrawal = rmd_remaining.min(account.balance);
                    account.balance -= withdrawal;
                    withdrawal_traditional += withdrawal;
                    rmd_remaining -= withdrawal;
                }
            }
            rmd_amount = withdrawal_traditional;
            let annualized_rmd_income = withdrawal_traditional / period_fraction;
            let taxable_gain_ratio = plan.assumptions.taxable_gain_ratio;
            let mut working_cash_flow = calculate_working_cash_flow(
                annual_salary,
                annual_working_spending,
                current_age,
                &profile.filing_status,
                &profile.state,
                &policy,
                OtherIncome {
                    ordinary: annualized_rmd_income,
                    qualified: 0.0,
                },
            );

            // Spending above after-tax income is funded from the portfolio,
            // exactly as it is in retirement — it is a drawdown, not a failure.
            // Traditional withdrawals are ordinary income and taxable
            // withdrawals realize gains, so each pass re-converges the tax the
            // withdrawal itself creates. Traditional already counts as income
            // inside funding_gap; the other buckets are principal and have to
            // be credited separately.
            let mut shortfall_principal = 0.0;
            let mut shortfall_gains = 0.0;
            let mut unfunded = 0.0;
            for _ in 0..4 {
                unfunded = working_cash_flow.funding_gap * period_fraction - shortfall_principal;
                if unfunded <= SHORTFALL_TOLERANCE {
                    unfunded = 0.0;
                    break;
                }
                let drawn = withdraw_in_order(&mut accounts, unfunded);
                if drawn.total <= SHORTFALL_TOLERANCE {
                    break; // portfolio exhausted
                }
                withdrawal_taxable += drawn.taxable;
                withdrawal_traditional += drawn.traditional;
                withdrawal_roth += drawn.roth;
                withdrawal_hsa += drawn.hsa;
                shortfall_principal += drawn.taxable + drawn.roth + drawn.hsa;
                shortfall_gains += drawn.taxable * taxable_gain_ratio;
                working_cash_flow = calculate_working_cash_flow(
                    annual_salary,
                    annual_working_spending,
                    current_age,
                    &profile.filing_status,
                    &profile.state,
                    &policy,
                    OtherIncome {
                        ordinary: withdrawal_traditional / period_fraction,
                        qualified: shortfall_gains / period_fraction,
                    },
                );
            }

            income = annual_salary * period_fraction;
            spending = annual_working_spending * period_fraction - unfunded.max(0.0);
            taxes = working_cash_flow.tax.total_tax * period_fraction;
            // Only true ruin counts as failure: the portfolio could not cover it.
            insufficient_funds = unfunded > SHORTFALL_TOLERANCE;

            // The residual is fully invested, so the buckets receive all of it
            // and nothing is left unallocated. First year prorates like every
            // other flow.
            let contributions = &working_cash_flow.contributions;
            deposit_hsa = deposit_to_bucket(
                &mut accounts,
                AccountType::Hsa,
                contributions.hsa * period_fraction,
            );
            deposit_traditional = deposit_to_bucket(
                &mut accounts,
                AccountType::Traditional,
                contributions.traditional * period_fraction,
            );
            deposit_roth = deposit_to_bucket(
                &mut accounts,
                AccountType::Roth,
                contributions.roth * period_fraction,
            );
            deposit_taxable = deposit_to_bucket(
                &mut accounts,
                AccountType::Taxable,
                contributions.taxable * period_fraction,
            );

            savings = deposit_taxable + deposit_traditional + deposit_roth + deposit_hsa
                - withdrawal_taxable
                - withdrawal_traditional
                - withdrawal_roth
                - withdrawal_hsa;

            portfolio_value = accounts.iter().map(|acc| acc.balance).sum();
        } else {
            // RETIREMENT PHASE
            let retirement_period_fraction = if year == 0 {
                remaining_year_fraction
            } else {
                1.0
            };
            let spending_growth_exponent = if plan.schema_version >= PLAN_SCHEMA_VERSION {
                let retirement_start_year = profile.retirement_age.saturating_sub(age);
                year - retirement_start_year
            } else {
                // Legacy requests compounded the retirement rate from the
                // as-of year, including working years.
                year
            };
            let target_spending = profile.retirement_spending
                * (1.0 + profile.retirement_spending_growth_rate)
                    .powi(spending_growth_exponent as i32)
                * retirement_period_fraction;

            // Calculate Social Security
            if plan.social_security.enabled && current_age >= plan.social_security.claim_age {
                let annual_social_security_benefit = if plan.social_security.manual_override {
                    plan.social_security
                        .estimated_benefit
                        .unwrap_or(0.0)
                        .max(0.0)
                } else {
                    let salary_history = estimate_salary_history(
                        profile.current_salary,
                        profile.salary_growth_rate,
                        age,
                        profile.retirement_age,
                    );
                    calculate_ssa_benefit(
                        &salary_history,
                        plan.social_security.claim_age,
                        birth_year,
                    )
                    .annual_benefit
                };
                social_security_benefit =
                    annual_social_security_benefit * retirement_period_fraction;
            }

            // Generate market returns
            let (stock_return, bond_return) = returns_generator.next();

            // Apply returns to each account
            for account in &mut accounts {
                let account_return = account.asset_weights.stocks * stock_return
                    + account.asset_weights.bonds * bond_return;

                let effective_return = if year == 0 {
                    account_return * remaining_year_fraction
                } else {
                    account_return
                };

                account.balance *= 1.0 + effective_return;
                // Clamp to 0 to prevent negative balances from extreme market downturns
                account.balance = account.balance.max(0.0);
            }

            rmd_amount *= retirement_period_fraction;
            let withdrawal_result = execute_ordered_withdrawals(
                target_spending,
                &mut accounts,
                WithdrawalContext {
                    age: current_age,
                    filing_status: &profile.filing_status,
                    state: &profile.state,
                    social_security_benefit,
                    rmd_amount,
                    taxable_gain_ratio: plan.assumptions.taxable_gain_ratio,
                },
            )?;

            withdrawal_taxable = withdrawal_result.withdrawal_taxable;
            withdrawal_traditional = withdrawal_result.withdrawal_traditional;
            withdrawal_roth = withdrawal_result.withdrawal_roth;
            withdrawal_hsa = withdrawal_result.withdrawal_hsa;
            deposit_taxable = withdrawal_result.deposit_taxable;
            taxes = withdrawal_result.total_taxes;
            insufficient_funds = withdrawal_result.insufficient_funds;

            // Reinvest RMD excess
            if deposit_taxable > 0.0 {
                deposit_to_bucket(&mut accounts, AccountType::Taxable, deposit_taxable);
            }

            // Calculate actual spending based on available funds
            spending = if insufficient_funds {
                // If funds are insufficient, actual spending is limited to what's available
                // = withdrawals - taxes + social security (and any other income sources)
                (withdrawal_result.total_withdrawn - taxes - deposit_taxable
                    + social_security_benefit)
                    .max(0.0)
            } else {
                target_spending
            };

            income = social_security_benefit;
            savings = deposit_taxable - withdrawal_result.total_withdrawn;
            portfolio_value = accounts.iter().map(|acc| acc.balance).sum();
        }

        // Update previous year traditional balance for next iteration
        previous_year_traditional_balance = accounts
            .iter()
            .filter(|acc| matches!(acc.account_type, AccountType::Traditional))
            .map(|acc| acc.balance)
            .sum();

        projections.push(PathProjection {
            year: (current_year + year as i32) as u32,
            age: current_age,
            portfolio_value,
            income,
            spending,
            taxes,
            savings,
            social_security_benefit,
            is_retired,
            withdrawal_taxable,
            withdrawal_traditional,
            withdrawal_roth,
            withdrawal_hsa,
            rmd_amount,
            deposit_taxable,
            deposit_traditional,
            deposit_roth,
            deposit_hsa,
            insufficient_funds,
        });
    }

    let terminal_wealth = portfolio_value;
    let ever_had_insufficient_funds = projections.iter().any(|p| p.insufficient_funds);
    let success = !ever_had_insufficient_funds;

    Ok(PathResult {
        terminal_wealth,
        projections,
        success,
    })
}

/// Execute the deterministic Taxable → Traditional → Roth → HSA order.
#[derive(Debug)]
struct WithdrawalResult {
    withdrawal_taxable: f64,
    withdrawal_traditional: f64,
    withdrawal_roth: f64,
    withdrawal_hsa: f64,
    total_withdrawn: f64,
    total_taxes: f64,
    insufficient_funds: bool,
    deposit_taxable: f64,
}

struct WithdrawalEvaluation {
    balances: Vec<f64>,
    withdrawal_taxable: f64,
    withdrawal_traditional: f64,
    withdrawal_roth: f64,
    withdrawal_hsa: f64,
    total_withdrawn: f64,
    total_taxes: f64,
    cash_available_after_tax: f64,
}

struct WithdrawalContext<'a> {
    age: u32,
    filing_status: &'a FilingStatus,
    state: &'a State,
    social_security_benefit: f64,
    rmd_amount: f64,
    taxable_gain_ratio: f64,
}

/// Deposit into a type's bucket, opening it when the household holds no account
/// of that kind — funding must never depend on which accounts happen to exist.
/// A new bucket inherits the portfolio's blend so the money is invested the way
/// the rest of it is; with nothing to blend it stays in cash, which is also what
/// keeps that balance out of the taxable-gain calculation.
///
/// Returns the amount deposited, for the caller's cash-flow row.
fn deposit_to_bucket(accounts: &mut Vec<Account>, account_type: AccountType, amount: f64) -> f64 {
    if amount <= 0.0 {
        return 0.0;
    }
    if let Some(bucket) = accounts
        .iter_mut()
        .find(|account| account.account_type == account_type)
    {
        bucket.balance += amount;
        return amount;
    }

    let total: f64 = accounts.iter().map(|account| account.balance).sum();
    let stocks = if total > 0.0 {
        accounts
            .iter()
            .map(|account| account.balance * account.asset_weights.stocks)
            .sum::<f64>()
            / total
    } else {
        0.0
    };
    accounts.push(Account {
        account_type,
        balance: amount,
        asset_weights: AssetWeights {
            stocks,
            bonds: if total > 0.0 { 1.0 - stocks } else { 0.0 },
        },
        is_surplus_cash: total == 0.0,
    });
    amount
}

fn execute_ordered_withdrawals(
    target_spending: f64,
    accounts: &mut [Account],
    context: WithdrawalContext<'_>,
) -> Result<WithdrawalResult> {
    const TOLERANCE: f64 = 1.0;
    let forced = evaluate_ordered_withdrawals(accounts, 0.0, &context);
    if forced.cash_available_after_tax + TOLERANCE >= target_spending {
        return Ok(finish_ordered_withdrawals(
            accounts,
            forced,
            target_spending,
            TOLERANCE,
        ));
    }

    let max_voluntary_budget: f64 = forced.balances.iter().sum();
    if max_voluntary_budget <= 0.0 {
        return Ok(finish_ordered_withdrawals(
            accounts,
            forced,
            target_spending,
            TOLERANCE,
        ));
    }

    // Bracket the funded amount near the actual shortfall instead of starting
    // at the full portfolio, then bisect the monotone after-tax cash function.
    let mut low = 0.0;
    let mut high = max_voluntary_budget
        .min(((target_spending - forced.cash_available_after_tax) * 2.0).max(1.0));
    let mut best = evaluate_ordered_withdrawals(accounts, high, &context);
    while best.cash_available_after_tax + TOLERANCE < target_spending && high < max_voluntary_budget
    {
        low = high;
        high = max_voluntary_budget.min(high * 2.0);
        best = evaluate_ordered_withdrawals(accounts, high, &context);
    }
    if best.cash_available_after_tax + TOLERANCE < target_spending {
        return Ok(finish_ordered_withdrawals(
            accounts,
            best,
            target_spending,
            TOLERANCE,
        ));
    }

    for _ in 0..48 {
        if (best.cash_available_after_tax - target_spending).abs() <= TOLERANCE {
            break;
        }
        let midpoint = (low + high) / 2.0;
        let candidate = evaluate_ordered_withdrawals(accounts, midpoint, &context);
        if candidate.cash_available_after_tax + TOLERANCE >= target_spending {
            high = midpoint;
            best = candidate;
        } else {
            low = midpoint;
        }
    }

    Ok(finish_ordered_withdrawals(
        accounts,
        best,
        target_spending,
        TOLERANCE,
    ))
}

fn evaluate_ordered_withdrawals(
    accounts: &[Account],
    voluntary_budget: f64,
    context: &WithdrawalContext<'_>,
) -> WithdrawalEvaluation {
    let mut balances: Vec<f64> = accounts.iter().map(|account| account.balance).collect();
    let mut withdrawal_taxable = 0.0;
    let mut withdrawal_traditional = 0.0;
    let mut withdrawal_roth = 0.0;
    let mut withdrawal_hsa = 0.0;
    let mut qualified_income = 0.0;

    let mut rmd_remaining = context.rmd_amount;
    for (index, account) in accounts.iter().enumerate() {
        if matches!(account.account_type, AccountType::Traditional)
            && balances[index] > 0.0
            && rmd_remaining > 0.0
        {
            let withdrawal = rmd_remaining.min(balances[index]);
            balances[index] -= withdrawal;
            withdrawal_traditional += withdrawal;
            rmd_remaining -= withdrawal;
        }
    }

    let mut remaining = voluntary_budget.max(0.0);
    for (index, account) in accounts.iter().enumerate() {
        if matches!(account.account_type, AccountType::Taxable)
            && balances[index] > 0.0
            && remaining > 0.0
        {
            let withdrawal = remaining.min(balances[index]);
            balances[index] -= withdrawal;
            withdrawal_taxable += withdrawal;
            if !account.is_surplus_cash {
                qualified_income += withdrawal * context.taxable_gain_ratio;
            }
            remaining -= withdrawal;
        }
    }
    for (index, account) in accounts.iter().enumerate() {
        if matches!(account.account_type, AccountType::Traditional)
            && balances[index] > 0.0
            && remaining > 0.0
        {
            let withdrawal = remaining.min(balances[index]);
            balances[index] -= withdrawal;
            withdrawal_traditional += withdrawal;
            remaining -= withdrawal;
        }
    }
    for (index, account) in accounts.iter().enumerate() {
        if matches!(account.account_type, AccountType::Roth)
            && balances[index] > 0.0
            && remaining > 0.0
        {
            let withdrawal = remaining.min(balances[index]);
            balances[index] -= withdrawal;
            withdrawal_roth += withdrawal;
            remaining -= withdrawal;
        }
    }
    for (index, account) in accounts.iter().enumerate() {
        if matches!(account.account_type, AccountType::Hsa)
            && balances[index] > 0.0
            && remaining > 0.0
        {
            let withdrawal = remaining.min(balances[index]);
            balances[index] -= withdrawal;
            withdrawal_hsa += withdrawal;
            remaining -= withdrawal;
        }
    }

    let total_taxes = calculate_retirement_tax(
        withdrawal_traditional,
        context.social_security_benefit,
        qualified_income,
        context.age,
        context.filing_status,
        context.state,
    )
    .total_tax;
    let total_withdrawn =
        withdrawal_taxable + withdrawal_traditional + withdrawal_roth + withdrawal_hsa;
    WithdrawalEvaluation {
        balances,
        withdrawal_taxable,
        withdrawal_traditional,
        withdrawal_roth,
        withdrawal_hsa,
        total_withdrawn,
        total_taxes,
        cash_available_after_tax: context.social_security_benefit + total_withdrawn - total_taxes,
    }
}

fn finish_ordered_withdrawals(
    accounts: &mut [Account],
    evaluation: WithdrawalEvaluation,
    target_spending: f64,
    tolerance: f64,
) -> WithdrawalResult {
    for (account, balance) in accounts.iter_mut().zip(&evaluation.balances) {
        account.balance = *balance;
    }
    let difference = evaluation.cash_available_after_tax - target_spending;
    WithdrawalResult {
        withdrawal_taxable: evaluation.withdrawal_taxable,
        withdrawal_traditional: evaluation.withdrawal_traditional,
        withdrawal_roth: evaluation.withdrawal_roth,
        withdrawal_hsa: evaluation.withdrawal_hsa,
        total_withdrawn: evaluation.total_withdrawn,
        total_taxes: evaluation.total_taxes,
        insufficient_funds: difference < -tolerance,
        deposit_taxable: if difference > tolerance {
            difference
        } else {
            0.0
        },
    }
}

fn create_market_returns_generator(
    plan: &RetirementPlan,
    config: &ProjectionConfig,
) -> Box<dyn MarketReturnsGenerator> {
    // NOTE: Rust uses `rand::StdRng` while TS uses `seedrandom`. Identical seeds
    // do NOT produce identical path sequences across engines. This is accepted;
    // cross-engine results should be compared in aggregate (percentiles), not
    // path-by-path. See apps/web/src/services/simulation.ts.
    match plan.assumptions.simulation_model {
        crate::types::SimulationModel::Parametric => {
            Box::new(ParametricReturnsGenerator::new(config.seed))
        }
        crate::types::SimulationModel::Historical => {
            if config.use_historical_bootstrap {
                Box::new(BlockBootstrapGenerator::new(config.seed, config.block_size))
            } else {
                Box::new(SingleBootstrapGenerator::new(config.seed))
            }
        }
    }
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{
        AssetWeights, ProjectionSettings, SimulationModel, SocialSecuritySettings, UserProfile,
    };

    fn test_plan() -> RetirementPlan {
        RetirementPlan {
            schema_version: PLAN_SCHEMA_VERSION,
            profile: UserProfile {
                birth_date: "1962-01-01".to_string(),
                state: State::TX,
                filing_status: FilingStatus::Single,
                retirement_age: 65,
                current_salary: 100_000.0,
                salary_growth_rate: 0.03,
                current_spending: 60_000.0,
                working_spending_growth_rate: 0.0,
                retirement_spending: 60_000.0,
                retirement_spending_growth_rate: 0.025,
                life_expectancy: 90,
                as_of_date: "2026-01-01".to_string(),
            },
            accounts: vec![
                Account {
                    account_type: AccountType::Taxable,
                    balance: 500_000.0,
                    asset_weights: AssetWeights {
                        stocks: 0.6,
                        bonds: 0.4,
                    },
                    is_surplus_cash: false,
                },
                Account {
                    account_type: AccountType::Traditional,
                    balance: 500_000.0,
                    asset_weights: AssetWeights {
                        stocks: 0.6,
                        bonds: 0.4,
                    },
                    is_surplus_cash: false,
                },
            ],
            social_security: SocialSecuritySettings {
                enabled: true,
                estimated_benefit: None,
                claim_age: 65,
                manual_override: false,
            },
            assumptions: ProjectionSettings {
                simulation_model: SimulationModel::Parametric,
                random_seed: Some(42),
                taxable_gain_ratio: 0.5,
                hsa_eligible: false,
                use_backdoor_roth: false,
            },
        }
    }

    /// Overspending during working years, funded only by the portfolio.
    fn overspending_plan(taxable_balance: f64) -> RetirementPlan {
        let mut plan = test_plan();
        plan.profile.birth_date = "1985-01-01".to_string();
        plan.profile.retirement_age = 60;
        plan.profile.life_expectancy = 61;
        plan.profile.current_salary = 220_000.0;
        plan.profile.salary_growth_rate = 0.0;
        plan.profile.current_spending = 250_000.0;
        plan.profile.working_spending_growth_rate = 0.0;
        plan.profile.as_of_date = "2025-01-01".to_string();
        plan.social_security.enabled = false;
        plan.accounts = vec![Account {
            account_type: AccountType::Taxable,
            balance: taxable_balance,
            asset_weights: AssetWeights {
                stocks: 0.6,
                bonds: 0.4,
            },
            is_surplus_cash: false,
        }];
        plan
    }

    #[test]
    fn working_year_shortfall_is_funded_from_the_portfolio() {
        let config = ProjectionConfig {
            seed: 5,
            use_historical_bootstrap: true,
            block_size: 3,
        };
        let result =
            project_scenario(&overspending_plan(2_000_000.0), config).expect("projection succeeds");
        let working: Vec<_> = result.projections.iter().filter(|p| !p.is_retired).collect();

        // Overspending has to come out of the portfolio, so the household is
        // drawing down and saving nothing.
        assert!(working[1].withdrawal_taxable > 0.0);
        assert!(working[1].savings < 0.0);
        // A large portfolio absorbs the gap, so this is a drawdown, not a failure.
        assert!(!working[1].insufficient_funds);
    }

    #[test]
    fn working_year_failure_means_the_portfolio_ran_out() {
        let config = ProjectionConfig {
            seed: 5,
            use_historical_bootstrap: true,
            block_size: 3,
        };
        let rich = project_scenario(&overspending_plan(5_000_000.0), config.clone())
            .expect("projection succeeds");
        let poor =
            project_scenario(&overspending_plan(20_000.0), config).expect("projection succeeds");

        // Same overspending, opposite verdicts — success tracks whether the
        // portfolio can carry it, instead of pinning to 0% for any overspender.
        assert!(rich.success);
        assert!(!poor.success);
    }

    #[test]
    fn splitting_a_balance_across_accounts_does_not_change_the_projection() {
        let config = ProjectionConfig {
            seed: 7,
            use_historical_bootstrap: true,
            block_size: 3,
        };

        let traditional = |balance: f64, stocks: f64| Account {
            account_type: AccountType::Traditional,
            balance,
            asset_weights: AssetWeights {
                stocks,
                bonds: 1.0 - stocks,
            },
            is_surplus_cash: false,
        };

        let mut merged = test_plan();
        merged.accounts = vec![traditional(3_000_000.0, 0.7)];

        // Same money, same balance-weighted 70/30, split across two accounts.
        let mut split = test_plan();
        split.accounts = vec![traditional(1_000_000.0, 0.9), traditional(2_000_000.0, 0.6)];

        let merged_wealth = project_scenario(&merged, config.clone())
            .expect("projection should succeed")
            .terminal_wealth;
        let split_wealth = project_scenario(&split, config)
            .expect("projection should succeed")
            .terminal_wealth;

        // A depleted plan would make the comparison vacuous.
        assert!(merged_wealth > 0.0, "test plan must stay solvent");
        assert!(
            (merged_wealth - split_wealth).abs() < 1e-6,
            "splitting a balance changed terminal wealth: {merged_wealth} vs {split_wealth}"
        );
    }

    #[test]
    fn retirement_year_income_equals_ss_benefit() {
        let plan = test_plan();
        let config = ProjectionConfig {
            seed: 42,
            use_historical_bootstrap: true,
            block_size: 3,
        };
        let result = project_scenario(&plan, config).expect("projection should succeed");

        let retired = result
            .projections
            .iter()
            .find(|p| p.is_retired && p.social_security_benefit > 0.0)
            .expect("should have at least one retired year with SS benefits");

        assert!(
            retired.income > 0.0,
            "retirement-year income must not be zeroed out (regression: projection.rs:357)"
        );
        assert!(
            (retired.income - retired.social_security_benefit).abs() < 1e-6,
            "retirement-year income ({}) should equal SS benefit ({})",
            retired.income,
            retired.social_security_benefit
        );
    }

    #[test]
    fn manual_social_security_override_is_authoritative() {
        let mut plan = test_plan();
        plan.social_security.manual_override = true;
        plan.social_security.estimated_benefit = Some(50_000.0);
        let result = project_scenario(
            &plan,
            ProjectionConfig {
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .expect("projection should succeed");

        let retired = result.projections.iter().find(|p| p.is_retired).unwrap();
        assert_eq!(retired.social_security_benefit, 50_000.0);
    }

    #[test]
    fn phase_based_spending_uses_separate_growth_clocks() {
        let mut plan = test_plan();
        plan.profile.birth_date = "1966-01-01".to_string();
        plan.profile.birth_date = "1965-01-01".to_string();
        plan.profile.retirement_age = 62;
        plan.profile.life_expectancy = 63;
        plan.profile.current_spending = 40_000.0;
        plan.profile.working_spending_growth_rate = 0.1;
        plan.profile.retirement_spending = 70_000.0;
        plan.profile.retirement_spending_growth_rate = 0.05;
        plan.profile.as_of_date = "2025-01-01".into();
        plan.social_security.enabled = false;

        let result = project_scenario(
            &plan,
            ProjectionConfig {
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .unwrap();
        let expected = [40_000.0, 44_000.0, 70_000.0, 73_500.0];
        for (year, expected_spending) in result.projections.iter().zip(expected) {
            assert!((year.spending - expected_spending).abs() < 1e-6);
        }
    }

    #[test]
    fn already_retired_plan_starts_retirement_growth_at_zero() {
        let mut plan = test_plan();
        plan.profile.birth_date = "1958-01-01".to_string();
        plan.profile.birth_date = "1957-01-01".to_string();
        plan.profile.retirement_age = 65;
        plan.profile.life_expectancy = 69;
        plan.profile.retirement_spending = 50_000.0;
        plan.profile.retirement_spending_growth_rate = 0.1;
        plan.profile.as_of_date = "2025-01-01".into();
        plan.social_security.enabled = false;

        let result = project_scenario(
            &plan,
            ProjectionConfig {
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .unwrap();
        assert!((result.projections[0].spending - 50_000.0).abs() < 1e-6);
        assert!((result.projections[1].spending - 55_000.0).abs() < 1e-6);
    }

    #[test]
    fn legacy_schema_preserves_original_spending_math() {
        let mut plan = test_plan();
        plan.schema_version = 0;
        plan.profile.birth_date = "1966-01-01".to_string();
        plan.profile.birth_date = "1965-01-01".to_string();
        plan.profile.retirement_age = 62;
        plan.profile.life_expectancy = 62;
        plan.profile.current_spending = 40_000.0;
        plan.profile.working_spending_growth_rate = 0.1;
        plan.profile.retirement_spending = 70_000.0;
        plan.profile.retirement_spending_growth_rate = 0.1;
        plan.profile.as_of_date = "2025-01-01".into();
        plan.social_security.enabled = false;

        let result = project_scenario(
            &plan,
            ProjectionConfig {
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .unwrap();
        assert!((result.projections[0].spending - 40_000.0).abs() < 1e-6);
        assert!((result.projections[1].spending - 40_000.0).abs() < 1e-6);
        assert!((result.projections[2].spending - 84_700.0).abs() < 1e-6);
    }

    #[test]
    fn current_year_retirement_cash_flows_are_prorated() {
        let mut plan = test_plan();
        plan.profile.birth_date = "1959-01-01".to_string();
        plan.profile.birth_date = "1958-01-01".to_string();
        plan.profile.retirement_age = 67;
        plan.profile.life_expectancy = 68;
        plan.profile.retirement_spending = 60_000.0;
        plan.profile.retirement_spending_growth_rate = 0.1;
        plan.profile.as_of_date = "2025-07-02".into();
        plan.accounts.truncate(1);
        plan.social_security.manual_override = true;
        plan.social_security.claim_age = 67;
        plan.social_security.estimated_benefit = Some(20_000.0);

        let result = project_scenario(
            &plan,
            ProjectionConfig {
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .unwrap();
        let first_year = &result.projections[0];
        let remaining_fraction = 183.0 / 365.0;
        assert!((first_year.spending - 60_000.0 * remaining_fraction).abs() < 1e-6);
        assert!((first_year.social_security_benefit - 20_000.0 * remaining_fraction).abs() < 1e-6);
        assert!((result.projections[1].spending - 66_000.0).abs() < 1e-6);
    }

    #[test]
    fn rmd_excess_is_reinvested_after_tax_and_cash_reconciles() {
        let mut plan = test_plan();
        plan.profile.birth_date = "1953-01-01".to_string();
        plan.profile.birth_date = "1952-01-01".to_string();
        plan.profile.retirement_age = 65;
        plan.profile.life_expectancy = 74;
        plan.profile.current_salary = 0.0;
        plan.profile.retirement_spending = 30_000.0;
        plan.profile.retirement_spending_growth_rate = 0.0;
        plan.profile.as_of_date = "2025-01-01".into();
        plan.accounts = vec![Account {
            account_type: AccountType::Traditional,
            balance: 1_000_000.0,
            asset_weights: AssetWeights {
                stocks: 0.6,
                bonds: 0.4,
            },
            is_surplus_cash: false,
        }];
        plan.social_security.enabled = false;

        let result = project_scenario(
            &plan,
            ProjectionConfig {
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .unwrap();
        let first_year = &result.projections[0];
        assert!(first_year.deposit_taxable > 0.0);
        let spendable =
            first_year.withdrawal_traditional - first_year.taxes - first_year.deposit_taxable;
        assert!((spendable - first_year.spending).abs() < 1.0);

        plan.profile.as_of_date = "2025-07-02".into();
        let mid_year = project_scenario(
            &plan,
            ProjectionConfig {
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .unwrap();
        assert!(
            (mid_year.projections[0].rmd_amount - first_year.rmd_amount * (183.0 / 365.0)).abs()
                < 1e-6
        );
    }

    #[test]
    fn working_year_rmd_is_withdrawn_taxed_and_preserved() {
        let mut plan = test_plan();
        plan.profile.birth_date = "1951-01-01".to_string();
        plan.profile.birth_date = "1950-01-01".to_string();
        plan.profile.retirement_age = 80;
        plan.profile.life_expectancy = 81;
        plan.profile.current_salary = 100_000.0;
        plan.profile.current_spending = 60_000.0;
        plan.profile.as_of_date = "2025-01-01".into();
        plan.profile.state = State::TX;
        plan.accounts = vec![Account {
            account_type: AccountType::Traditional,
            balance: 1_000_000.0,
            asset_weights: AssetWeights {
                stocks: 0.0,
                bonds: 1.0,
            },
            is_surplus_cash: false,
        }];

        let result = project_scenario(
            &plan,
            ProjectionConfig {
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .unwrap();
        let first_year = &result.projections[0];
        assert!(!first_year.is_retired);
        assert!(first_year.withdrawal_traditional > 0.0);
        assert!((first_year.rmd_amount - first_year.withdrawal_traditional).abs() < 1e-6);
        assert!(first_year.deposit_taxable > 0.0);
        assert!(first_year.taxes > 0.0);
    }

    #[test]
    fn social_security_surplus_is_taxed_and_preserved() {
        let mut plan = test_plan();
        plan.profile.birth_date = "1959-01-01".to_string();
        plan.profile.birth_date = "1958-01-01".to_string();
        plan.profile.retirement_age = 65;
        plan.profile.life_expectancy = 68;
        plan.profile.retirement_spending = 50_000.0;
        plan.profile.retirement_spending_growth_rate = 0.0;
        plan.profile.as_of_date = "2025-01-01".into();
        plan.accounts.clear();
        plan.social_security.enabled = true;
        plan.social_security.manual_override = true;
        plan.social_security.claim_age = 67;
        plan.social_security.estimated_benefit = Some(200_000.0);

        let result = project_scenario(
            &plan,
            ProjectionConfig {
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .unwrap();
        let first_year = &result.projections[0];
        assert!(first_year.taxes > 0.0);
        assert!(first_year.deposit_taxable > 0.0);
        let cash_for_spending = first_year.social_security_benefit
            + first_year.withdrawal_taxable
            + first_year.withdrawal_traditional
            + first_year.withdrawal_roth
            + first_year.withdrawal_hsa
            - first_year.taxes
            - first_year.deposit_taxable;
        assert!((cash_for_spending - first_year.spending).abs() < 1.0);
    }

    #[test]
    fn high_tax_year_is_funded_when_assets_are_sufficient() {
        let mut plan = test_plan();
        plan.profile.birth_date = "1959-01-01".to_string();
        plan.profile.birth_date = "1958-01-01".to_string();
        plan.profile.retirement_age = 65;
        plan.profile.life_expectancy = 68;
        plan.profile.retirement_spending = 1_000_000_000.0;
        plan.profile.retirement_spending_growth_rate = 0.0;
        plan.profile.as_of_date = "2025-01-01".into();
        plan.profile.state = State::CA;
        plan.accounts = vec![Account {
            account_type: AccountType::Traditional,
            balance: 10_000_000_000.0,
            asset_weights: AssetWeights {
                stocks: 0.0,
                bonds: 1.0,
            },
            is_surplus_cash: false,
        }];
        plan.social_security.enabled = false;

        let result = project_scenario(
            &plan,
            ProjectionConfig {
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .unwrap();
        let first_year = &result.projections[0];
        assert!(!first_year.insufficient_funds);
        let spendable =
            first_year.withdrawal_traditional - first_year.taxes - first_year.deposit_taxable;
        assert!((spendable - first_year.spending).abs() <= 1.0);
    }
}
