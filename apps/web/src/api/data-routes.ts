import { Hono, type Context } from 'hono';

import type { CreateAccountData, UpdateAccountData } from '@/domain/types';
import type { Budget, QuotaLimiter } from '@/api/quota';
import { getAuthUser, verifyAuthToken } from '@/lib/firebase/server';
import { verifyInviteCode } from '@/lib/invite-code';
import {
  AccountIdSchema,
  CreateAccountSchema,
  SaveProfileSchema,
  UpdateAccountSchema,
  readLimitedJson,
  validateRequest,
} from '@/lib/validation';
import {
  AccountLimitError,
  ProfileRevisionConflictError,
  type UnifiedDatabaseService,
} from '@/services/server/database';

/**
 * Routes that read and write the application database.
 *
 * Mounted by both the Node server and the Worker so the two cannot drift while
 * they run side by side. Everything environment-specific — how a database
 * connection is obtained, how signup attempts are limited — arrives as a
 * dependency.
 */
export type DataRouteEnv = { Variables: { clientIp: string } };

export interface DataRouteDependencies<E extends DataRouteEnv> {
  getDatabase(c: Context<E>): Promise<UnifiedDatabaseService>;
  /** Brute-force budget for signups that must present an invite code. */
  signupQuota(c: Context<E>): QuotaLimiter;
  signupBudget: Budget;
}

const PROFILE_BODY_LIMIT = 64 * 1024;
const SYNC_BODY_LIMIT = 16 * 1024;

function bodyError<E extends DataRouteEnv>(c: Context<E>, error: unknown): Response | null {
  if (error instanceof RangeError) return c.json({ error: error.message }, 413);
  if (error instanceof SyntaxError) {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }
  return null;
}

