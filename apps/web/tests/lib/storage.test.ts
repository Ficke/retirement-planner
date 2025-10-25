import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getUploadsDir, ensureUploadsDir, getUploadPath } from '@/lib/storage';
import { join } from 'path';
import { tmpdir } from 'os';
import { rm } from 'fs/promises';

describe('Storage utilities', () => {
  const originalUploadsDir = process.env.UPLOADS_DIR;

  afterEach(() => {
    // Restore original environment
    process.env.UPLOADS_DIR = originalUploadsDir;
    vi.unstubAllEnvs();
  });

  describe('getUploadsDir', () => {
    it('should use UPLOADS_DIR env variable when set', () => {
      process.env.UPLOADS_DIR = '/custom/uploads';
      const result = getUploadsDir();
      expect(result).toBe('/custom/uploads');
    });

    it('should use project root in development', () => {
      vi.stubEnv('NODE_ENV', 'development');
      delete process.env.UPLOADS_DIR;

      const result = getUploadsDir();
      // Should resolve to repo root /uploads (two levels up from apps/web)
      expect(result).toContain('uploads');
      expect(result).not.toContain('tmp');
    });

    it('should use temp directory in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      delete process.env.UPLOADS_DIR;

      const result = getUploadsDir();
      expect(result).toBe(join(tmpdir(), 'retire-uploads'));
    });

    it('should prioritize UPLOADS_DIR over NODE_ENV', () => {
      vi.stubEnv('NODE_ENV', 'production');
      process.env.UPLOADS_DIR = '/priority/test';

      const result = getUploadsDir();
      expect(result).toBe('/priority/test');
    });
  });

  describe('ensureUploadsDir', () => {
    it('should create directory and return path', async () => {
      process.env.UPLOADS_DIR = join(tmpdir(), 'test-uploads-' + Date.now());

      const result = await ensureUploadsDir();
      expect(result).toBe(process.env.UPLOADS_DIR);

      // Cleanup
      await rm(process.env.UPLOADS_DIR, { recursive: true, force: true });
    });

    it('should not fail if directory already exists', async () => {
      process.env.UPLOADS_DIR = join(tmpdir(), 'test-uploads-existing-' + Date.now());

      // Create it twice
      await ensureUploadsDir();
      const result = await ensureUploadsDir();

      expect(result).toBe(process.env.UPLOADS_DIR);

      // Cleanup
      await rm(process.env.UPLOADS_DIR, { recursive: true, force: true });
    });
  });

  describe('getUploadPath', () => {
    it('should return full path to file', async () => {
      process.env.UPLOADS_DIR = join(tmpdir(), 'test-uploads-path-' + Date.now());

      const result = await getUploadPath('test.png');
      expect(result).toBe(join(process.env.UPLOADS_DIR, 'test.png'));

      // Cleanup
      await rm(process.env.UPLOADS_DIR, { recursive: true, force: true });
    });

    it('should create directory if it does not exist', async () => {
      process.env.UPLOADS_DIR = join(tmpdir(), 'test-uploads-auto-' + Date.now());

      const result = await getUploadPath('auto-test.png');
      expect(result).toContain('auto-test.png');

      // Cleanup
      await rm(process.env.UPLOADS_DIR, { recursive: true, force: true });
    });
  });
});
