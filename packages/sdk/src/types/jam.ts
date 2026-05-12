import type { JamCouchID } from './ids.js';

export type JamCategory = 'personal' | 'subscribed' | 'joinable';

export interface JamRef {
  jamId: JamCouchID;
  category: JamCategory;
  // ISO timestamp the user joined; only populated for subscribed jams.
  joinedAt?: string;
}

export interface JamListing {
  personal: JamRef;
  subscribed: JamRef[];
  joinable: JamRef[];
}

export interface JamProfile {
  jamId: JamCouchID;
  displayName: string;
  bio?: string;
  appVersion?: number;
}
