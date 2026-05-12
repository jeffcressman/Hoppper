import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryTokenStore, FileTokenStore } from '../src/token-store.js';
import type { AuthSession } from '../src/types/index.js';

const fixture: AuthSession = {
  token: 'tok-abc',
  password: 'pw-xyz',
  userId: 'alice',
  expiresAt: 1_700_000_000_000,
};

describe('InMemoryTokenStore', () => {
  it('returns null when empty', async () => {
    const store = new InMemoryTokenStore();
    await expect(store.load()).resolves.toBeNull();
  });

  it('round-trips a session', async () => {
    const store = new InMemoryTokenStore();
    await store.save(fixture);
    await expect(store.load()).resolves.toEqual(fixture);
  });

  it('clear() removes the session', async () => {
    const store = new InMemoryTokenStore();
    await store.save(fixture);
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });
});

describe('FileTokenStore', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hoppper-token-'));
    path = join(dir, 'auth.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the file does not exist', async () => {
    const store = new FileTokenStore(path);
    await expect(store.load()).resolves.toBeNull();
  });

  it('round-trips a session through disk', async () => {
    const store = new FileTokenStore(path);
    await store.save(fixture);
    expect(existsSync(path)).toBe(true);
    const reopened = new FileTokenStore(path);
    await expect(reopened.load()).resolves.toEqual(fixture);
  });

  it('writes the file with 0600 permissions (owner-only)', async () => {
    const store = new FileTokenStore(path);
    await store.save(fixture);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns null when the file contents are malformed', async () => {
    writeFileSync(path, 'not json at all');
    const store = new FileTokenStore(path);
    await expect(store.load()).resolves.toBeNull();
  });

  it('clear() removes the file', async () => {
    const store = new FileTokenStore(path);
    await store.save(fixture);
    await store.clear();
    expect(existsSync(path)).toBe(false);
  });

  it('clear() is a no-op when the file does not exist', async () => {
    const store = new FileTokenStore(path);
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
