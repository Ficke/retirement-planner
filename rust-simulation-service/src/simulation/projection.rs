//! Single-path retirement projection compiled for both the native service and
//! the browser WebAssembly adapter.
use anyhow::Result;
use chrono::Datelike;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha12Rng;

use super::age::{age_on, birth_year_of};
use super::healthcare_premiums::{
    expected_premium_contribution, federal_poverty_level, irmaa_annual_surcharge,
};
use super::historical_data;
use super::ltc::{draw_episode, quintile_for, IncomeQuintile};
use super::parametric_returns;
use super::rmd::{calculate_rmd, get_rmd_start_age};
use super::roth_conversion::{roth_conversion_for, RothConversionInput};
use super::ssa::{calculate_ssa_benefit, estimate_salary_history};
use super::tax::{
    calculate_retirement_tax, calculate_working_cash_flow, ContributionPolicy, Household,
    OtherIncome,
};

use crate::types::{
    Account, AccountType, AssetWeights, FilingStatus, PathProjection, PathResult,
    RetirementHealthcare, RetirementPlan, State, HEALTHCARE_MODEL_SCHEMA_VERSION,
    LTC_MODEL_SCHEMA_VERSION, MEDICARE_AGE, PHASE_SPENDING_SCHEMA_VERSION,
};

/// All-in annual portfolio cost, subtracted from the realized return before it
/// reaches a balance. The historical series are gross index returns, so without
/// this every projection quietly assumes a free portfolio.
const ANNUAL_PORTFOLIO_FEE: f64 = 0.001;

const BUCKET_ORDER: [AccountType; 4] = [
    AccountType::Taxable,
    AccountType::Traditional,
    AccountType::Roth,
    AccountType::Hsa,
];

/// Cash tolerance, in dollars, below which a shortfall is considered funded.
const SHORTFALL_TOLERANCE: f64 = 1.0;

/// Each pass of the shortfall loop leaves roughly the marginal tax rate plus the
/// penalty rate of the step before it, so the worst case a household can reach —
/// top federal plus NIIT plus California plus a 20% HSA penalty, near 0.74 —
/// needs this many passes to land inside the tolerance. Every pass but the last
/// is skipped in the common case, since the loop exits once the year is funded.
const SHORTFALL_PASSES: usize = 50;

/// Traditional money taken before 59½ owes this on top of ordinary income. Ages
/// here are whole years, which 59½ falls between, so the penalty is charged
/// through 59 and dropped at 60 — the side that overstates the cost rather than
/// the one that hands a household a year of free withdrawals.
const EARLY_TRADITIONAL_PENALTY_RATE: f64 = 0.10;
const TRADITIONAL_PENALTY_AGE: u32 = 60;

/// An HSA distribution that is not for medical care, taken before 65.
const NON_QUALIFIED_HSA_PENALTY_RATE: f64 = 0.20;

/// Salt for the long-term care stream, the 64-bit golden ratio. Path seeds are
/// `base_seed + path_index`, so an LTC stream at any small offset from the seed
/// is some other path's market stream verbatim; XOR with a large odd constant
/// keeps the care draw independent of every path's returns.
const LTC_STREAM_SALT: u64 = 0x9E37_79B9_7F4A_7C15;

/// ASPE's spending distribution is conditioned on income at 65, so that is the
/// year a path reads its own state to pick a quintile from.
const LTC_OBSERVATION_AGE: u32 = 65;

/// Real rate the portfolio is annuitized at to reach ASPE's income measure,
/// which counts the annuitized value of financial assets (endnote 11).
/// Deliberately under the roughly 6% a market annuity quotes, because that
/// quote is nominal and every figure in this engine is real.
const LTC_ANNUITY_REAL_RATE: f64 = 0.025;

/// Floor on the annuity term. Without it a household with two years left
/// annuitizes its portfolio into an income no quintile boundary can contain.
const LTC_ANNUITY_MIN_TERM: u32 = 5;

/// ASPE publishes Table 9 in 2020 dollars and the tables are stored that way.
/// The plan is in its own base year, so the conversion happens here.
const LTC_TABLE_DOLLAR_YEAR: i32 = 2020;

/// Midpoint of the cohort ASPE modeled, which turns 65 in 2021-2025. Its
/// lifetime total is priced for that cohort, so real growth above inflation
/// applies between its 65th birthday and this household's, once.
const LTC_COHORT_ANCHOR_YEAR: i32 = 2023;

/// Bound on the cohort exponent. Nothing else constrains how far a birth date
/// sits from the anchor, and this compounds.
const LTC_MAX_COHORT_GROWTH_YEARS: i32 = 40;

/// One path's long-term care episode, held from the draw to the charge.
///
/// The uniform is drawn at path start so the market generator's draw order is
/// untouched, but it cannot be inverted until the loop reaches 65 and the
/// quintile is known, and the cost is not spent until the final modeled year.
struct LongTermCareDraw {
    uniform: f64,
    /// Turns one draw from the 2020-dollar table into this plan's money: CPI
    /// rebasing, cohort distance, location and care level, and the share of the
    /// age-65 lifetime horizon that remains when the plan starts.
    price_scale: f64,
    poverty_level: f64,
    annuity_factor: f64,
    quintile: Option<IncomeQuintile>,
}

impl LongTermCareDraw {
    fn start(
        plan: &RetirementPlan,
        config: &ProjectionConfig,
        base_year: i32,
        birth_year: i32,
        start_age: u32,
    ) -> Option<Self> {
        let profile = &plan.profile;
        if plan.schema_version < LTC_MODEL_SCHEMA_VERSION || !profile.long_term_care.enabled {
            return None;
        }
        // The distribution is lifetime spending from 65 to death, so a plan
        // that ends at 65 has nothing for it to price. Requiring the horizon to
        // pass 65 is also what guarantees the income observation lands in a
        // year strictly before the one the episode is charged in.
        if profile.life_expectancy <= LTC_OBSERVATION_AGE {
            return None;
        }
        // Household size for the poverty ratio only. There is no shared
        // filing-status-to-household-size helper to reuse: the engine's one
        // other household size is IRMAA's, hardcoded to 1 so a couple is not
        // charged a surcharge years before the second person is eligible.
        let household_size = match profile.filing_status {
            FilingStatus::MarriedFilingJointly => 2,
            _ => 1,
        };
        let term = (profile.life_expectancy - LTC_OBSERVATION_AGE).max(LTC_ANNUITY_MIN_TERM);
        // Rebasing 2020 dollars is a change of unit; medical costs rising
        // faster than everything else is a separate assumption, and the plan
        // already carries one. It applies between the two cohorts' 65th
        // birthdays and nowhere else: ASPE's figure is a whole life's spending
        // at DYNASIM's own price path, so compounding it again across this
        // household's horizon would charge the same decades twice.
        let cohort_growth_years = ((birth_year + LTC_OBSERVATION_AGE as i32)
            - LTC_COHORT_ANCHOR_YEAR)
            .clamp(-LTC_MAX_COHORT_GROWTH_YEARS, LTC_MAX_COHORT_GROWTH_YEARS);
        let cohort_growth =
            (1.0 + profile.retirement_healthcare.real_growth_rate).powi(cohort_growth_years);
        let mut rng = ChaCha12Rng::seed_from_u64(config.seed ^ LTC_STREAM_SALT);
        Some(Self {
            uniform: rng.gen(),
            price_scale: price_level_ratio(LTC_TABLE_DOLLAR_YEAR, base_year)
                * cohort_growth
                * profile.long_term_care.cost_multiplier
                * remaining_ltc_exposure(start_age, profile.life_expectancy),
            poverty_level: federal_poverty_level(household_size),
            annuity_factor: annuity_factor(term),
            quintile: None,
        })
    }

    /// Records the first modeled year at or past 65. A plan whose as-of date is
    /// already past 65 has no age-65 year at all, which is a common shape for
    /// this app, and its first modeled year deliberately stands in for one.
    fn observe(&mut self, current_age: u32, portfolio_value: f64, annual_income: f64) {
        if self.quintile.is_some() || current_age < LTC_OBSERVATION_AGE {
            return;
        }
        let income = self.annuity_factor * portfolio_value.max(0.0) + annual_income.max(0.0);
        self.quintile = Some(quintile_for(income / self.poverty_level));
    }

    /// The episode in the plan's base-year dollars, zero for a path that drew
    /// no episode at all.
    fn cost(&self) -> f64 {
        let Some(quintile) = self.quintile else {
            // Unreachable: `start` rejects a horizon that ends at 65, so the
            // observation always fires before the year this is charged in.
            return 0.0;
        };
        draw_episode(quintile, self.uniform)
            .map_or(0.0, |episode| episode.lifetime_cost_2020 * self.price_scale)
    }
}

fn annuity_factor(term_years: u32) -> f64 {
    LTC_ANNUITY_REAL_RATE / (1.0 - (1.0 + LTC_ANNUITY_REAL_RATE).powi(-(term_years as i32)))
}

/// Share of the age-65 lifetime distribution that remains inside this plan's
/// horizon. ASPE does not publish an age-conditioned cost distribution, so a
/// linear exposure adjustment avoids charging pre-plan years without inventing
/// another probability curve or disturbing the path's existing care draw.
fn remaining_ltc_exposure(current_age: u32, life_expectancy: u32) -> f64 {
    if current_age <= LTC_OBSERVATION_AGE {
        return 1.0;
    }

    let lifetime_years = life_expectancy.saturating_sub(LTC_OBSERVATION_AGE);
    if lifetime_years == 0 {
        return 0.0;
    }

    let remaining_years = life_expectancy.saturating_sub(current_age);
    (remaining_years as f64 / lifetime_years as f64).clamp(0.0, 1.0)
}

