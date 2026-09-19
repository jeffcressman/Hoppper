import { reactive } from 'vue';

// Jams the CDN has refused an image for (it answers 403 when a jam has none).
// A failed image isn't cached by the webview, so this session doesn't ask
// again. Kept per session rather than on disk: an owner can add one later.
const missing = reactive(new Set<string>());

export const jamImageMissing = (jamId: string): boolean => missing.has(jamId);

export function markJamImageMissing(jamId: string): void {
  missing.add(jamId);
}

/** For tests. */
export function forgetMissingJamImages(): void {
  missing.clear();
}
