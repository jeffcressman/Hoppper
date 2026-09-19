import type { HopSequence } from '../hop-recorder/types';
import type { RenderedTake } from './render';
import { encodeWav } from './wav';

export interface ExportDeps {
  /** The system Save dialog; null when cancelled. */
  chooseFile(defaultName: string): Promise<string | null>;
  render(seq: HopSequence): Promise<RenderedTake>;
  write(path: string, bytes: Uint8Array): Promise<void>;
}

// Characters no file name may hold on macOS or Windows, and control codes.
// eslint-disable-next-line no-control-regex
const UNSAFE_IN_FILE_NAME = /[\\/:*?"<>|\x00-\x1f]/g;

const cleanForFile = (text: string) => text.replace(UNSAFE_IN_FILE_NAME, '').replace(/\s+/g, ' ').trim();

/** "2026-09-14": the day recorded, in the user's local time. */
function dayOf(recordedAt: string): string {
  const d = new Date(recordedAt);
  if (Number.isNaN(d.getTime())) return 'undated';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * "<jam> hoppp <day recorded> - <hop>.wav" (the user's format, 2026-09-18),
 * each part without what a file name can't hold.
 */
export function exportFileName(jamName: string, recordedAt: string, title: string): string {
  return `${cleanForFile(jamName) || 'Jam'} hoppp ${dayOf(recordedAt)} - ${cleanForFile(title) || 'Hop'}.wav`;
}

/** Ask where to save, render the take, write it as a WAV. */
export async function exportTake(seq: HopSequence, deps: ExportDeps, jamName: string): Promise<'saved' | 'cancelled'> {
  const chosen = await deps.chooseFile(exportFileName(jamName, seq.recordedAt, seq.title));
  if (!chosen) return 'cancelled';
  const path = /\.wav$/i.test(chosen) ? chosen : `${chosen}.wav`;
  const { channels, sampleRate } = await deps.render(seq);
  await deps.write(path, encodeWav(channels, sampleRate));
  return 'saved';
}
