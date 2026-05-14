import type { AuthSession } from './types/index.js';

// Lazy-loaded so the SDK can be bundled for the browser/Tauri without
// pulling in node:fs/promises at module-evaluation time.
async function nodeFs() {
  return await import('node:fs/promises');
}

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
    const fs = await nodeFs();
    let raw: string;
    try {
      raw = await fs.readFile(this.path, 'utf8');
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
    const fs = await nodeFs();
    await fs.writeFile(this.path, JSON.stringify(session, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    // writeFile only applies `mode` on file creation; chmod ensures perms are
    // tightened when overwriting an existing file too.
    await fs.chmod(this.path, 0o600);
  }

  async clear(): Promise<void> {
    const fs = await nodeFs();
    try {
      await fs.unlink(this.path);
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
