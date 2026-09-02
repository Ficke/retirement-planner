/**
 * Account identifiers are database-generated UUIDs.
 *
 * Kept free of any schema-library dependency so a route can check an id
 * without building the validation schemas, which cost real startup CPU in a
 * Worker. AccountIdSchema derives from this, so there is one rule.
 */
const ACCOUNT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAccountId(value: string): boolean {
  return ACCOUNT_ID.test(value);
}