/// Price level between two calendar years, compounded from the CPI-U series the
/// market history already carries so that no second inflation figure has to be
/// kept in step with it. The series ends at its last published year; a plan
/// dated past that deflates to that year rather than to an invented rate.
fn price_level_ratio(from_year: i32, to_year: i32) -> f64 {
    let (earlier, later) = (from_year.min(to_year), from_year.max(to_year));
    let growth: f64 = historical_data::HISTORICAL_RETURNS
        .iter()
        .filter(|entry| (entry.year as i32) > earlier && (entry.year as i32) <= later)
        .map(|entry| 1.0 + entry.inflation_rate)
        .product();
    if to_year >= from_year {
        growth
    } else {
        1.0 / growth
    }
}

#[derive(Clone)]
struct RothConversionLot {
    conversion_year: i32,
    remaining_principal: f64,
}

#[derive(Clone)]
struct RothBasisState {
    /// False when conversions are off or the household cannot owe this penalty.
    enabled: bool,
    /// Existing Roth money and direct contributions retain the model's
    /// penalty-free assumption.
    regular_principal: f64,
    /// Conversion principal is consumed oldest-first under the statutory
    /// ordering rules.
    conversion_lots: Vec<RothConversionLot>,
    /// Sum of the still-unseasoned lots, cached so candidate penalties are O(1).
    unseasoned_principal: f64,
}

/// One year of retirement healthcare: what it costs, and the share of that cost
/// an HSA can pay tax-free.
struct HealthcareCost {
    total: f64,
    qualified: f64,
}

/// Retirement healthcare for one year. Which premium applies is a step at
/// Medicare age; out-of-pocket cost is one figure on both sides of it.
///
/// `qualified` is the share an HSA can pay tax-free. Marketplace premiums are
/// not on that list. An HSA covers premiums only for COBRA, unemployment,
/// Medicare, and long-term care, so folding them in would hand an early retiree
/// a tax break they do not have.
/// What the household's income makes of its premium. Both tests look backward:
/// IRMAA because that is the law, the marketplace credit because healthcare is
/// priced before the year's withdrawals are known and enrollment rests on an
/// estimate made in advance.
struct PremiumIncomeTest {
    prior_year_magi: Option<f64>,
    irmaa_lookback_magi: Option<f64>,
    filing_status: FilingStatus,
    household_size: u32,
}

/// Before Medicare the entered premium is treated as the benchmark plan, since
/// that is what the credit is measured against. After Medicare it is what the
/// household pays at the standard rate, and IRMAA is added to it.
///
/// The surcharge is per enrolled person, but the plan models one age, so it is
/// charged for one until a spouse's age is modeled. Charging it per filer would
/// double a couple's surcharge years before the second person is eligible.
fn income_tested_premium(list_premium: f64, on_medicare: bool, test: &PremiumIncomeTest) -> f64 {
    if on_medicare {
        // A surcharge applies to a premium. A plan that prices no Medicare
        // premium is not modeling Medicare at all, so there is nothing to
        // surcharge.
        if list_premium <= 0.0 {
            return list_premium;
        }
        return match test.irmaa_lookback_magi {
            Some(magi) => list_premium + irmaa_annual_surcharge(magi, test.filing_status, 1),
            None => list_premium,
        };
    }
    match test.prior_year_magi {
        Some(magi) => match expected_premium_contribution(magi, test.household_size) {
            Some(expected) => expected.min(list_premium).max(0.0),
            None => list_premium,
        },
        None => list_premium,
    }
}

fn healthcare_cost_for(
    healthcare: &RetirementHealthcare,
    age: u32,
    growth_years: u32,
    income_test: Option<&PremiumIncomeTest>,
) -> HealthcareCost {
    let growth = (1.0 + healthcare.real_growth_rate).powi(growth_years as i32);
    let on_medicare = age >= MEDICARE_AGE;
    let list_premium = if on_medicare {
        healthcare.medicare_premium
    } else {
        healthcare.pre_medicare_premium
    } * growth;
    let premium = match income_test {
        Some(test) => income_tested_premium(list_premium, on_medicare, test),
        None => list_premium,
    };
    let out_of_pocket = healthcare.out_of_pocket * growth;
    HealthcareCost {
        total: premium + out_of_pocket,
        qualified: out_of_pocket + if on_medicare { premium } else { 0.0 },
    }
}

/// Money taken out of a retirement wrapper too early owes a penalty on top of
/// ordinary income tax. Taxable was never sheltered. Roth conversion principal
/// has its own five-tax-year clock, tracked separately below.
fn penalties_on(
    traditional_withdrawal: f64,
    non_qualified_hsa_withdrawal: f64,
    roth_conversion_penalty: f64,
    age: u32,
) -> f64 {
    let traditional_penalty = if age < TRADITIONAL_PENALTY_AGE {
        traditional_withdrawal * EARLY_TRADITIONAL_PENALTY_RATE
    } else {
        0.0
    };
    let hsa_penalty = if age < MEDICARE_AGE {
        non_qualified_hsa_withdrawal * NON_QUALIFIED_HSA_PENALTY_RATE
    } else {
        0.0
    };
    traditional_penalty + hsa_penalty + roth_conversion_penalty
}

/// Apply Roth distribution ordering to the basis this model knows: regular
/// contributions first, then conversions oldest-first. Each conversion has an
/// exact amount and tax year, so a distribution inside its five-tax-year window
/// and before age 60 incurs the modeled 10% early-distribution penalty.
fn roth_conversion_penalty_for(withdrawal: f64, state: &RothBasisState, age: u32) -> f64 {
    if !state.enabled || withdrawal <= 0.0 || age >= TRADITIONAL_PENALTY_AGE {
        return 0.0;
    }
    let conversion_principal = (withdrawal - state.regular_principal)
        .max(0.0)
        .min(state.unseasoned_principal);
    conversion_principal * EARLY_TRADITIONAL_PENALTY_RATE
}

/// Move five-year-old conversion principal into the penalty-free basis pool.
fn season_roth_conversions(state: &mut RothBasisState, tax_year: i32) {
    let seasoned_count = state
        .conversion_lots
        .iter()
        .take_while(|lot| tax_year >= lot.conversion_year + 5)
        .count();
    if seasoned_count == 0 {
        return;
    }
    let seasoned_principal: f64 = state.conversion_lots[..seasoned_count]
        .iter()
        .map(|lot| lot.remaining_principal)
        .sum();
    state.unseasoned_principal = (state.unseasoned_principal - seasoned_principal).max(0.0);
    state.regular_principal += seasoned_principal;
    state.conversion_lots.drain(..seasoned_count);
}

/// Commit the selected withdrawal to the basis ledger after bisection finishes.
fn consume_roth_basis(withdrawal: f64, state: &mut RothBasisState) {
    if !state.enabled || withdrawal <= 0.0 {
        return;
    }
    let mut remaining = withdrawal;
    let regular_used = remaining.min(state.regular_principal);
    state.regular_principal -= regular_used;
    remaining -= regular_used;
    let conversion_principal_used = remaining.min(state.unseasoned_principal);
    state.unseasoned_principal = (state.unseasoned_principal - conversion_principal_used).max(0.0);

    for lot in &mut state.conversion_lots {
        if remaining <= 0.0 {
            break;
        }
        let used = remaining.min(lot.remaining_principal);
        lot.remaining_principal -= used;
        remaining -= used;
    }
}

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

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PathSummary {
    pub terminal_wealth: f64,
    pub success: bool,
}

pub trait MarketReturnsGenerator {
    fn next(&mut self) -> (f64, f64); // (stock_return, bond_return)
}

pub struct SingleBootstrapGenerator {
    rng: ChaCha12Rng,
}

impl SingleBootstrapGenerator {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: ChaCha12Rng::seed_from_u64(seed),
        }
    }
}

impl MarketReturnsGenerator for SingleBootstrapGenerator {
    fn next(&mut self) -> (f64, f64) {
        historical_data::sample_historical_returns(&mut self.rng)
    }
}

pub struct BlockBootstrapGenerator {
    rng: ChaCha12Rng,
    block_size: usize,
    current_block: Vec<(f64, f64)>,
    block_index: usize,
}

