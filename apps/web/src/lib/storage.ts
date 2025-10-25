/**
 * Storage utilities for file uploads
 *
 * Strategy:
 * - Development: Use project-root /uploads (outside public for security)
 * - Production: Use environment variable or OS temp directory
 */

import { join } from 'path';
import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';

/**
 * Get the uploads directory path based on environment
 *
 * Priority:
 * 1. UPLOADS_DIR env variable (for production/custom deployments)
 * 2. Project root /uploads (development, monorepo-aware)
 * 3. OS temp directory (fallback for restricted filesystems)
 */
export function getUploadsDir(): string {
  // Priority 1: Explicit environment variable
  if (process.env.UPLOADS_DIR) {
    return process.env.UPLOADS_DIR;
  }

  // Priority 2: Development - use monorepo root /uploads
  // When Next.js runs from apps/web, go up 2 levels to repo root
  if (process.env.NODE_ENV === 'development') {
    return join(process.cwd(), '..', '..', 'uploads');
  }

  // Priority 3: Production fallback - use OS temp directory
  // This works in serverless/container environments
  return join(tmpdir(), 'retire-uploads');
}

/**
 * Ensure the uploads directory exists
 */
export async function ensureUploadsDir(): Promise<string> {
  const uploadsDir = getUploadsDir();
  await mkdir(uploadsDir, { recursive: true });
  return uploadsDir;
}

/**
 * Get a safe file path for storing uploaded files
 * @param filename - The filename to store
 * @returns Full path to the file
 */
export async function getUploadPath(filename: string): Promise<string> {
  const uploadsDir = await ensureUploadsDir();
  return join(uploadsDir, filename);
}
