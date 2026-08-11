import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/firebase/server';
import {
  getUnifiedDatabaseService,
  ProfileRevisionConflictError,
} from '@/services/server/database';
import { readLimitedJson, SaveProfileSchema, validateRequest } from '@/lib/validation';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getUnifiedDatabaseService();
    await db.initialize();

    const result = await db.getUserProfile(user.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Get profile error:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await readLimitedJson(request, 64 * 1024);
    const validation = validateRequest(SaveProfileSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', errors: validation.errors },
        { status: 400 }
      );
    }

    const data = validation.data!;
    const db = getUnifiedDatabaseService();
    await db.initialize();

    const revision = await db.saveUserProfile(user.id, {
      profile: data.profile,
      socialSecurity: data.socialSecurity,
      assumptions: data.assumptions,
    }, data.revision);

    return NextResponse.json({ revision });
  } catch (error) {
    if (error instanceof ProfileRevisionConflictError) {
      return NextResponse.json(
        { error: 'Profile changed in another browser. Reload before saving again.' },
        { status: 409 },
      );
    }
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    console.error('Save profile error:', error);
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
  }
}
