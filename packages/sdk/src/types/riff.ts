import type { JamCouchID, RiffCouchID, StemCouchID } from './ids.js';

export interface RiffSlot {
  on: boolean;
  stemId: StemCouchID | null;
  gain: number;
}

export interface RiffDocument {
  riffId: RiffCouchID;
  jamId: JamCouchID;
  userName: string;
  createdAt: number; // unix ms
  bps: number;
  bpm: number; // ceil(bps * 60 * 100) / 100 — for display
  barLength: number;
  root: number;
  scale: number;
  appVersion?: number;
  magnitude?: number;
  slots: RiffSlot[]; // exactly 8 entries
}

// One row from rifffLoopsByCreateTime view: just enough to know what
// stems exist without fetching the full riff document.
export interface RiffIndexRow {
  riffId: RiffCouchID;
  createdAtNs: bigint; // unix nanoseconds (CouchDB view emits as number)
  stemIds: (StemCouchID | null)[]; // 8 slots; null where the slot was empty
}

export interface RiffIndex {
  totalRows: number;
  rows: RiffIndexRow[];
}
