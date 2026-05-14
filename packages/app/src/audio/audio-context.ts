// Lazy singleton AudioContext. Browsers (and Tauri's webview) require a user
// gesture before audio can play, so we create the context up front (it will
// start suspended) and resume it inside the first user-initiated action.

let _context: AudioContext | null = null;

export function getOrCreateAudioContext(): AudioContext {
  if (_context !== null) return _context;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    throw new Error('AudioContext is not available in this environment');
  }
  _context = new Ctor();
  return _context;
}

/** Resume a suspended AudioContext. Safe to call repeatedly. */
export async function unlockAudioContext(): Promise<void> {
  const ctx = getOrCreateAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
}
