import { readFile, writeFile, unlink, chmod } from 'node:fs/promises';
import type { AuthSession } from './types/index.js';

export interface TokenStore {
  load(): Promise<AuthSession | null>;
  save(session: AuthSession): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryTokenStore implements TokenStore {
  private session: AuthSession | null = null;

  async load(): Promise<AuthSession | null> {
    return this.session;
  }

  async save(session: AuthSession): Promise<void> {
    this.session = session;
  }

  async clear(): Promise<void> {
    this.session = null;
  }
}

export class FileTokenStore implements TokenStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AuthSession | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    try {
      return JSON.parse(raw) as AuthSession;
    } catch {
      return null;
    }
  }

  async save(session: AuthSession): Promise<void> {
    await writeFile(this.path, JSON.stringify(session, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    // writeFile only applies `mode` on file creation; chmod ensures perms are
    // tightened when overwriting an existing file too.
    await chmod(this.path, 0o600);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
