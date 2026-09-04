export const MIN_RETIREMENT_AGE = 45;

/**
 * The largest spending, salary, or balance the plan schema accepts. Sweep
 * scenarios are validated against that schema before they are dispatched, so a
 * lever range may never resolve past it.
 */
export const MAX_PLAN_DOLLARS = 1_000_000_000;
export const MAX_PLAN_ACCOUNTS = 20;
export const PLAN_SCHEMA_VERSION = 7;

/** Medicare eligibility, which is where retirement premiums step down. */
export const MEDICARE_AGE = 65;
