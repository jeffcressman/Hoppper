import { describe, it, expect, vi, beforeEach } from 'vitest';

const pluginMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => pluginMocks);

import { tauriFsAdapter } from '../../src/tauri/fs-adapter';

beforeEach(() => {
  for (const fn of Object.values(pluginMocks)) fn.mockReset();
});

describe('tauriFsAdapter', () => {
  it('readFile delegates to plugin and returns its Uint8Array', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    pluginMocks.readFile.mockResolvedValue(bytes);
    const fs = tauriFsAdapter();

    await expect(fs.readFile('/some/path')).resolves.toBe(bytes);
    expect(pluginMocks.readFile).toHaveBeenCalledWith('/some/path');
  });

  it('writeFile delegates with bytes', async () => {
    pluginMocks.writeFile.mockResolvedValue(undefined);
    const fs = tauriFsAdapter();
    const bytes = new Uint8Array([9, 8, 7]);

    await fs.writeFile('/dst', bytes);
    expect(pluginMocks.writeFile).toHaveBeenCalledWith('/dst', bytes);
  });

  it('rename delegates', async () => {
    pluginMocks.rename.mockResolvedValue(undefined);
    const fs = tauriFsAdapter();

    await fs.rename('/a', '/b');
    expect(pluginMocks.rename).toHaveBeenCalledWith('/a', '/b');
  });

  it('unlink calls plugin remove', async () => {
    pluginMocks.remove.mockResolvedValue(undefined);
    const fs = tauriFsAdapter();

    await fs.unlink('/gone');
    expect(pluginMocks.remove).toHaveBeenCalledWith('/gone');
  });

  it('unlink swallows not-found errors', async () => {
    pluginMocks.remove.mockRejectedValue(new Error('path not found'));
    const fs = tauriFsAdapter();

    await expect(fs.unlink('/missing')).resolves.toBeUndefined();
  });

  it('unlink rethrows non-not-found errors', async () => {
    pluginMocks.remove.mockRejectedValue(new Error('permission denied'));
    const fs = tauriFsAdapter();

    await expect(fs.unlink('/locked')).rejects.toThrow(/permission denied/);
  });

  it('mkdir passes recursive option through', async () => {
    pluginMocks.mkdir.mockResolvedValue(undefined);
    const fs = tauriFsAdapter();

    await fs.mkdir('/d', { recursive: true });
    expect(pluginMocks.mkdir).toHaveBeenCalledWith('/d', { recursive: true });
  });

  it('readdir maps DirEntry[] to name strings', async () => {
    pluginMocks.readDir.mockResolvedValue([
      { name: 'a.flac', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'b.ogg', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'sub', isFile: false, isDirectory: true, isSymlink: false },
    ]);
    const fs = tauriFsAdapter();

    await expect(fs.readdir('/d')).resolves.toEqual(['a.flac', 'b.ogg', 'sub']);
  });

  it('stat returns { size } from FileInfo', async () => {
    pluginMocks.stat.mockResolvedValue({ size: 1234, isFile: true });
    const fs = tauriFsAdapter();

    await expect(fs.stat('/f')).resolves.toEqual({ size: 1234 });
  });

  it('stat returns null on not-found', async () => {
    pluginMocks.stat.mockRejectedValue(new Error('No such file or directory (os error 2)'));
    const fs = tauriFsAdapter();

    await expect(fs.stat('/missing')).resolves.toBeNull();
  });

  it('stat rethrows non-not-found errors', async () => {
    pluginMocks.stat.mockRejectedValue(new Error('permission denied'));
    const fs = tauriFsAdapter();

    await expect(fs.stat('/locked')).rejects.toThrow(/permission denied/);
  });
});
