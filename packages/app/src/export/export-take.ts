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

/** The hop's name as a file name: "20260919 Sunday drift hoppp.wav". */
export function exportFileName(title: string): string {
  return `${cleanForFile(title) || 'hoppp'}.wav`;
}

/** Ask where to save, render the take, write it as a WAV. */
export async function exportTake(seq: HopSequence, deps: ExportDeps): Promise<'saved' | 'cancelled'> {
  const chosen = await deps.chooseFile(exportFileName(seq.title));
  if (!chosen) return 'cancelled';
  const path = /\.wav$/i.test(chosen) ? chosen : `${chosen}.wav`;
  const { channels, sampleRate } = await deps.render(seq);
  await deps.write(path, encodeWav(channels, sampleRate));
  return 'saved';
}
