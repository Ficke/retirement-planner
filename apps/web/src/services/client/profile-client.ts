import { authenticatedFetch } from '@/lib/firebase/api-client';

export interface ProfileSettings {
  profile: Record<string, unknown>;
  socialSecurity: Record<string, unknown>;
  assumptions: Record<string, unknown>;
}

export class ProfileClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async getProfile(): Promise<ProfileSettings | null> {
    const response = await authenticatedFetch(`${this.baseUrl}/profile`);
    if (!response.ok) {
      throw new Error(`Failed to fetch profile: ${response.statusText}`);
    }
    return response.json();
  }

  async saveProfile(settings: ProfileSettings): Promise<void> {
    const response = await authenticatedFetch(`${this.baseUrl}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!response.ok) {
      throw new Error(`Failed to save profile: ${response.statusText}`);
    }
  }
}

let profileClient: ProfileClient | null = null;

export function getProfileClient(): ProfileClient {
  if (!profileClient) {
    profileClient = new ProfileClient();
  }
  return profileClient;
}
