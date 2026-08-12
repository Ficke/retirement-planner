import { authenticatedFetch } from '@/lib/firebase/api-client';

export interface ProfileSettings {
  profile: Record<string, unknown>;
  socialSecurity: Record<string, unknown>;
  assumptions: Record<string, unknown>;
  revision: number;
  schemaVersion: number;
}

export type ProfileSaveData = Omit<ProfileSettings, 'revision' | 'schemaVersion'>;

export class ProfileConflictError extends Error {
  constructor() {
    super('Profile changed in another browser. Reload before saving again.');
    this.name = 'ProfileConflictError';
  }
}

export class ProfileClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async getProfile(expectedUserId?: string): Promise<ProfileSettings | null> {
    const response = await authenticatedFetch(`${this.baseUrl}/profile`, {}, expectedUserId);
    if (!response.ok) {
      throw new Error(`Failed to fetch profile: ${response.statusText}`);
    }
    return response.json();
  }

  async saveProfile(
    settings: ProfileSaveData,
    revision: number | null,
    expectedUserId?: string,
  ): Promise<number> {
    const response = await authenticatedFetch(`${this.baseUrl}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, revision }),
    }, expectedUserId);
    if (response.status === 409) throw new ProfileConflictError();
    if (!response.ok) {
      throw new Error(`Failed to save profile: ${response.statusText}`);
    }
    const result: { revision: number } = await response.json();
    return result.revision;
  }
}

let profileClient: ProfileClient | null = null;

export function getProfileClient(): ProfileClient {
  if (!profileClient) {
    profileClient = new ProfileClient();
  }
  return profileClient;
}