export function createDataRoutes<E extends DataRouteEnv>(
  dependencies: DataRouteDependencies<E>,
): Hono<E> {
  const routes = new Hono<E>();
  const { getDatabase, signupQuota, signupBudget } = dependencies;

  routes.get('/api/profile', async (c) => {
    try {
      const user = await getAuthUser(c.req.raw.headers);
      if (!user) return c.json({ error: 'Unauthorized' }, 401);

      const db = await getDatabase(c);
      return c.json(await db.getUserProfile(user.id));
    } catch (error) {
      console.error('Get profile error:', error);
      return c.json({ error: 'Failed to fetch profile' }, 500);
    }
  });

  routes.put('/api/profile', async (c) => {
    try {
      const user = await getAuthUser(c.req.raw.headers);
      if (!user) return c.json({ error: 'Unauthorized' }, 401);

      const body = await readLimitedJson(c.req.raw, PROFILE_BODY_LIMIT);
      const validation = validateRequest(SaveProfileSchema, body);
      if (!validation.success) {
        return c.json({ error: 'Validation failed', errors: validation.errors }, 400);
      }

      const data = validation.data!;
      const db = await getDatabase(c);
      const revision = await db.saveUserProfile(
        user.id,
        {
          profile: data.profile,
          socialSecurity: data.socialSecurity,
          assumptions: data.assumptions,
        },
        data.revision,
      );
      return c.json({ revision });
    } catch (error) {
      if (error instanceof ProfileRevisionConflictError) {
        return c.json(
          { error: 'Profile changed in another browser. Reload before saving again.' },
          409,
        );
      }
      const known = bodyError(c, error);
      if (known) return known;
      console.error('Save profile error:', error);
      return c.json({ error: 'Failed to save profile' }, 500);
    }
  });

  routes.get('/api/accounts', async (c) => {
    try {
      const user = await getAuthUser(c.req.raw.headers);
      if (!user) return c.json({ error: 'Unauthorized' }, 401);

      const db = await getDatabase(c);
      return c.json(await db.getAccountsForUser(user.id));
    } catch (error) {
      console.error('Get accounts error:', error);
      return c.json({ error: 'Failed to fetch accounts' }, 500);
    }
  });

  routes.post('/api/accounts', async (c) => {
    try {
      const user = await getAuthUser(c.req.raw.headers);
      if (!user) return c.json({ error: 'Unauthorized' }, 401);

      const body = await readLimitedJson(c.req.raw, PROFILE_BODY_LIMIT);
      const validation = validateRequest(CreateAccountSchema, body);
      if (!validation.success) {
        return c.json({ error: 'Validation failed', errors: validation.errors }, 400);
      }

      const db = await getDatabase(c);
      const account = await db.createAccount(validation.data as CreateAccountData, user.id);
      return c.json(account, 201);
    } catch (error) {
      if (error instanceof AccountLimitError) return c.json({ error: error.message }, 409);
      const known = bodyError(c, error);
      if (known) return known;
      console.error('Create account error:', error);
      return c.json({ error: 'Failed to create account' }, 500);
    }
  });

  routes.get('/api/accounts/:id', async (c) => {
    try {
      const user = await getAuthUser(c.req.raw.headers);
      if (!user) return c.json({ error: 'Unauthorized' }, 401);

      const id = c.req.param('id');
      if (!AccountIdSchema.safeParse(id).success) {
        return c.json({ error: 'Invalid account ID' }, 400);
      }
      const db = await getDatabase(c);
      const account = await db.getAccount(id, user.id);
      return account ? c.json(account) : c.json({ error: 'Account not found' }, 404);
    } catch (error) {
      console.error('Get account error:', error);
      return c.json({ error: 'Failed to fetch account' }, 500);
    }
  });

  routes.patch('/api/accounts/:id', async (c) => {
    try {
      const user = await getAuthUser(c.req.raw.headers);
      if (!user) return c.json({ error: 'Unauthorized' }, 401);

      const id = c.req.param('id');
      if (!AccountIdSchema.safeParse(id).success) {
        return c.json({ error: 'Invalid account ID' }, 400);
      }
      const body = await readLimitedJson(c.req.raw, PROFILE_BODY_LIMIT);
      const validation = validateRequest(UpdateAccountSchema, body);
      if (!validation.success) {
        return c.json({ error: 'Validation failed', errors: validation.errors }, 400);
      }

      const db = await getDatabase(c);
      const account = await db.updateAccount(id, user.id, validation.data as UpdateAccountData);
      return account ? c.json(account) : c.json({ error: 'Account not found' }, 404);
    } catch (error) {
      const known = bodyError(c, error);
      if (known) return known;
      console.error('Update account error:', error);
      return c.json({ error: 'Failed to update account' }, 500);
    }
  });

  routes.delete('/api/accounts/:id', async (c) => {
    try {
      const user = await getAuthUser(c.req.raw.headers);
      if (!user) return c.json({ error: 'Unauthorized' }, 401);

      const id = c.req.param('id');
      if (!AccountIdSchema.safeParse(id).success) {
        return c.json({ error: 'Invalid account ID' }, 400);
      }
      const db = await getDatabase(c);
      return (await db.deleteAccount(id, user.id))
        ? c.body(null, 204)
        : c.json({ error: 'Account not found' }, 404);
    } catch (error) {
      console.error('Delete account error:', error);
      return c.json({ error: 'Failed to delete account' }, 500);
    }
  });

  routes.post('/api/auth/sync-user', async (c) => {
    try {
      const decodedToken = await verifyAuthToken(c.req.header('authorization') ?? null);
      if (!decodedToken) return c.json({ error: 'Unauthorized' }, 401);
      if (!decodedToken.email) {
        return c.json({ error: 'Authenticated account has no email claim' }, 400);
      }

      const body = c.req.raw.body ? await readLimitedJson(c.req.raw, SYNC_BODY_LIMIT) : undefined;
      const inviteCode =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>).inviteCode
          : undefined;
      const db = await getDatabase(c);
      const updated = await db.query(
        `UPDATE users SET email = $2, name = $3, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [decodedToken.uid, decodedToken.email, decodedToken.name ?? null],
      );

      if (updated.rows.length === 0) {
        const limited = await signupQuota(c).consume(
          `invite:${c.var.clientIp}`,
          1,
          signupBudget,
        );
        if (!limited.success) {
          c.header('Retry-After', String(Math.ceil((limited.reset - Date.now()) / 1000)));
          return c.json({ error: 'Too many signup attempts. Try again later.' }, 429);
        }
        if (!verifyInviteCode(inviteCode)) {
          return c.json({ error: 'That invite code is not valid' }, 403);
        }
        await db.query(
          `INSERT INTO users (id, email, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET
             email = $2, name = $3, updated_at = NOW()`,
          [decodedToken.uid, decodedToken.email, decodedToken.name ?? null],
        );
      }

      return c.json({ success: true, userId: decodedToken.uid });
    } catch (error) {
      const known = bodyError(c, error);
      if (known) return known;
      console.error('Sync user error:', error);
      return c.json({ error: 'Failed to sync user' }, 500);
    }
  });

  return routes;
}
