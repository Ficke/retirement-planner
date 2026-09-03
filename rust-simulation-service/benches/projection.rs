//! Per-path cost of the sweep kernel.
//!
//! `project_scenario_summary` is called once per path per scenario — roughly
//! 31,000 times for one plan refresh — so anything it repeats that depends only
//! on the plan is multiplied by that. The plan is built from wire JSON so the
//! benchmark exercises the same shape the service receives.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use retirement_simulation::simulation::projection::{
    project_scenario_summary, project_scenario_summary_prepared, PreparedPlan, ProjectionConfig,
};
use retirement_simulation::types::RetirementPlan;

const PLAN_JSON: &str = r#"{
  "schemaVersion": 7,
  "profile": {
    "birthDate": "1991-01-01", "state": "CA", "filingStatus": "Single",
    "retirementAge": 65, "currentSalary": 100000, "salaryGrowthRate": 0.01,
    "currentSpending": 50000, "workingSpendingGrowthRate": 0,
    "retirementSpending": 50000, "retirementSpendingMultiplier": 1,
    "retirementSpendingGrowthRate": 0, "lifeExpectancy": 90,
    "retirementHealthcare": {"preMedicarePremium": 0, "medicarePremium": 0, "outOfPocket": 0, "realGrowthRate": 0},
    "longTermCare": {"enabled": true, "costMultiplier": 1},
    "asOfDate": "2026-01-01"
  },
  "accounts": [{"type": "Taxable", "balance": 100000, "assetWeights": {"stocks": 0.6, "bonds": 0.4}}],
  "socialSecurity": {"enabled": true, "claimAge": 67, "manualOverride": false},
  "assumptions": {
    "simulationModel": "historical", "randomSeed": 42, "taxableGainRatio": 0.5,
    "hsaEligible": false, "useBackdoorRoth": false,
    "rothConversion": {"enabled": false, "ceiling": "bracket24"}, "terminalTaxRate": 0.3
  }
}"#;

fn config_for(path_index: u64) -> ProjectionConfig {
    ProjectionConfig {
        seed: 42_u64.wrapping_add(path_index),
        use_historical_bootstrap: true,
        block_size: 5,
    }
}

fn benchmark(c: &mut Criterion) {
    let plan: RetirementPlan = serde_json::from_str(PLAN_JSON).expect("plan fixture parses");

    c.bench_function("project_scenario_summary/one_path", |b| {
        let mut path_index = 0_u64;
        b.iter(|| {
            path_index = path_index.wrapping_add(1);
            black_box(project_scenario_summary(
                black_box(&plan),
                config_for(path_index),
            ))
        })
    });

    // One scenario's share of a sweep, so a change reads directly against the
    // 1,000-path unit the sweep actually dispatches. The pair measures the
    // per-path plan derivation the sweep kernel hoists out of its loop.
    c.bench_function("sweep/1000_paths_prepare_per_path", |b| {
        b.iter(|| {
            for path_index in 0..1000_u64 {
                black_box(project_scenario_summary(
                    black_box(&plan),
                    config_for(path_index),
                ))
                .ok();
            }
        })
    });

    c.bench_function("sweep/1000_paths_prepared_once", |b| {
        b.iter(|| {
            let prepared = PreparedPlan::new(black_box(&plan)).expect("plan prepares");
            for path_index in 0..1000_u64 {
                black_box(project_scenario_summary_prepared(
                    &prepared,
                    config_for(path_index),
                ))
                .ok();
            }
        })
    });
}

/// Which subsystem the per-year cost sits in. Each variant differs from the
/// baseline plan by one toggle, so the delta is that subsystem's share.
fn subsystems(c: &mut Criterion) {
    let base: serde_json::Value = serde_json::from_str(PLAN_JSON).expect("fixture parses");

    let variant = |mutate: &dyn Fn(&mut serde_json::Value)| -> RetirementPlan {
        let mut value = base.clone();
        mutate(&mut value);
        serde_json::from_value(value).expect("variant parses")
    };

    let cases: Vec<(&str, RetirementPlan)> = vec![
        ("baseline", variant(&|_| {})),
        (
            "ltc_off",
            variant(&|v| {
                v["profile"]["longTermCare"]["enabled"] = serde_json::json!(false);
            }),
        ),
        (
            "social_security_off",
            variant(&|v| {
                v["socialSecurity"]["enabled"] = serde_json::json!(false);
            }),
        ),
        (
            "parametric_returns",
            variant(&|v| {
                v["assumptions"]["simulationModel"] = serde_json::json!("parametric");
            }),
        ),
    ];

    let mut group = c.benchmark_group("subsystem");
    for (name, plan) in &cases {
        group.bench_function(*name, |b| {
            let prepared = PreparedPlan::new(plan).expect("plan prepares");
            let mut path_index = 0_u64;
            b.iter(|| {
                path_index = path_index.wrapping_add(1);
                black_box(project_scenario_summary_prepared(
                    &prepared,
                    config_for(path_index),
                ))
            })
        });
    }
    group.finish();
}

criterion_group!(benches, benchmark, subsystems);
criterion_main!(benches);
