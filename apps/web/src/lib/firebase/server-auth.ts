import { verifyAuthToken } from './admin';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

export async function getAuthUser(headers: Headers): Promise<AuthUser | null> {
  const decodedToken = await verifyAuthToken(headers.get('authorization'));
  if (!decodedToken) return null;

  return {
    id: decodedToken.uid,
    email: decodedToken.email ?? '',
    name: decodedToken.name ?? null,
  };
}

export async function requireAuth(headers: Headers): Promise<AuthUser> {
  const user = await getAuthUser(headers);
  if (!user) throw new Error('Unauthorized');
  return user;
}
