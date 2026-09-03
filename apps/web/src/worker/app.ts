import { createDataRoutes } from '@/api/data-routes';
import { INVITE_RATE_LIMIT } from '@/lib/invite-code';
import { createEdgeApp, type EdgeEnv } from './base-app';
import { durableObjectQuota } from './quota-counter';

export const edgeApp = createEdgeApp();

edgeApp.route(
  '/',
  createDataRoutes<EdgeEnv>({
    getDatabase: (c) => c.var.database(),
    signupQuota: (c) => durableObjectQuota(c.env.QUOTA, 'signup'),
    signupBudget: INVITE_RATE_LIMIT,
  }),
);
