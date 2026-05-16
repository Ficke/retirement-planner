/// Core retirement projection engine
/// Ports TypeScript projection.ts logic to Rust (lines 32-922)
/// Implements deterministic single-path projection with proper withdrawal ordering:
/// Taxable → Traditional → Roth → HSA

use anyhow::Result;
use rand::SeedableRng;
use rand::rngs::StdRng;
use chrono::Datelike;

use crate::types::{
    RetirementPlan, PathResult, PathProjection, Account, AccountType, FilingStatus, State
};
use super::tax::{calculate_tax, calculate_retirement_tax, get_ira_contribution_limit};
use super::rmd::{calculate_rmd, RMD_START_AGE};
use super::ssa::{calculate_ssa_benefit, estimate_salary_history};
use super::historical_data;
use super::parametric_returns;

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
        let returns = parametric_returns::generate_parametric_returns(&mut self.rng)
            .unwrap_or_else(|_| parametric_returns::MarketReturns {
                stock_return: 0.07,
                bond_return: 0.03,
            });
        (returns.stock_return, returns.bond_return)
    }
}

/// Core retirement projection engine - matches TypeScript projectScenario()
pub fn project_scenario(
    plan: &RetirementPlan,
    config: ProjectionConfig,
) -> Result<PathResult> {
    let profile = &plan.profile;
    let mut accounts = plan.accounts.clone();
    
    // Calculate fraction of current year remaining
    let as_of_date = chrono::NaiveDate::parse_from_str(&profile.as_of_date, "%Y-%m-%d")?;
    let current_year = as_of_date.year();
    let start_of_year = chrono::NaiveDate::from_ymd_opt(current_year, 1, 1).unwrap();
    let days_in_year = if is_leap_year(current_year) { 366.0 } else { 365.0 };
    let day_of_year = (as_of_date - start_of_year).num_days() as f64 + 1.0;
    let remaining_year_fraction = ((days_in_year - day_of_year + 1.0) / days_in_year).clamp(0.0, 1.0);
    
    // Calculate simulation parameters
    let years_to_retirement = profile.retirement_age - profile.age;
    let retirement_years = profile.life_expectancy - profile.retirement_age;
    let total_years = years_to_retirement + retirement_years + 1;
    
    let mut projections = Vec::with_capacity(total_years as usize);
    let mut portfolio_value: f64 = accounts.iter().map(|acc| acc.balance).sum();
    
    // Track previous year's traditional balance for RMD
    let mut previous_year_traditional_balance = 0.0;
    
    // Create market returns generator
    let mut returns_generator = create_market_returns_generator(plan, &config);
    
    for year in 0..total_years {
        let current_age = profile.age + year;
        let is_retired = current_age >= profile.retirement_age;
        
        // Calculate RMD amount for this year
        let mut rmd_amount = 0.0;
        if current_age >= RMD_START_AGE {
            let balance_for_rmd = if previous_year_traditional_balance > 0.0 {
                previous_year_traditional_balance
            } else {
                accounts.iter()
                    .filter(|acc| matches!(acc.account_type, AccountType::Traditional))
                    .map(|acc| acc.balance)
                    .sum()
            };
            rmd_amount = calculate_rmd(balance_for_rmd, current_age);
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
        let mut deposit_taxable = 0.0;
        let mut deposit_traditional = 0.0;
        let mut deposit_roth = 0.0;
        let mut deposit_hsa = 0.0;
        let mut insufficient_funds = false;
        
        if !is_retired {
            // WORKING PHASE
            let annual_salary = profile.current_salary * (1.0 + profile.salary_growth_rate).powi(year as i32);
            income = annual_salary;
            
            spending = profile.desired_spending * (1.0 + profile.spending_growth_rate).powi(year as i32);
            
            // Calculate taxes
            let tax_result = calculate_tax(
                annual_salary,
                0.0, // No qualified income during working years
                current_age,
                &profile.filing_status,
                &profile.state,
                spending,
            );
            
            taxes = tax_result.total_tax;
            
            // Calculate savings
            let ira_max = get_ira_contribution_limit(current_age);
            let after_tax_income = annual_salary - taxes - tax_result.hsa_contribution - tax_result.k401_contribution;
            let discretionary_income = after_tax_income - spending;
            
            let backdoor_roth_contribution = if plan.assumptions.use_backdoor_roth {
                discretionary_income.max(0.0).min(ira_max)
            } else {
                0.0
            };
            
            let additional_savings = (discretionary_income - backdoor_roth_contribution).max(0.0);
            savings = tax_result.hsa_contribution + tax_result.k401_contribution + backdoor_roth_contribution + additional_savings;
            
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
            
            // Add new savings (prorated for first year)
            let contribution_proration = if year == 0 { remaining_year_fraction } else { 1.0 };
            
            // HSA contributions
            if tax_result.hsa_contribution > 0.0 {
                if let Some(hsa_account) = accounts.iter_mut().find(|acc| matches!(acc.account_type, AccountType::HSA)) {
                    let deposit = tax_result.hsa_contribution * contribution_proration;
                    hsa_account.balance += deposit;
                    deposit_hsa = deposit;
                }
            }
            
            // 401k contributions
            if tax_result.k401_contribution > 0.0 {
                if let Some(trad_account) = accounts.iter_mut().find(|acc| matches!(acc.account_type, AccountType::Traditional)) {
                    let deposit = tax_result.k401_contribution * contribution_proration;
                    trad_account.balance += deposit;
                    deposit_traditional = deposit;
                }
            }
            
            // Backdoor Roth contributions
            if backdoor_roth_contribution > 0.0 {
                if let Some(roth_account) = accounts.iter_mut().find(|acc| matches!(acc.account_type, AccountType::Roth)) {
                    let deposit = backdoor_roth_contribution * contribution_proration;
                    roth_account.balance += deposit;
                    deposit_roth = deposit;
                }
            }
            
            // Additional savings to taxable
            if additional_savings > 0.0 {
                if let Some(taxable_account) = accounts.iter_mut().find(|acc| acc.taxable) {
                    let deposit = additional_savings * contribution_proration;
                    taxable_account.balance += deposit;
                    deposit_taxable = deposit;
                }
            }
            
            portfolio_value = accounts.iter().map(|acc| acc.balance).sum();
            
        } else {
            // RETIREMENT PHASE
            let target_spending = profile.desired_spending * (1.0 + profile.spending_growth_rate).powi(year as i32);

            // Calculate Social Security
            if plan.social_security.enabled && current_age >= plan.social_security.claim_age {
                let salary_history = estimate_salary_history(
                    profile.current_salary,
                    profile.salary_growth_rate,
                    profile.age,
                    profile.retirement_age,
                );
                let ssa_benefit = calculate_ssa_benefit(&salary_history, plan.social_security.claim_age);
                social_security_benefit = ssa_benefit.annual_benefit;
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

            // Calculate withdrawals
            let net_withdrawal_needed = (target_spending - social_security_benefit).max(0.0);

            let withdrawal_result = execute_optimal_withdrawals(
                net_withdrawal_needed,
                &mut accounts,
                current_age,
                &profile.filing_status,
                &profile.state,
                social_security_benefit,
                rmd_amount,
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
                if let Some(taxable_account) = accounts.iter_mut().find(|acc| acc.taxable) {
                    taxable_account.balance += deposit_taxable;
                }
            }

            // Calculate actual spending based on available funds
            spending = if insufficient_funds {
                // If funds are insufficient, actual spending is limited to what's available
                // = withdrawals - taxes + social security (and any other income sources)
                (withdrawal_result.total_withdrawn - taxes + social_security_benefit).max(0.0)
            } else {
                target_spending
            };

            income = social_security_benefit;
            savings = -(withdrawal_result.total_withdrawn);
            portfolio_value = accounts.iter().map(|acc| acc.balance).sum();
        }
        
        // Update previous year traditional balance for next iteration
        previous_year_traditional_balance = accounts.iter()
            .filter(|acc| matches!(acc.account_type, AccountType::Traditional))
            .map(|acc| acc.balance)
            .sum();
        
        projections.push(PathProjection {
            year: profile.age + year,
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
    let success = terminal_wealth > 0.0 && !ever_had_insufficient_funds;
    
    Ok(PathResult {
        terminal_wealth,
        projections,
        success,
    })
}

/// Execute tax-efficient withdrawal strategy
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

fn execute_optimal_withdrawals(
    target_after_tax_amount: f64,
    accounts: &mut [Account],
    age: u32,
    filing_status: &FilingStatus,
    state: &State,
    social_security_benefit: f64,
    rmd_amount: f64,
) -> Result<WithdrawalResult> {
    if target_after_tax_amount <= 0.0 {
        return Ok(WithdrawalResult {
            withdrawal_taxable: 0.0,
            withdrawal_traditional: 0.0,
            withdrawal_roth: 0.0,
            withdrawal_hsa: 0.0,
            total_withdrawn: 0.0,
            total_taxes: 0.0,
            insufficient_funds: false,
            deposit_taxable: 0.0,
        });
    }
    
    // Iterative tax calculation
    let mut target_gross_withdrawal = target_after_tax_amount * 1.15;
    const MAX_ITERATIONS: usize = 10;
    const TOLERANCE: f64 = 1.0;
    
    let original_balances: Vec<f64> = accounts.iter().map(|acc| acc.balance).collect();
    let mut withdrawal_taxable = 0.0;
    let mut withdrawal_traditional = 0.0;
    let mut withdrawal_roth = 0.0;
    let mut withdrawal_hsa = 0.0;
    
    for _iteration in 0..MAX_ITERATIONS {
        // Reset balances
        for (i, account) in accounts.iter_mut().enumerate() {
            account.balance = original_balances[i];
        }
        
        withdrawal_taxable = 0.0;
        withdrawal_traditional = 0.0;
        withdrawal_roth = 0.0;
        withdrawal_hsa = 0.0;
        let mut remaining_needed = target_gross_withdrawal;
        
        // Step A: Withdraw full RMD from traditional accounts
        let mut spending_needs_from_traditional = 0.0;
        
        if rmd_amount > 0.0 {
            let mut rmd_remaining = rmd_amount;
            for account in accounts.iter_mut() {
                if matches!(account.account_type, AccountType::Traditional) && account.balance > 0.0 && rmd_remaining > 0.0 {
                    let withdrawal = rmd_remaining.min(account.balance);
                    account.balance -= withdrawal;
                    withdrawal_traditional += withdrawal;
                    rmd_remaining -= withdrawal;
                }
            }
            
            spending_needs_from_traditional = withdrawal_traditional.min(remaining_needed);
            remaining_needed -= spending_needs_from_traditional;
        }
        
        // Step B: Standard withdrawal order
        
        // Taxable accounts
        for account in accounts.iter_mut() {
            if account.taxable && account.balance > 0.0 && remaining_needed > 0.0 {
                let withdrawal = remaining_needed.min(account.balance);
                account.balance -= withdrawal;
                withdrawal_taxable += withdrawal;
                remaining_needed -= withdrawal;
            }
        }
        
        // Traditional accounts (additional beyond RMD)
        for account in accounts.iter_mut() {
            if matches!(account.account_type, AccountType::Traditional) && account.balance > 0.0 && remaining_needed > 0.0 {
                let withdrawal = remaining_needed.min(account.balance);
                account.balance -= withdrawal;
                withdrawal_traditional += withdrawal;
                remaining_needed -= withdrawal;
            }
        }
        
        if rmd_amount == 0.0 {
            spending_needs_from_traditional = withdrawal_traditional;
        }
        
        // Roth accounts
        for account in accounts.iter_mut() {
            if matches!(account.account_type, AccountType::Roth) && account.balance > 0.0 && remaining_needed > 0.0 {
                let withdrawal = remaining_needed.min(account.balance);
                account.balance -= withdrawal;
                withdrawal_roth += withdrawal;
                remaining_needed -= withdrawal;
            }
        }
        
        // HSA accounts
        for account in accounts.iter_mut() {
            if matches!(account.account_type, AccountType::HSA) && account.balance > 0.0 && remaining_needed > 0.0 {
                let withdrawal = remaining_needed.min(account.balance);
                account.balance -= withdrawal;
                withdrawal_hsa += withdrawal;
                remaining_needed -= withdrawal;
            }
        }
        
        // Calculate taxes
        let excess_rmd = (rmd_amount - spending_needs_from_traditional).max(0.0);
        let qualified_income = withdrawal_taxable;
        
        let tax_result = calculate_retirement_tax(
            withdrawal_traditional,
            social_security_benefit,
            qualified_income,
            age,
            filing_status,
            state,
        );
        
        let total_taxes = tax_result.total_tax;
        let total_withdrawn = withdrawal_taxable + withdrawal_traditional + withdrawal_roth + withdrawal_hsa;
        let net_amount_for_spending = total_withdrawn - total_taxes;
        
        // Check convergence
        let difference = (net_amount_for_spending - excess_rmd - target_after_tax_amount).abs();
        
        if difference <= TOLERANCE {
            // Calculate deposit for excess RMD
            let mut deposit_taxable = 0.0;
            if excess_rmd > 0.0 {
                let marginal_tax_on_excess = calculate_marginal_tax_on_excess(
                    excess_rmd,
                    spending_needs_from_traditional,
                    social_security_benefit,
                    qualified_income,
                    age,
                    filing_status,
                    state,
                )?;
                deposit_taxable = excess_rmd - marginal_tax_on_excess;
            }
            
            return Ok(WithdrawalResult {
                withdrawal_taxable,
                withdrawal_traditional,
                withdrawal_roth,
                withdrawal_hsa,
                total_withdrawn,
                total_taxes,
                insufficient_funds: remaining_needed > 0.0,
                deposit_taxable,
            });
        }
        
        // Adjust target for next iteration
        let spending_net = net_amount_for_spending - excess_rmd;
        if spending_net < target_after_tax_amount {
            let shortfall = target_after_tax_amount - spending_net;
            target_gross_withdrawal += shortfall * 1.2;
        } else {
            let overage = spending_net - target_after_tax_amount;
            target_gross_withdrawal -= overage * 0.8;
        }
        
        target_gross_withdrawal = target_gross_withdrawal.max(0.0);
    }
    
    // Convergence failed - use final iteration
    let total_withdrawn = withdrawal_taxable + withdrawal_traditional + withdrawal_roth + withdrawal_hsa;
    let qualified_income = withdrawal_taxable;
    let tax_result = calculate_retirement_tax(
        withdrawal_traditional,
        social_security_benefit,
        qualified_income,
        age,
        filing_status,
        state,
    );
    
    let spending_needs_from_traditional = withdrawal_traditional.min(target_after_tax_amount);
    let excess_rmd = (rmd_amount - spending_needs_from_traditional).max(0.0);
    let mut deposit_taxable = 0.0;
    if excess_rmd > 0.0 {
        let marginal_tax = calculate_marginal_tax_on_excess(
            excess_rmd,
            spending_needs_from_traditional,
            social_security_benefit,
            qualified_income,
            age,
            filing_status,
            state,
        )?;
        deposit_taxable = excess_rmd - marginal_tax;
    }
    
    Ok(WithdrawalResult {
        withdrawal_taxable,
        withdrawal_traditional,
        withdrawal_roth,
        withdrawal_hsa,
        total_withdrawn,
        total_taxes: tax_result.total_tax,
        insufficient_funds: total_withdrawn < target_after_tax_amount,
        deposit_taxable,
    })
}

fn calculate_marginal_tax_on_excess(
    excess_amount: f64,
    base_traditional_income: f64,
    social_security_benefit: f64,
    qualified_income: f64,
    age: u32,
    filing_status: &FilingStatus,
    state: &State,
) -> Result<f64> {
    if excess_amount <= 0.0 {
        return Ok(0.0);
    }
    
    let base_tax = calculate_retirement_tax(
        base_traditional_income,
        social_security_benefit,
        qualified_income,
        age,
        filing_status,
        state,
    );
    
    let total_tax = calculate_retirement_tax(
        base_traditional_income + excess_amount,
        social_security_benefit,
        qualified_income,
        age,
        filing_status,
        state,
    );
    
    Ok(total_tax.total_tax - base_tax.total_tax)
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
        AssetWeights, ProjectionSettings,
        SimulationModel, SocialSecuritySettings, UserProfile,
    };

    fn test_plan() -> RetirementPlan {
        RetirementPlan {
            profile: UserProfile {
                age: 64,
                state: State::TX,
                filing_status: FilingStatus::Single,
                retirement_age: 65,
                current_salary: 100_000.0,
                salary_growth_rate: 0.03,
                desired_spending: 60_000.0,
                spending_growth_rate: 0.025,
                life_expectancy: 90,
                as_of_date: "2026-01-01".to_string(),
            },
            accounts: vec![
                Account {
                    id: "a1".into(),
                    name: "Brokerage".into(),
                    institution: "Test".into(),
                    account_type: AccountType::Taxable,
                    user_id: None,
                    balance: 500_000.0,
                    asset_weights: AssetWeights { stocks: 0.6, bonds: 0.4 },
                    taxable: true,
                    created_at: "2026-01-01".into(),
                    updated_at: "2026-01-01".into(),
                },
                Account {
                    id: "a2".into(),
                    name: "401k".into(),
                    institution: "Test".into(),
                    account_type: AccountType::Traditional,
                    user_id: None,
                    balance: 500_000.0,
                    asset_weights: AssetWeights { stocks: 0.6, bonds: 0.4 },
                    taxable: false,
                    created_at: "2026-01-01".into(),
                    updated_at: "2026-01-01".into(),
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
                use_backdoor_roth: false,
            },
        }
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
}