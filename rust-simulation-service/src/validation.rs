use crate::simulation::age::age_on;
use crate::types::{
    BatchSimulationRequest, RetirementPlan, SimulationRequest, PLAN_SCHEMA_VERSION,
};

pub const MAX_PATHS: u32 = 5_000;
pub const MAX_BATCH_SIMULATIONS: usize = 40;
pub const MAX_BATCH_PATHS: u32 = 40_000;

pub fn validate_simulation_request(request: &SimulationRequest) -> Result<(), String> {
    validate_config(request.config.paths, request.config.block_size)?;
    validate_plan(&request.plan)
}

pub fn validate_batch_simulations(simulations: &[BatchSimulationRequest]) -> Result<u32, String> {
    if simulations.is_empty() || simulations.len() > MAX_BATCH_SIMULATIONS {
        return Err(format!(
            "Batch must contain 1 to {MAX_BATCH_SIMULATIONS} simulations"
        ));
    }
    let mut total_paths = 0_u32;
    for simulation in simulations {
        if simulation.id.is_empty() || simulation.id.len() > 64 {
            return Err("Simulation id must contain 1 to 64 characters".into());
        }
        validate_config(simulation.config.paths, simulation.config.block_size)
            .map_err(|message| format!("Simulation '{}': {message}", simulation.id))?;
        validate_plan(&simulation.plan)
            .map_err(|message| format!("Simulation '{}': {message}", simulation.id))?;
        total_paths = total_paths
            .checked_add(simulation.config.paths)
            .ok_or_else(|| "Batch path count overflowed".to_string())?;
    }
    if total_paths > MAX_BATCH_PATHS {
        return Err(format!(
            "Batch may not exceed {MAX_BATCH_PATHS} total paths"
        ));
    }
    Ok(total_paths)
}

pub fn validate_config(paths: u32, block_size: usize) -> Result<(), String> {
    if paths == 0 || paths > MAX_PATHS {
        return Err(format!("paths must be between 1 and {MAX_PATHS}"));
    }
    if !(1..=10).contains(&block_size) {
        return Err("blockSize must be between 1 and 10".into());
    }
    Ok(())
}

