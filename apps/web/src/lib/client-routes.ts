export const CLIENT_ROUTES = {
  root: '/',
  plan: '/plan',
  accounts: '/accounts',
  profile: '/profile',
  settings: '/settings',
  signIn: '/auth/signin',
  signUp: '/auth/signup',
} as const;

export const APP_PAGES = {
  plan: { label: 'Plan', path: CLIENT_ROUTES.plan },
  accounts: { label: 'Accounts', path: CLIENT_ROUTES.accounts },
  profile: { label: 'Profile', path: CLIENT_ROUTES.profile },
  settings: { label: 'Settings', path: CLIENT_ROUTES.settings },
} as const;

export type AppPageId = keyof typeof APP_PAGES;

export function appPageForPath(pathname: string): AppPageId | null {
  const entry = Object.entries(APP_PAGES).find(([, page]) => page.path === pathname);
  return (entry?.[0] as AppPageId | undefined) ?? null;
}
