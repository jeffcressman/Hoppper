import type { StemCouchID } from './ids.js';

export type StemFormat = 'ogg' | 'flac';

export interface StemAudioAttachment {
  format: StemFormat;
  endpoint: string;
  key: string;
  bucket?: string;
  url: string;
  length: number;
  mime: string;
}

export interface StemDocument {
  stemId: StemCouchID;
  bps: number;
  length16ths: number;
  originalPitch: number;
  barLength: number;
  presetName: string;
  creatorUserName: string;
  primaryColour: string;
  sampleRate: number;
  createdAt: number;
  isDrum?: boolean;
  isNote?: boolean;
  isBass?: boolean;
  isMic?: boolean;
  ogg: StemAudioAttachment | null;
  flac: StemAudioAttachment | null;
}

// A stem ready to play: format chosen, URL fully resolved.
export interface ResolvedStem {
  stemId: StemCouchID;
  format: StemFormat;
  url: string;
  length: number;
  mime: string;
}