pub fn validate_plan(plan: &RetirementPlan) -> Result<(), String> {
    if plan.schema_version > PLAN_SCHEMA_VERSION {
        return Err(format!(
            "schemaVersion {} is newer than supported version {PLAN_SCHEMA_VERSION}",
            plan.schema_version
        ));
    }
    let profile = &plan.profile;
    if profile.retirement_age < 45 || profile.retirement_age > 100 {
        return Err("retirementAge must be between 45 and 100".into());
    }
    let Ok(as_of_date) = chrono::NaiveDate::parse_from_str(&profile.as_of_date, "%Y-%m-%d") else {
        return Err("asOfDate must use YYYY-MM-DD".into());
    };
    if !(1900..=2200).contains(&chrono::Datelike::year(&as_of_date)) {
        return Err("asOfDate year must be between 1900 and 2200".into());
    }
    let Ok(age) = age_on(&profile.birth_date, &profile.as_of_date) else {
        return Err("birthDate must use YYYY-MM-DD and precede asOfDate".into());
    };
    if !(18..=100).contains(&age) {
        return Err("age at asOfDate must be between 18 and 100".into());
    }
    if profile.life_expectancy <= profile.retirement_age
        || profile.life_expectancy <= age
        || profile.life_expectancy > 120
    {
        return Err(
            "lifeExpectancy must be after current and retirement ages and no greater than 120"
                .into(),
        );
    }
    let finite_profile_values = [
        profile.current_salary,
        profile.salary_growth_rate,
        profile.current_spending,
        profile.working_spending_growth_rate,
        profile.retirement_spending,
        profile.retirement_spending_growth_rate,
    ];
    if !finite_profile_values.iter().all(|value| value.is_finite())
        || profile.current_salary < 0.0
        || profile.current_salary > 1_000_000_000.0
        || profile.current_spending < 0.0
        || profile.current_spending > 1_000_000_000.0
        || profile.retirement_spending < 0.0
        || profile.retirement_spending > 1_000_000_000.0
        || !(-0.1..=0.2).contains(&profile.salary_growth_rate)
        || !(-0.1..=0.1).contains(&profile.working_spending_growth_rate)
        || !(-0.1..=0.1).contains(&profile.retirement_spending_growth_rate)
    {
        return Err(
            "profile amounts and rates must be finite and nonnegative where applicable".into(),
        );
    }
    let healthcare = &profile.retirement_healthcare;
    let healthcare_values = [
        healthcare.pre_medicare_premium,
        healthcare.medicare_premium,
        healthcare.out_of_pocket,
        healthcare.real_growth_rate,
    ];
    if !healthcare_values.iter().all(|value| value.is_finite())
        || healthcare.pre_medicare_premium < 0.0
        || healthcare.medicare_premium < 0.0
        || healthcare.out_of_pocket < 0.0
        || !(-0.1..=0.2).contains(&healthcare.real_growth_rate)
    {
        return Err("retirementHealthcare contains invalid amounts or growth".into());
    }
    let long_term_care = &profile.long_term_care;
    if !long_term_care.cost_multiplier.is_finite()
        || !(0.5..=3.0).contains(&long_term_care.cost_multiplier)
    {
        return Err("longTermCare.costMultiplier must be between 0.5 and 3".into());
    }
    if !(62..=70).contains(&plan.social_security.claim_age) {
        return Err("claimAge must be between 62 and 70".into());
    }
    if let Some(benefit) = plan.social_security.estimated_benefit {
        if !benefit.is_finite() || !(0.0..=10_000_000.0).contains(&benefit) {
            return Err("estimatedBenefit must be finite and between 0 and 10000000".into());
        }
    }
    if plan.accounts.len() > 20 {
        return Err("plan may contain at most 20 accounts".into());
    }
    if !plan.assumptions.taxable_gain_ratio.is_finite()
        || !(0.0..=1.0).contains(&plan.assumptions.taxable_gain_ratio)
    {
        return Err("taxableGainRatio must be between 0 and 1".into());
    }
    if !plan.assumptions.terminal_tax_rate.is_finite()
        || !(0.0..=1.0).contains(&plan.assumptions.terminal_tax_rate)
    {
        return Err("terminalTaxRate must be between 0 and 1".into());
    }
    for (index, account) in plan.accounts.iter().enumerate() {
        let weights = &account.asset_weights;
        if !account.balance.is_finite()
            || account.balance < 0.0
            || account.balance > 1_000_000_000_000_000.0
            || !weights.stocks.is_finite()
            || !weights.bonds.is_finite()
            || !(0.0..=1.0).contains(&weights.stocks)
            || !(0.0..=1.0).contains(&weights.bonds)
            || (weights.stocks + weights.bonds - 1.0).abs() > 0.001
        {
            return Err(format!(
                "account {} has invalid balance or allocation",
                index + 1
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_plan;
    use crate::types::RetirementPlan;

    fn plan_with_long_term_care(long_term_care: Option<serde_json::Value>) -> RetirementPlan {
        let mut profile = serde_json::json!({
            "birthDate": "1986-01-01",
            "state": "CA",
            "filingStatus": "Single",
            "retirementAge": 65,
            "currentSalary": 100000.0,
            "salaryGrowthRate": 0.01,
            "currentSpending": 60000.0,
            "retirementSpending": 60000.0,
            "retirementSpendingGrowthRate": 0.0,
            "lifeExpectancy": 90,
            "asOfDate": "2026-01-01"
        });
        if let Some(long_term_care) = long_term_care {
            profile["longTermCare"] = long_term_care;
        }
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 7,
            "profile": profile,
            "accounts": [],
            "socialSecurity": {
                "enabled": true,
                "estimatedBenefit": null,
                "claimAge": 67,
                "manualOverride": false
            },
            "assumptions": {
                "simulationModel": "historical",
                "taxableGainRatio": 0.5,
                "hsaEligible": false,
                "useBackdoorRoth": false
            }
        }))
        .unwrap()
    }

    #[test]
    fn plan_without_long_term_care_validates_with_the_model_on() {
        let plan = plan_with_long_term_care(None);

        assert!(plan.profile.long_term_care.enabled);
        assert_eq!(plan.profile.long_term_care.cost_multiplier, 1.0);
        assert!(validate_plan(&plan).is_ok());
    }

    #[test]
    fn long_term_care_multiplier_outside_the_range_is_rejected() {
        for multiplier in [0.4, 3.1] {
            let plan = plan_with_long_term_care(Some(serde_json::json!({
                "enabled": true,
                "costMultiplier": multiplier
            })));

            assert!(validate_plan(&plan).is_err());
        }

        let mut not_a_number = plan_with_long_term_care(None);
        not_a_number.profile.long_term_care.cost_multiplier = f64::NAN;

        assert!(validate_plan(&not_a_number).is_err());
    }
}