impl BlockBootstrapGenerator {
    pub fn new(seed: u64, block_size: usize) -> Self {
        let mut generator = Self {
            rng: ChaCha12Rng::seed_from_u64(seed),
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

pub struct ParametricReturnsGenerator {
    rng: ChaCha12Rng,
}

impl ParametricReturnsGenerator {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: ChaCha12Rng::seed_from_u64(seed),
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

/// One deterministic path from the as-of date through life expectancy.
pub fn project_scenario(plan: &RetirementPlan, config: ProjectionConfig) -> Result<PathResult> {
    project_scenario_internal(plan, config, true)
}

/// Run the exact projection loop without retaining yearly cash-flow rows.
pub fn project_scenario_summary(
    plan: &RetirementPlan,
    config: ProjectionConfig,
) -> Result<PathSummary> {
    let result = project_scenario_internal(plan, config, false)?;
    Ok(PathSummary {
        terminal_wealth: result.terminal_wealth,
        success: result.success,
    })
}

fn project_scenario_internal(
    plan: &RetirementPlan,
    config: ProjectionConfig,
    record_projections: bool,
) -> Result<PathResult> {
    let profile = &plan.profile;
    let mut accounts = to_buckets(&plan.accounts);
    let mut roth_basis = RothBasisState {
        enabled: plan.assumptions.roth_conversion.enabled
            && profile.retirement_age < TRADITIONAL_PENALTY_AGE,
        regular_principal: balance_of_bucket(&accounts, AccountType::Roth),
        conversion_lots: Vec::new(),
        unseasoned_principal: 0.0,
    };

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

    let mut projections = Vec::with_capacity(if record_projections {
        total_years as usize
    } else {
        0
    });
    let mut success = true;
    let mut portfolio_value: f64 = accounts.iter().map(|acc| acc.balance).sum();

    let mut previous_year_traditional_balance = 0.0;
    // Medical cost the HSA may still reimburse tax-free, carried year to year.
    let mut hsa_qualified_allowance = 0.0;
    // MAGI for each modeled year, which the next years' premiums are tested
    // against.
    let mut magi_by_year: Vec<f64> = Vec::with_capacity(total_years as usize);

    let mut returns_generator = create_market_returns_generator(plan, &config);
    let mut long_term_care = LongTermCareDraw::start(plan, &config, current_year, birth_year, age);

    for year in 0..total_years {
        let current_age = age + year;
        let tax_year = current_year + year as i32;
        let household = Household::single(profile.filing_status, current_age);
        let is_retired = current_age >= profile.retirement_age;

        if current_age >= TRADITIONAL_PENALTY_AGE && roth_basis.enabled {
            roth_basis.enabled = false;
            roth_basis.regular_principal = 0.0;
            roth_basis.conversion_lots.clear();
            roth_basis.unseasoned_principal = 0.0;
        } else if roth_basis.enabled {
            season_roth_conversions(&mut roth_basis, tax_year);
        }

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
        let mut taxes;
        let savings;
        let mut roth_conversion = 0.0;
        let mut conversion_tax_from_taxable = 0.0;
        let mut conversion_tax_withheld = 0.0;
        let mut social_security_benefit = 0.0;
        let mut withdrawal_taxable = 0.0;
        let mut withdrawal_traditional = 0.0;
        let mut withdrawal_roth = 0.0;
        let mut withdrawal_hsa = 0.0;
        let deposit_taxable;
        let mut deposit_traditional = 0.0;
        let mut deposit_roth = 0.0;
        let mut deposit_hsa = 0.0;
        let mut healthcare_cost = 0.0;
        let insufficient_funds;

        if !is_retired {
            let annual_salary =
                profile.current_salary * (1.0 + profile.salary_growth_rate).powi(year as i32);
            let annual_working_spending = if plan.schema_version >= PHASE_SPENDING_SCHEMA_VERSION {
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

            let (stock_return, bond_return) = returns_generator.next();

            for account in &mut accounts {
                let account_return = account.asset_weights.stocks * stock_return
                    + account.asset_weights.bonds * bond_return
                    - ANNUAL_PORTFOLIO_FEE;

                let effective_return = if year == 0 {
                    account_return * remaining_year_fraction
                } else {
                    account_return
                };

                account.balance *= 1.0 + effective_return;
                // An extreme drawdown can drive the weighted return below -100%.
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
            // An early-withdrawal penalty is cash out the door, not a tax on
            // income, so the cash-flow model sees it the way it sees spending:
            // it shrinks what is left to invest and widens the gap the
            // portfolio has to close.
            let cash_flow_with = |penalties: f64, ordinary: f64, qualified: f64| {
                calculate_working_cash_flow(
                    annual_salary,
                    annual_working_spending + penalties / period_fraction,
                    &household,
                    &profile.state,
                    tax_year,
                    &policy,
                    OtherIncome {
                        ordinary,
                        qualified,
                    },
                )
            };
            let mut working_cash_flow = cash_flow_with(0.0, annualized_rmd_income, 0.0);

            // Spending above after-tax income is funded from the portfolio,
            // exactly as it is in retirement — it is a drawdown, not a failure.
            // Traditional withdrawals are ordinary income and taxable
            // withdrawals realize gains, so each pass re-converges the tax the
            // withdrawal itself creates.
            // Each draw creates income, which raises the gap, which needs a
            // further draw. The step shrinks by roughly the marginal rate each
            // pass, so this converges quickly — but it has to actually converge,
            // because the remainder left over decides whether the year was
            // funded. Hence signed `net_cash_flow` rather than a gap floored at
            // zero: once the gap closes, a zero floor hides the cash a draw
            // still owes and asks for another draw, which owes more again.
            let mut shortfall_principal = 0.0;
            let mut shortfall_gains = 0.0;
            let mut working_penalties = 0.0;
            for _ in 0..SHORTFALL_PASSES {
                let remaining = (-working_cash_flow.net_cash_flow * period_fraction
                    - shortfall_principal)
                    .max(0.0);
                if remaining <= SHORTFALL_TOLERANCE {
                    break;
                }
                let drawn = withdraw_in_order(&mut accounts, remaining);
                if drawn.total <= SHORTFALL_TOLERANCE {
                    break; // portfolio exhausted
                }
                withdrawal_taxable += drawn.taxable;
                withdrawal_traditional += drawn.traditional;
                withdrawal_roth += drawn.roth;
                withdrawal_hsa += drawn.hsa;
                // Traditional and HSA reach the cash-flow model as income; only
                // the buckets it never sees are principal it has to be credited
                // with.
                working_penalties += penalties_on(drawn.traditional, drawn.hsa, 0.0, current_age);
                shortfall_principal += drawn.taxable + drawn.roth;
                shortfall_gains += drawn.taxable * taxable_gain_ratio;
                working_cash_flow = cash_flow_with(
                    working_penalties,
                    // A working-year HSA draw is not paying a modeled medical
                    // cost, so it is an ordinary distribution rather than a
                    // tax-free one.
                    (withdrawal_traditional + withdrawal_hsa) / period_fraction,
                    shortfall_gains / period_fraction,
                );
            }

            // The shortfall that survived every draw — measured once, after the
            // loop, rather than left holding whatever the last pass tried.
            let unfunded =
                (-working_cash_flow.net_cash_flow * period_fraction - shortfall_principal).max(0.0);

            income = annual_salary * period_fraction;
            spending = annual_working_spending * period_fraction - unfunded;
            taxes = working_cash_flow.tax.total_tax * period_fraction + working_penalties;
            // Only true ruin counts as failure: the portfolio could not cover it.
            insufficient_funds = unfunded > SHORTFALL_TOLERANCE;
            if roth_basis.enabled {
                roth_basis.regular_principal =
                    (roth_basis.regular_principal - withdrawal_roth).max(0.0);
            }

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
            if roth_basis.enabled {
                roth_basis.regular_principal += deposit_roth;
            }
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
            let retirement_period_fraction = if year == 0 {
                remaining_year_fraction
            } else {
                1.0
            };
            let spending_growth_exponent = if plan.schema_version >= PHASE_SPENDING_SCHEMA_VERSION {
                let retirement_start_year = profile.retirement_age.saturating_sub(age);
                year - retirement_start_year
            } else {
                // Legacy requests compounded the retirement rate from the
                // as-of year, including working years.
                year
            };
            // Real medical growth runs from the as-of date, so a plan decades
            // out retires into the cost its entered figures grow to. Older
            // requests compounded from the first retirement year instead.
            let healthcare_growth_years = if plan.schema_version >= HEALTHCARE_MODEL_SCHEMA_VERSION
            {
                year
            } else {
                year.saturating_sub(profile.retirement_age.saturating_sub(age))
            };
            let income_test = if plan.schema_version >= HEALTHCARE_MODEL_SCHEMA_VERSION {
                Some(PremiumIncomeTest {
                    prior_year_magi: year
                        .checked_sub(1)
                        .and_then(|y| magi_by_year.get(y as usize))
                        .copied(),
                    irmaa_lookback_magi: year
                        .checked_sub(2)
                        .and_then(|y| magi_by_year.get(y as usize))
                        .copied(),
                    filing_status: profile.filing_status,
                    household_size: 1,
                })
            } else {
                None
            };
            let healthcare = healthcare_cost_for(
                &profile.retirement_healthcare,
                current_age,
                healthcare_growth_years,
                income_test.as_ref(),
            );
            // Medical spending is what an HSA can cover tax-free, and the
            // allowance carries forward: an HSA has no reimbursement deadline,
            // and this bucket is drained last, so by the time it is touched the
            // allowance is large.
            hsa_qualified_allowance += healthcare.qualified * retirement_period_fraction;
            healthcare_cost = healthcare.total * retirement_period_fraction;
            // A lifetime episode total, not an annual rate, so it is charged
            // whole in the last modeled year and never prorated. Care services
            // are deductible medical expenses under IRC 213(d), so the HSA
            // allowance grows with it.
            let long_term_care_cost = match &long_term_care {
                Some(draw) if year + 1 == total_years => draw.cost(),
                _ => 0.0,
            };
            hsa_qualified_allowance += long_term_care_cost;
            healthcare_cost += long_term_care_cost;
            let target_spending = profile.retirement_spending
                * (1.0 + profile.retirement_spending_growth_rate)
                    .powi(spending_growth_exponent as i32)
                * retirement_period_fraction
                + healthcare_cost;

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

            let (stock_return, bond_return) = returns_generator.next();

            for account in &mut accounts {
                let account_return = account.asset_weights.stocks * stock_return
                    + account.asset_weights.bonds * bond_return
                    - ANNUAL_PORTFOLIO_FEE;

                let effective_return = if year == 0 {
                    account_return * remaining_year_fraction
                } else {
                    account_return
                };

                account.balance *= 1.0 + effective_return;
                // An extreme drawdown can drive the weighted return below -100%.
                account.balance = account.balance.max(0.0);
            }

            rmd_amount *= retirement_period_fraction;
            let withdrawal_result = execute_ordered_withdrawals(
                target_spending,
                &mut accounts,
                &mut roth_basis,
                WithdrawalContext {
                    household: &household,
                    state: &profile.state,
                    tax_year,
                    age: current_age,
                    social_security_benefit,
                    rmd_amount,
                    taxable_gain_ratio: plan.assumptions.taxable_gain_ratio,
                    hsa_qualified_allowance,
                },
            )?;

            hsa_qualified_allowance -= withdrawal_result.hsa_qualified_used;

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

            // Converting after the year's spending is funded is both the
            // realistic order -- the amount is chosen in December, once income
            // is known -- and the only one that cannot overfill the ceiling,
            // since every ordinary dollar the year will report has already been
            // realized. A year that could not fund itself has nothing spare to
            // convert with.
            if current_age < rmd_start_age && !insufficient_funds {
                let conversion = roth_conversion_for(&RothConversionInput {
                    policy: plan.assumptions.roth_conversion,
                    traditional_withdrawals: withdrawal_traditional,
                    social_security_benefit,
                    qualified_income: withdrawal_taxable * plan.assumptions.taxable_gain_ratio,
                    taxable_withdrawals: withdrawal_taxable,
                    taxable_gain_ratio: plan.assumptions.taxable_gain_ratio,
                    household: &household,
                    state: &profile.state,
                    tax_year,
                    traditional_balance: balance_of_bucket(&accounts, AccountType::Traditional),
                    taxable_balance: balance_of_bucket(&accounts, AccountType::Taxable),
                });
                if conversion.converted > 0.0 {
                    draw_from_bucket(
                        &mut accounts,
                        AccountType::Traditional,
                        conversion.converted,
                    );
                    draw_from_bucket(&mut accounts, AccountType::Taxable, conversion.from_taxable);
                    deposit_to_bucket(
                        &mut accounts,
                        AccountType::Roth,
                        conversion.converted - conversion.withheld,
                    );
                    // What reached the Roth. Tax withheld out of a conversion
                    // never gets there, so it is reported as the ordinary
                    // distribution it is -- which also keeps the two figures
                    // from double-counting a dollar.
                    roth_conversion = conversion.converted - conversion.withheld;
                    if roth_basis.enabled {
                        roth_basis.conversion_lots.push(RothConversionLot {
                            conversion_year: tax_year,
                            remaining_principal: roth_conversion,
                        });
                        roth_basis.unseasoned_principal += roth_conversion;
                    }
                    conversion_tax_from_taxable = conversion.from_taxable;
                    conversion_tax_withheld = conversion.withheld;
                    taxes += conversion.tax;
                }
            }

            spending = if insufficient_funds {
                (withdrawal_result.total_withdrawn - taxes - deposit_taxable
                    + social_security_benefit)
                    .max(0.0)
            } else {
                target_spending
            };

            withdrawal_taxable += conversion_tax_from_taxable;
            withdrawal_traditional += conversion_tax_withheld;

            income = social_security_benefit;
            savings = deposit_taxable
                - withdrawal_result.total_withdrawn
                - conversion_tax_from_taxable
                - conversion_tax_withheld;
            portfolio_value = accounts.iter().map(|acc| acc.balance).sum();
        }

        if let Some(draw) = long_term_care.as_mut() {
            // ASPE's quintiles are cut on an annual income, while the first
            // modeled year's flows are prorated to the remainder of the
            // calendar year, so the proration is undone before the comparison.
            let annual_income = if year == 0 {
                income / remaining_year_fraction
            } else {
                income
            };
            draw.observe(current_age, portfolio_value, annual_income);
        }

        previous_year_traditional_balance = accounts
            .iter()
            .filter(|acc| matches!(acc.account_type, AccountType::Traditional))
            .map(|acc| acc.balance)
            .sum();

        // `income` is wages while working and the whole benefit once retired.
        // That is the ACA definition, which adds untaxed Social Security back;
        // IRMAA counts only the taxable part, so this runs high by the untaxed
        // remainder. At the income a surcharge starts from, 85% of the benefit
        // is taxable anyway, and erring high charges the surcharge sooner.
        magi_by_year.push(
            income
                + withdrawal_traditional
                + roth_conversion
                + withdrawal_taxable * plan.assumptions.taxable_gain_ratio,
        );

        if insufficient_funds {
            success = false;
        }
        if record_projections {
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
                roth_conversion,
                deposit_taxable,
                deposit_traditional,
                deposit_roth,
                deposit_hsa,
                // Outcome cohorts average this field, so cap it on the
                // individual path before aggregation. Capping cohort means
                // later would distort mixed funded/underfunded cohorts.
                healthcare_cost: healthcare_cost.min(spending.max(0.0)),
                insufficient_funds,
            });
        }
    }

    let terminal_wealth = portfolio_value;
    Ok(PathResult {
        terminal_wealth,
        after_tax_terminal_wealth: after_tax_wealth_of(
            &accounts,
            plan.assumptions.terminal_tax_rate,
        ),
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
    hsa_qualified_used: f64,
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
    hsa_qualified_used: f64,
}

struct WithdrawalContext<'a> {
    household: &'a Household,
    state: &'a State,
    tax_year: i32,
    age: u32,
    social_security_benefit: f64,
    rmd_amount: f64,
    taxable_gain_ratio: f64,
    hsa_qualified_allowance: f64,
}

/// Deposit into a type's bucket, opening it when the household holds no account
/// of that kind — funding must never depend on which accounts happen to exist.
/// A new bucket inherits the portfolio's blend so the money is invested the way
/// the rest of it is; with nothing to blend it stays in cash, which is also what
/// keeps that balance out of the taxable-gain calculation.
///
/// Returns the amount deposited, for the caller's cash-flow row.
fn balance_of_bucket(accounts: &[Account], account_type: AccountType) -> f64 {
    accounts
        .iter()
        .filter(|account| account.account_type == account_type)
        .map(|account| account.balance)
        .sum()
}

/// Take `amount` from one bucket, or whatever of it that bucket holds.
fn draw_from_bucket(accounts: &mut [Account], account_type: AccountType, amount: f64) -> f64 {
    if amount <= 0.0 {
        return 0.0;
    }
    match accounts
        .iter_mut()
        .find(|account| account.account_type == account_type)
    {
        Some(bucket) => {
            let drawn = amount.min(bucket.balance);
            bucket.balance -= drawn;
            drawn
        }
        None => 0.0,
    }
}

/// What the portfolio is worth once the tax nobody has paid yet is settled.
///
/// Traditional and HSA balances are income in respect of a decedent: no step-up
/// in basis, and ordinary rates on every dollar. Taxable and Roth pass through
/// whole -- an inherited taxable account steps its basis up to date-of-death
/// value, and a Roth owes nothing either way.
fn after_tax_wealth_of(accounts: &[Account], terminal_tax_rate: f64) -> f64 {
    accounts
        .iter()
        .map(|account| {
            let taxed = matches!(
                account.account_type,
                AccountType::Traditional | AccountType::Hsa
            );
            account.balance * if taxed { 1.0 - terminal_tax_rate } else { 1.0 }
        })
        .sum()
}

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
    roth_basis: &mut RothBasisState,
    context: WithdrawalContext<'_>,
) -> Result<WithdrawalResult> {
    const TOLERANCE: f64 = 1.0;
    let forced = evaluate_ordered_withdrawals(accounts, roth_basis, 0.0, &context);
    if forced.cash_available_after_tax + TOLERANCE >= target_spending {
        return Ok(finish_ordered_withdrawals(
            accounts,
            roth_basis,
            forced,
            target_spending,
            TOLERANCE,
        ));
    }

    let max_voluntary_budget: f64 = forced.balances.iter().sum();
    if max_voluntary_budget <= 0.0 {
        return Ok(finish_ordered_withdrawals(
            accounts,
            roth_basis,
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
    let mut best = evaluate_ordered_withdrawals(accounts, roth_basis, high, &context);
    while best.cash_available_after_tax + TOLERANCE < target_spending && high < max_voluntary_budget
    {
        low = high;
        high = max_voluntary_budget.min(high * 2.0);
        best = evaluate_ordered_withdrawals(accounts, roth_basis, high, &context);
    }
    if best.cash_available_after_tax + TOLERANCE < target_spending {
        return Ok(finish_ordered_withdrawals(
            accounts,
            roth_basis,
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
        let candidate = evaluate_ordered_withdrawals(accounts, roth_basis, midpoint, &context);
        if candidate.cash_available_after_tax + TOLERANCE >= target_spending {
            high = midpoint;
            best = candidate;
        } else {
            low = midpoint;
        }
    }

    Ok(finish_ordered_withdrawals(
        accounts,
        roth_basis,
        best,
        target_spending,
        TOLERANCE,
    ))
}

fn evaluate_ordered_withdrawals(
    accounts: &[Account],
    roth_basis: &RothBasisState,
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

    let roth_conversion_penalty = if roth_basis.enabled && withdrawal_roth > 0.0 {
        roth_conversion_penalty_for(withdrawal_roth, roth_basis, context.age)
    } else {
        0.0
    };

    // An HSA pays medical costs tax-free; anything beyond them is an ordinary
    // distribution, and before 65 it carries a penalty as well.
    let hsa_qualified_used = withdrawal_hsa.min(context.hsa_qualified_allowance);
    let non_qualified_hsa = withdrawal_hsa - hsa_qualified_used;

    let tax = calculate_retirement_tax(
        withdrawal_traditional + non_qualified_hsa,
        context.social_security_benefit,
        qualified_income,
        context.household,
        context.state,
        context.tax_year,
    )
    .total_tax;
    let penalties = penalties_on(
        withdrawal_traditional,
        non_qualified_hsa,
        roth_conversion_penalty,
        context.age,
    );
    let total_taxes = tax + penalties;
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
        hsa_qualified_used,
    }
}

fn finish_ordered_withdrawals(
    accounts: &mut [Account],
    roth_basis: &mut RothBasisState,
    evaluation: WithdrawalEvaluation,
    target_spending: f64,
    tolerance: f64,
) -> WithdrawalResult {
    for (account, balance) in accounts.iter_mut().zip(&evaluation.balances) {
        account.balance = *balance;
    }
    if roth_basis.enabled && evaluation.withdrawal_roth > 0.0 {
        consume_roth_basis(evaluation.withdrawal_roth, roth_basis);
        roth_basis
            .conversion_lots
            .retain(|lot| lot.remaining_principal > 0.0);
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
        hsa_qualified_used: evaluation.hsa_qualified_used,
    }
}

fn create_market_returns_generator(
    plan: &RetirementPlan,
    config: &ProjectionConfig,
) -> Box<dyn MarketReturnsGenerator> {
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
    use crate::types::FilingStatus;
    use crate::types::{
        AssetWeights, LongTermCare, ProjectionSettings, RetirementHealthcare, SimulationModel,
        SocialSecuritySettings, UserProfile,
    };
    use rand::RngCore;

    #[test]
    fn chacha12_seed_42_has_a_pinned_reference_stream() {
        let mut rng = ChaCha12Rng::seed_from_u64(42);
        let actual = [rng.next_u64(), rng.next_u64(), rng.next_u64()];

        assert_eq!(
            actual,
            [
                9_713_269_763_989_775_522,
                10_011_513_049_433_592_189,
                11_740_708_795_755_607_249,
            ]
        );
    }
    use crate::types::{RothConversionCeiling, RothConversionPolicy, PLAN_SCHEMA_VERSION};

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
                retirement_healthcare: Default::default(),
                // Off, unlike the product default, so that a test about
                // anything else is not reading a lifetime care bill in its
                // final year. The long-term care tests turn it back on.
                long_term_care: LongTermCare {
                    enabled: false,
                    cost_multiplier: 1.0,
                },
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
                random_seed: 42,
                taxable_gain_ratio: 0.5,
                hsa_eligible: false,
                use_backdoor_roth: false,
                roth_conversion: RothConversionPolicy::default(),
                terminal_tax_rate: 0.30,
            },
        }
    }

    /// A pre-tax-heavy plan with a long gap between retirement and RMDs, which
    /// is the shape a conversion setting exists for.
    fn conversion_plan(policy: RothConversionPolicy) -> RetirementPlan {
        let mut plan = test_plan();
        plan.profile.birth_date = "1960-01-01".to_string();
        plan.profile.as_of_date = "2025-01-01".to_string();
        plan.profile.current_salary = 0.0;
        plan.profile.retirement_age = 65;
        plan.profile.life_expectancy = 95;
        plan.profile.retirement_spending_growth_rate = 0.0;
        plan.social_security.enabled = false;
        plan.accounts = vec![
            Account {
                account_type: AccountType::Traditional,
                balance: 3_000_000.0,
                asset_weights: AssetWeights {
                    stocks: 0.6,
                    bonds: 0.4,
                },
                is_surplus_cash: false,
            },
            Account {
                account_type: AccountType::Taxable,
                balance: 800_000.0,
                asset_weights: AssetWeights {
                    stocks: 0.7,
                    bonds: 0.3,
                },
                is_surplus_cash: false,
            },
        ];
        plan.assumptions.roth_conversion = policy;
        plan
    }

    fn conversion_config() -> ProjectionConfig {
        ProjectionConfig {
            seed: 42,
            use_historical_bootstrap: false,
            block_size: 5,
        }
    }

    fn early_ladder_plan() -> RetirementPlan {
        let mut plan = conversion_plan(RothConversionPolicy {
            enabled: true,
            ceiling: RothConversionCeiling::Bracket24,
        });
        plan.profile.birth_date = "1976-01-01".to_string();
        plan.profile.as_of_date = "2026-12-31".to_string();
        plan.profile.retirement_age = 50;
        plan.profile.life_expectancy = 56;
        plan.profile.current_spending = 20_000.0;
        plan.profile.retirement_spending = 20_000.0;
        plan.profile.state = State::TX;
        plan.accounts = vec![account(AccountType::Traditional, 250_000.0)];
        plan
    }

    fn account(account_type: AccountType, balance: f64) -> Account {
        Account {
            account_type,
            balance,
            asset_weights: AssetWeights {
                stocks: 0.0,
                bonds: 1.0,
            },
            is_surplus_cash: false,
        }
    }

    fn withdrawal_context(
        age: u32,
        rmd_amount: f64,
        household: &Household,
    ) -> WithdrawalContext<'_> {
        static STATE: State = State::TX;

        WithdrawalContext {
            household,
            state: &STATE,
            tax_year: 2026,
            age,
            social_security_benefit: 0.0,
            rmd_amount,
            taxable_gain_ratio: 0.0,
            hsa_qualified_allowance: 0.0,
        }
    }

    fn disabled_roth_basis() -> RothBasisState {
        RothBasisState {
            enabled: false,
            regular_principal: 0.0,
            conversion_lots: Vec::new(),
            unseasoned_principal: 0.0,
        }
    }

    #[test]
    fn voluntary_withdrawals_follow_taxable_traditional_roth_hsa_priority() {
        let household = Household::single(FilingStatus::Single, 65);
        let accounts = vec![
            account(AccountType::Hsa, 10_000.0),
            account(AccountType::Roth, 10_000.0),
            account(AccountType::Traditional, 10_000.0),
            account(AccountType::Taxable, 10_000.0),
        ];
        let evaluation = evaluate_ordered_withdrawals(
            &accounts,
            &disabled_roth_basis(),
            25_000.0,
            &withdrawal_context(65, 0.0, &household),
        );

        assert_eq!(evaluation.withdrawal_taxable, 10_000.0);
        assert_eq!(evaluation.withdrawal_traditional, 10_000.0);
        assert_eq!(evaluation.withdrawal_roth, 5_000.0);
        assert_eq!(evaluation.withdrawal_hsa, 0.0);

        let hsa_reached = evaluate_ordered_withdrawals(
            &accounts,
            &disabled_roth_basis(),
            35_000.0,
            &withdrawal_context(65, 0.0, &household),
        );
        assert_eq!(hsa_reached.withdrawal_taxable, 10_000.0);
        assert_eq!(hsa_reached.withdrawal_traditional, 10_000.0);
        assert_eq!(hsa_reached.withdrawal_roth, 10_000.0);
        assert_eq!(hsa_reached.withdrawal_hsa, 5_000.0);
    }

    #[test]
    fn hsa_stays_untouched_while_traditional_money_can_fund_retirement() {
        let household = Household::single(FilingStatus::Single, 75);
        let mut accounts = vec![
            account(AccountType::Traditional, 1_000_000.0),
            account(AccountType::Roth, 300_000.0),
            account(AccountType::Hsa, 50_000.0),
            account(AccountType::Taxable, 100_000.0),
        ];
        let mut roth_basis = disabled_roth_basis();
        let result = execute_ordered_withdrawals(
            120_000.0,
            &mut accounts,
            &mut roth_basis,
            withdrawal_context(75, 1_000_000.0 / 24.6, &household),
        )
        .expect("withdrawal succeeds");

        assert!(result.withdrawal_traditional > 30_000.0);
        assert_eq!(result.withdrawal_roth, 0.0);
        assert_eq!(result.withdrawal_hsa, 0.0);
        assert!(!result.insufficient_funds);
    }

    #[test]
    fn converts_nothing_when_the_policy_is_off() {
        let result = project_scenario(
            &conversion_plan(RothConversionPolicy::default()),
            conversion_config(),
        )
        .unwrap();
        assert!(result
            .projections
            .iter()
            .all(|year| year.roth_conversion == 0.0));
    }

    #[test]
    fn converts_only_between_retirement_and_the_first_rmd() {
        let plan = conversion_plan(RothConversionPolicy {
            enabled: true,
            ceiling: RothConversionCeiling::Bracket24,
        });
        let result = project_scenario(&plan, conversion_config()).unwrap();
        let converting: Vec<_> = result
            .projections
            .iter()
            .filter(|year| year.roth_conversion > 0.0)
            .collect();

        assert!(!converting.is_empty());
        // Born 1960, so RMDs wait until 75 and the window is ten years long.
        assert!(converting
            .iter()
            .all(|year| year.age >= 65 && year.age < 75));
    }

    #[test]
    fn a_higher_ceiling_converts_more() {
        let total = |ceiling| {
            project_scenario(
                &conversion_plan(RothConversionPolicy {
                    enabled: true,
                    ceiling,
                }),
                conversion_config(),
            )
            .unwrap()
            .projections
            .iter()
            .map(|year| year.roth_conversion)
            .sum::<f64>()
        };

        assert!(total(RothConversionCeiling::Bracket24) > total(RothConversionCeiling::Bracket12));
        assert!(total(RothConversionCeiling::Bracket32) > total(RothConversionCeiling::Bracket24));
    }

    #[test]
    fn conversions_shrink_the_first_required_distribution() {
        let first_rmd = |policy| {
            project_scenario(&conversion_plan(policy), conversion_config())
                .unwrap()
                .projections
                .iter()
                .find(|year| year.age == 75)
                .unwrap()
                .rmd_amount
        };

        assert!(
            first_rmd(RothConversionPolicy {
                enabled: true,
                ceiling: RothConversionCeiling::Bracket24,
            }) < first_rmd(RothConversionPolicy::default())
        );
    }

    #[test]
    fn conversion_year_cash_flow_reconciles() {
        let result = project_scenario(
            &conversion_plan(RothConversionPolicy {
                enabled: true,
                ceiling: RothConversionCeiling::Bracket24,
            }),
            conversion_config(),
        )
        .unwrap();
        let converting: Vec<_> = result
            .projections
            .iter()
            .filter(|year| year.roth_conversion > 0.0)
            .collect();

        assert!(!converting.is_empty());
        for year in converting {
            let money_in = year.income
                + year.withdrawal_taxable
                + year.withdrawal_traditional
                + year.withdrawal_roth
                + year.withdrawal_hsa
                - year.deposit_taxable;
            let money_out = year.spending + year.taxes;
            assert!((money_out - money_in).abs() < SHORTFALL_TOLERANCE);
        }
    }

    #[test]
    fn first_conversion_year_portfolio_delta_equals_incremental_tax() {
        let without = project_scenario(
            &conversion_plan(RothConversionPolicy::default()),
            conversion_config(),
        )
        .unwrap();
        let with = project_scenario(
            &conversion_plan(RothConversionPolicy {
                enabled: true,
                ceiling: RothConversionCeiling::Bracket24,
            }),
            conversion_config(),
        )
        .unwrap();
        let first = with
            .projections
            .iter()
            .position(|year| year.roth_conversion > 0.0)
            .unwrap();
        let portfolio_gap =
            without.projections[first].portfolio_value - with.projections[first].portfolio_value;
        let incremental_tax = with.projections[first].taxes - without.projections[first].taxes;

        assert!(with.projections[first].roth_conversion > 0.0);
        assert!((portfolio_gap - incremental_tax).abs() < 0.0001);
    }

    #[test]
    fn roth_conversion_principal_seasons_after_five_tax_years() {
        let state = RothBasisState {
            enabled: true,
            regular_principal: 100.0,
            conversion_lots: vec![RothConversionLot {
                conversion_year: 2026,
                remaining_principal: 1_000.0,
            }],
            unseasoned_principal: 1_000.0,
        };

        let mut early = state.clone();
        let early_penalty = roth_conversion_penalty_for(200.0, &early, 54);
        consume_roth_basis(200.0, &mut early);
        assert_eq!(early_penalty, 10.0);
        assert_eq!(early.regular_principal, 0.0);
        assert_eq!(early.conversion_lots[0].remaining_principal, 900.0);
        assert_eq!(early.unseasoned_principal, 900.0);

        let mut seasoned = state;
        season_roth_conversions(&mut seasoned, 2031);
        let seasoned_penalty = roth_conversion_penalty_for(200.0, &seasoned, 55);
        consume_roth_basis(200.0, &mut seasoned);
        assert_eq!(seasoned_penalty, 0.0);
        assert!(seasoned.conversion_lots.is_empty());
        assert_eq!(seasoned.regular_principal, 900.0);
        assert_eq!(seasoned.unseasoned_principal, 0.0);
    }

    #[test]
    fn early_ladder_penalizes_unseasoned_but_not_seasoned_conversion_principal() {
        let result = project_scenario(&early_ladder_plan(), conversion_config()).unwrap();
        let early = result
            .projections
            .iter()
            .find(|year| year.year == 2028)
            .unwrap();
        let seasoned = result
            .projections
            .iter()
            .find(|year| year.year == 2031)
            .unwrap();

        assert!(early.age < TRADITIONAL_PENALTY_AGE);
        assert_eq!(early.withdrawal_traditional, 0.0);
        assert!(early.withdrawal_roth > 0.0);
        assert!((early.taxes - early.withdrawal_roth * 0.10).abs() < 0.000001);

        assert!(seasoned.age < TRADITIONAL_PENALTY_AGE);
        assert!(seasoned.withdrawal_roth > 0.0);
        assert_eq!(seasoned.taxes, 0.0);
    }

    #[test]
    fn after_tax_terminal_wealth_discounts_the_pre_tax_balance() {
        let result = project_scenario(
            &conversion_plan(RothConversionPolicy::default()),
            conversion_config(),
        )
        .unwrap();
        assert!(result.after_tax_terminal_wealth < result.terminal_wealth);
        assert!(result.after_tax_terminal_wealth > result.terminal_wealth * 0.69);
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

    fn penalized_shortfall_plan(account_type: AccountType) -> RetirementPlan {
        let mut plan = test_plan();
        plan.profile.birth_date = "1986-01-01".to_string();
        plan.profile.state = State::TX;
        plan.profile.retirement_age = 60;
        plan.profile.life_expectancy = 61;
        plan.profile.current_salary = 50_000.0;
        plan.profile.salary_growth_rate = 0.0;
        plan.profile.current_spending = 120_000.0;
        plan.profile.working_spending_growth_rate = 0.0;
        plan.profile.as_of_date = "2026-01-01".to_string();
        plan.social_security.enabled = false;
        plan.accounts = vec![Account {
            account_type,
            balance: 5_000_000.0,
            asset_weights: AssetWeights {
                stocks: 0.6,
                bonds: 0.4,
            },
            is_surplus_cash: false,
        }];
        plan
    }

    fn rmd_plan(age: u32, traditional_balance: f64, retirement_spending: f64) -> RetirementPlan {
        let mut plan = test_plan();
        plan.profile.birth_date = format!("{}-01-01", 2025 - age);
        plan.profile.as_of_date = "2025-01-01".to_string();
        plan.profile.state = State::CA;
        plan.profile.retirement_age = age - 1;
        plan.profile.life_expectancy = age + 20;
        plan.profile.current_salary = 0.0;
        plan.profile.current_spending = retirement_spending;
        plan.profile.retirement_spending = retirement_spending;
        plan.profile.retirement_spending_growth_rate = 0.0;
        plan.social_security.enabled = false;
        plan.accounts = vec![
            account(AccountType::Traditional, traditional_balance),
            account(AccountType::Taxable, 100_000.0),
        ];
        plan
    }

    #[test]
    fn early_traditional_and_hsa_shortfalls_are_grossed_up_for_the_penalty_once() {
        let config = ProjectionConfig {
            seed: 5,
            use_historical_bootstrap: true,
            block_size: 3,
        };

        for (account_type, penalty_rate) in
            [(AccountType::Traditional, 0.10), (AccountType::Hsa, 0.20)]
        {
            let result = project_scenario(&penalized_shortfall_plan(account_type), config.clone())
                .expect("projection succeeds");
            let year = &result.projections[1];
            let drawn = match account_type {
                AccountType::Traditional => year.withdrawal_traditional,
                AccountType::Hsa => year.withdrawal_hsa,
                _ => unreachable!(),
            };

            assert!(!year.is_retired);
            assert!(!year.insufficient_funds);
            assert!(year.spending > 120_000.0 - SHORTFALL_TOLERANCE);
            assert!(year.spending <= 120_000.0);
            assert!(drawn > 0.0);
            assert!(year.taxes > drawn * penalty_rate);
            assert!((year.income + drawn - year.taxes - year.spending).abs() < 1e-6);
        }
    }

    #[test]
    fn rmd_is_taken_when_social_security_already_covers_spending() {
        let mut plan = rmd_plan(75, 1_000_000.0, 20_000.0);
        plan.social_security.enabled = true;
        plan.social_security.manual_override = true;
        plan.social_security.claim_age = 67;
        plan.social_security.estimated_benefit = Some(50_000.0);

        let result = project_scenario(&plan, conversion_config()).expect("projection succeeds");
        let first_year = &result.projections[0];

        assert_eq!(first_year.social_security_benefit, 50_000.0);
        assert!((first_year.withdrawal_traditional - first_year.rmd_amount).abs() < 1e-6);
        assert!(first_year.deposit_taxable > 0.0);
    }

    #[test]
    fn spending_above_the_rmd_never_reduces_the_required_withdrawal() {
        let plan = rmd_plan(73, 800_000.0, 50_000.0);
        let result = project_scenario(&plan, conversion_config()).expect("projection succeeds");
        let first_year = &result.projections[0];

        assert!(first_year.spending > first_year.rmd_amount);
        assert!(first_year.withdrawal_traditional + 1.0 >= first_year.rmd_amount);
        assert_eq!(first_year.deposit_taxable, 0.0);
    }

    #[test]
    fn every_multiyear_required_distribution_is_fully_withdrawn() {
        let plan = rmd_plan(73, 1_000_000.0, 25_000.0);
        let result = project_scenario(&plan, conversion_config()).expect("projection succeeds");

        for year in result.projections.iter().take(3) {
            assert!(year.rmd_amount > 0.0);
            assert!(
                year.withdrawal_traditional + 0.001 >= year.rmd_amount,
                "age {} withdrew {} against an RMD of {}",
                year.age,
                year.withdrawal_traditional,
                year.rmd_amount,
            );
        }
    }

    /// A plan retiring twenty years out prices healthcare at what its entered
    /// figures grow to, while a request from a bundle that predates the change
    /// still gets the old first-retirement-year exponent.
    #[test]
    fn healthcare_growth_runs_from_the_as_of_date_unless_the_request_is_older() {
        let mut plan = test_plan();
        plan.profile.birth_date = "1991-01-01".to_string();
        plan.profile.retirement_age = 55;
        plan.profile.life_expectancy = 57;
        plan.profile.retirement_spending_growth_rate = 0.0;
        plan.profile.retirement_healthcare = RetirementHealthcare {
            pre_medicare_premium: 15_900.0,
            medicare_premium: 4_650.0,
            out_of_pocket: 3_000.0,
            real_growth_rate: 0.02,
        };
        plan.accounts = vec![Account {
            account_type: AccountType::Taxable,
            balance: 5_000_000.0,
            asset_weights: AssetWeights {
                stocks: 0.0,
                bonds: 1.0,
            },
            is_surplus_cash: false,
        }];

        let healthcare_in_first_retired_year = |plan: &RetirementPlan| {
            let config = ProjectionConfig {
                seed: 7,
                use_historical_bootstrap: true,
                block_size: 3,
            };
            let result = project_scenario(plan, config).expect("projection succeeds");
            let first = result
                .projections
                .iter()
                .find(|p| p.is_retired)
                .expect("a retirement year");
            first.spending - plan.profile.retirement_spending
        };

        let current = healthcare_in_first_retired_year(&plan);
        assert!((current - 18_900.0 * 1.02_f64.powi(20)).abs() < 0.01);

        let mut legacy = plan.clone();
        legacy.schema_version = HEALTHCARE_MODEL_SCHEMA_VERSION - 1;
        let old = healthcare_in_first_retired_year(&legacy);
        assert!((old - 18_900.0).abs() < 0.01);
    }

    #[test]
    fn healthcare_is_capped_on_each_underfunded_path_before_aggregation() {
        let mut plan = test_plan();
        plan.profile.birth_date = "1955-01-01".to_string();
        plan.profile.retirement_age = 65;
        plan.profile.life_expectancy = 70;
        plan.profile.retirement_spending = 40_000.0;
        plan.profile.retirement_spending_growth_rate = 0.0;
        plan.profile.retirement_healthcare = RetirementHealthcare {
            pre_medicare_premium: 20_000.0,
            medicare_premium: 10_000.0,
            out_of_pocket: 5_000.0,
            real_growth_rate: 0.0,
        };
        plan.profile.as_of_date = "2025-01-01".to_string();
        plan.accounts.clear();
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
        let year = &result.projections[0];
        assert!(year.insufficient_funds);
        assert_eq!(year.spending, 0.0);
        assert_eq!(year.healthcare_cost, 0.0);
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
        let working: Vec<_> = result
            .projections
            .iter()
            .filter(|p| !p.is_retired)
            .collect();

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

    fn real_historical_returns(index: usize) -> (f64, f64) {
        let year = &historical_data::HISTORICAL_RETURNS[index];
        (
            (1.0 + year.stock_return) / (1.0 + year.inflation_rate) - 1.0,
            (1.0 + year.bond_return) / (1.0 + year.inflation_rate) - 1.0,
        )
    }

    #[test]
    fn block_bootstrap_is_deterministic_and_preserves_wrapped_history() {
        let history_len = historical_data::HISTORICAL_RETURNS.len();
        let block_size = 5;
        let (seed, start_index) = (0_u64..10_000)
            .find_map(|seed| {
                let generator = BlockBootstrapGenerator::new(seed, block_size);
                let first = generator.current_block[0];
                let start =
                    (0..history_len).find(|index| real_historical_returns(*index) == first)?;
                (start + block_size > history_len).then_some((seed, start))
            })
            .expect("a seed should select a block that wraps the dataset");

        let mut first = BlockBootstrapGenerator::new(seed, block_size);
        let mut second = BlockBootstrapGenerator::new(seed, block_size);
        for offset in 0..block_size {
            let expected = real_historical_returns((start_index + offset) % history_len);
            assert_eq!(first.next(), expected);
            assert_eq!(second.next(), expected);
        }

        let next_block_first_return = first.next();
        assert_eq!(next_block_first_return, first.current_block[0]);
        assert_eq!(first.block_index, 1);
        assert_eq!(second.next(), next_block_first_return);
    }

    #[test]
    fn return_generator_factory_selects_the_plan_model() {
        let config = ProjectionConfig {
            seed: 42,
            use_historical_bootstrap: true,
            block_size: 5,
        };
        let mut historical_plan = test_plan();
        historical_plan.assumptions.simulation_model = SimulationModel::Historical;
        let mut historical = create_market_returns_generator(&historical_plan, &config);
        let mut expected_historical = BlockBootstrapGenerator::new(config.seed, config.block_size);
        assert_eq!(historical.next(), expected_historical.next());

        let mut parametric_plan = historical_plan;
        parametric_plan.assumptions.simulation_model = SimulationModel::Parametric;
        let mut parametric = create_market_returns_generator(&parametric_plan, &config);
        let mut expected_parametric = ParametricReturnsGenerator::new(config.seed);
        assert_eq!(parametric.next(), expected_parametric.next());
    }

    #[test]
    fn account_order_does_not_change_deposit_routing_or_projection() {
        let plan = test_plan();
        let mut reversed = plan.clone();
        reversed.accounts.reverse();
        let config = ProjectionConfig {
            seed: 42,
            use_historical_bootstrap: true,
            block_size: 5,
        };

        let first = project_scenario(&plan, config.clone()).unwrap();
        let second = project_scenario(&reversed, config).unwrap();
        assert_eq!(
            serde_json::to_value(first).unwrap(),
            serde_json::to_value(second).unwrap()
        );
    }

    #[test]
    fn summary_matches_full_projection_exactly() {
        let mut high_spending = test_plan();
        high_spending.profile.retirement_spending = 250_000.0;
        let mut no_social_security = test_plan();
        no_social_security.social_security.enabled = false;
        let mut historical = test_plan();
        historical.assumptions.simulation_model = SimulationModel::Historical;

        for plan in [test_plan(), high_spending, no_social_security, historical] {
            for use_historical_bootstrap in [false, true] {
                for seed in [0, 42, 999_999] {
                    let config = ProjectionConfig {
                        seed,
                        use_historical_bootstrap,
                        block_size: 3,
                    };
                    let full = project_scenario(&plan, config.clone()).unwrap();
                    let summary = project_scenario_summary(&plan, config).unwrap();
                    assert_eq!(summary.success, full.success);
                    assert_eq!(summary.terminal_wealth, full.terminal_wealth);
                }
            }
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
            "retirement-year income must not be zeroed out"
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

    /// The gate is the version that introduced phase-based spending, not the
    /// current one, so bumping the schema for an unrelated reason must not send
    /// a still-deployed bundle back to the pre-phase math.
    #[test]
    fn phase_spending_applies_to_every_version_from_its_own() {
        let mut plan = test_plan();
        plan.schema_version = PHASE_SPENDING_SCHEMA_VERSION;
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
        // Working spending compounds, and retirement growth starts at retirement.
        assert!((result.projections[0].spending - 40_000.0).abs() < 1e-6);
        assert!((result.projections[1].spending - 44_000.0).abs() < 1e-6);
        assert!((result.projections[2].spending - 70_000.0).abs() < 1e-6);
    }

    #[test]
    fn legacy_schema_preserves_original_spending_math() {
        let mut plan = test_plan();
        plan.schema_version = 0;
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

    /// The fixture with the care model on, which is the product default. Cost
    /// figures below are the 2020 table rebased by the CPI series alone: the
    /// fixture's healthcare growth rate is zero, so the cohort adjustment is 1.
    fn long_term_care_plan() -> RetirementPlan {
        let mut plan = test_plan();
        plan.profile.long_term_care.enabled = true;
        plan
    }

    fn long_term_care_config(seed: u64) -> ProjectionConfig {
        ProjectionConfig {
            seed,
            use_historical_bootstrap: false,
            block_size: 5,
        }
    }

    /// A seed whose long-term care uniform, 0.976, lands in the tail of every
    /// quintile, so a path built on it always has an expensive episode.
    const EPISODE_SEED: u64 = 16;

    /// A seed whose uniform, 0.170, sits under every quintile's no-spending
    /// mass, so a path built on it never has an episode.
    const NO_EPISODE_SEED: u64 = 3;

    fn final_year(result: &PathResult) -> &PathProjection {
        result.projections.last().expect("a modeled year")
    }

    fn yearly_fingerprint(result: &PathResult) -> Vec<(f64, f64, f64, f64)> {
        result
            .projections
            .iter()
            .map(|year| {
                (
                    year.portfolio_value,
                    year.spending,
                    year.taxes,
                    year.healthcare_cost,
                )
            })
            .collect()
    }

    /// The care draw runs on its own stream, so turning the model on must not
    /// move a single market return. Every year but the charged one is identical
    /// down to the bit.
    #[test]
    fn long_term_care_does_not_disturb_the_market_draw() {
        let config = long_term_care_config(EPISODE_SEED);
        let mut disabled = long_term_care_plan();
        disabled.profile.long_term_care.enabled = false;

        let with_care = project_scenario(&long_term_care_plan(), config.clone()).unwrap();
        let without_care = project_scenario(&disabled, config).unwrap();

        let with_care_years = yearly_fingerprint(&with_care);
        let without_care_years = yearly_fingerprint(&without_care);
        let last = with_care_years.len() - 1;
        assert_eq!(with_care_years[..last], without_care_years[..last]);
        assert!(final_year(&with_care).healthcare_cost > 0.0);
        assert_eq!(final_year(&without_care).healthcare_cost, 0.0);
    }

    /// The gate is the version that introduced the model, so a bundle built
    /// before it keeps the projection it asked for even though the field it
    /// deserializes into defaults to on.
    #[test]
    fn a_plan_older_than_the_model_version_is_charged_no_care() {
        let mut plan = long_term_care_plan();
        plan.schema_version = LTC_MODEL_SCHEMA_VERSION - 1;

        let result = project_scenario(&plan, long_term_care_config(EPISODE_SEED)).unwrap();

        assert!(plan.profile.long_term_care.enabled);
        assert_eq!(final_year(&result).healthcare_cost, 0.0);
    }

    /// The episode is one lifetime bill, charged whole in the last modeled year
    /// and in no other.
    #[test]
    fn the_episode_is_charged_only_in_the_final_year() {
        let result =
            project_scenario(&long_term_care_plan(), long_term_care_config(EPISODE_SEED)).unwrap();

        let (last, earlier) = result.projections.split_last().expect("a modeled year");
        assert!(last.healthcare_cost > 100_000.0);
        assert!(earlier.iter().all(|year| year.healthcare_cost == 0.0));
    }

    /// A uniform under the quintile's no-spending mass is no episode at all,
    /// not a small one.
    #[test]
    fn a_path_below_the_no_spending_mass_is_charged_nothing() {
        let result = project_scenario(
            &long_term_care_plan(),
            long_term_care_config(NO_EPISODE_SEED),
        )
        .unwrap();

        assert_eq!(final_year(&result).healthcare_cost, 0.0);
    }

    /// The reported field is capped at the year's spending, because outcome
    /// cohorts average it, so linearity is only visible on a portfolio that can
    /// fund the larger bill.
    #[test]
    fn the_cost_multiplier_scales_the_charge_linearly() {
        let config = long_term_care_config(EPISODE_SEED);
        let mut single_multiplier = long_term_care_plan();
        single_multiplier.accounts[0].balance = 10_000_000.0;
        let mut doubled = single_multiplier.clone();
        doubled.profile.long_term_care.cost_multiplier = 2.0;

        let single = project_scenario(&single_multiplier, config.clone()).unwrap();
        let double = project_scenario(&doubled, config).unwrap();

        let charged = final_year(&single).healthcare_cost;
        assert!(charged > 0.0);
        assert!((final_year(&double).healthcare_cost - 2.0 * charged).abs() < 1e-6);
    }

    /// The bill is spending as well as a healthcare line, so the year has to
    /// fund it out of the portfolio like any other dollar.
    #[test]
    fn the_episode_raises_the_final_year_spending_target() {
        let config = long_term_care_config(EPISODE_SEED);
        let mut disabled = long_term_care_plan();
        disabled.profile.long_term_care.enabled = false;

        let with_care = project_scenario(&long_term_care_plan(), config.clone()).unwrap();
        let without_care = project_scenario(&disabled, config).unwrap();

        let charged = final_year(&with_care).healthcare_cost;
        let extra_spending = final_year(&with_care).spending - final_year(&without_care).spending;
        assert!((extra_spending - charged).abs() < 1e-6);
        assert!(with_care.terminal_wealth < without_care.terminal_wealth);
    }

    /// Care services are deductible medical expenses under IRC 213(d), so the
    /// HSA allowance grows by the bill and the draw that pays it is tax-free.
    /// Without that credit the same distribution would be ordinary income.
    #[test]
    fn the_episode_is_a_qualified_hsa_expense() {
        let mut plan = long_term_care_plan();
        plan.profile.birth_date = "1954-01-01".to_string();
        plan.profile.life_expectancy = 74;
        plan.profile.retirement_spending = 0.0;
        plan.social_security.enabled = false;
        plan.accounts = vec![Account {
            account_type: AccountType::Hsa,
            balance: 3_000_000.0,
            asset_weights: AssetWeights {
                stocks: 0.6,
                bonds: 0.4,
            },
            is_surplus_cash: false,
        }];

        let result = project_scenario(&plan, long_term_care_config(EPISODE_SEED)).unwrap();

        let last = final_year(&result);
        assert!(last.withdrawal_hsa > 100_000.0);
        assert_eq!(last.taxes, 0.0);
        assert!(!last.insufficient_funds);
    }

    #[test]
    fn remaining_care_exposure_is_full_through_65_and_tapers_afterward() {
        assert_eq!(remaining_ltc_exposure(55, 90), 1.0);
        assert_eq!(remaining_ltc_exposure(65, 90), 1.0);
        assert_eq!(remaining_ltc_exposure(75, 90), 0.6);
        assert_eq!(remaining_ltc_exposure(85, 90), 0.2);
        assert_eq!(remaining_ltc_exposure(90, 90), 0.0);
    }

    /// The same episode and income quintile should cost only the share of the
    /// age-65 lifetime horizon that remains when a plan starts later.
    #[test]
    fn a_plan_that_starts_after_65_prices_only_remaining_care_exposure() {
        let config = long_term_care_config(EPISODE_SEED);
        let mut age_65 = long_term_care_plan();
        age_65.profile.birth_date = "1961-01-01".to_string();
        age_65.profile.life_expectancy = 90;
        age_65.profile.retirement_spending = 0.0;
        age_65.social_security.enabled = false;
        age_65.accounts = vec![Account {
            account_type: AccountType::Taxable,
            balance: 10_000_000.0,
            asset_weights: AssetWeights {
                stocks: 0.6,
                bonds: 0.4,
            },
            is_surplus_cash: false,
        }];
        let mut age_75 = age_65.clone();
        age_75.profile.birth_date = "1951-01-01".to_string();

        let full_cost =
            final_year(&project_scenario(&age_65, config.clone()).unwrap()).healthcare_cost;
        let remaining_cost =
            final_year(&project_scenario(&age_75, config).unwrap()).healthcare_cost;

        assert!(full_cost > 0.0);
        assert!((remaining_cost - full_cost * 0.6).abs() < 1e-6);
    }

    /// A household already past 65 has no age-65 year to read, so the first
    /// modeled year stands in for one. The fallback has to select a quintile
    /// rather than panic or silently price no care.
    #[test]
    fn a_plan_that_starts_after_65_falls_back_to_its_first_year() {
        let mut plan = long_term_care_plan();
        plan.profile.birth_date = "1950-01-01".to_string();
        plan.profile.life_expectancy = 88;

        let result = project_scenario(&plan, long_term_care_config(EPISODE_SEED)).unwrap();

        assert_eq!(result.projections[0].age, 76);
        assert!(final_year(&result).healthcare_cost > 0.0);
    }

    /// The quintile is resolved from the path's own income at 65, so the same
    /// uniform buys a bigger episode for a household with more of it.
    #[test]
    fn a_richer_path_draws_from_a_higher_quintile() {
        let config = long_term_care_config(EPISODE_SEED);
        let mut modest = long_term_care_plan();
        modest.accounts = vec![Account {
            account_type: AccountType::Taxable,
            balance: 120_000.0,
            asset_weights: AssetWeights {
                stocks: 0.6,
                bonds: 0.4,
            },
            is_surplus_cash: false,
        }];
        let mut wealthy = modest.clone();
        wealthy.accounts[0].balance = 6_000_000.0;

        let modest_cost = project_scenario(&modest, config.clone())
            .unwrap()
            .projections
            .last()
            .unwrap()
            .healthcare_cost;
        let wealthy_cost = final_year(&project_scenario(&wealthy, config).unwrap()).healthcare_cost;

        assert!(modest_cost > 0.0);
        assert!(wealthy_cost > modest_cost);
    }

    /// A horizon that ends at 65 has no post-65 exposure for a lifetime-from-65
    /// distribution to price.
    #[test]
    fn a_plan_that_ends_at_65_is_charged_no_care() {
        let mut plan = long_term_care_plan();
        plan.profile.birth_date = "1964-01-01".to_string();
        plan.profile.retirement_age = 62;
        plan.profile.life_expectancy = 65;

        let result = project_scenario(&plan, long_term_care_config(EPISODE_SEED)).unwrap();

        assert_eq!(final_year(&result).age, 65);
        assert_eq!(final_year(&result).healthcare_cost, 0.0);
    }

    /// Paths are seeded `base_seed + path_index`, so the share of them with no
    /// episode is what the model's no-spending mass actually ships as. This
    /// plan sits in the highest quintile, whose ASPE row puts it at 58.5%.
    #[test]
    fn the_share_of_paths_without_an_episode_matches_the_published_rate() {
        let mut plan = long_term_care_plan();
        plan.accounts = vec![Account {
            account_type: AccountType::Taxable,
            balance: 6_000_000.0,
            asset_weights: AssetWeights {
                stocks: 0.6,
                bonds: 0.4,
            },
            is_surplus_cash: false,
        }];

        let paths = 2_000;
        let without_episode = (0..paths)
            .filter(|path_index| {
                let result =
                    project_scenario(&plan, long_term_care_config(42 + path_index)).unwrap();
                final_year(&result).healthcare_cost == 0.0
            })
            .count();

        let share = without_episode as f64 / paths as f64;
        assert!(
            (share - 0.585).abs() < 0.03,
            "share without an episode was {share}, expected about 0.585"
        );
    }

    /// The 2020 table is rebased through the CPI-U series the market history
    /// already carries, not through a second inflation figure kept beside it.
    #[test]
    fn the_price_rebasing_compounds_the_published_cpi_series() {
        let published: f64 = historical_data::HISTORICAL_RETURNS
            .iter()
            .filter(|entry| (2021..=2025).contains(&entry.year))
            .map(|entry| 1.0 + entry.inflation_rate)
            .product();

        assert_eq!(price_level_ratio(2020, 2025), published);
        // The series stops at its last published year, so a later base year
        // rebases to that year instead of to an invented rate.
        assert_eq!(price_level_ratio(2020, 2030), published);
        assert!((price_level_ratio(2025, 2020) - 1.0 / published).abs() < 1e-12);
        assert_eq!(price_level_ratio(2020, 2020), 1.0);
    }

    /// Real growth above inflation is a cohort adjustment: ASPE's total is a
    /// whole life's spending priced for the cohort turning 65 in 2021-2025, so
    /// it compounds between that cohort's 65th birthday and this one's, and not
    /// again over the horizon.
    #[test]
    fn healthcare_real_growth_compounds_only_between_cohorts() {
        let config = long_term_care_config(EPISODE_SEED);
        let mut flat = long_term_care_plan();
        flat.profile.retirement_healthcare.real_growth_rate = 0.0;
        let mut growing = flat.clone();
        growing.profile.retirement_healthcare.real_growth_rate = 0.02;

        let flat_cost =
            final_year(&project_scenario(&flat, config.clone()).unwrap()).healthcare_cost;
        let growing_cost = final_year(&project_scenario(&growing, config).unwrap()).healthcare_cost;

        // Born 1962, so 65 arrives in 2027, four years past the 2023 anchor.
        assert!((growing_cost - flat_cost * 1.02_f64.powi(4)).abs() < 1e-6);
    }
}
