// Branded-style aliases — kept as plain strings for ergonomics. The branding
// only documents intent; nothing in the SDK enforces structural distinctness.
// JamCouchIDs starting with `band` are jams; otherwise they're a personal jam
// whose ID is the owning username.
export type JamCouchID = string;
export type RiffCouchID = string;
export type StemCouchID = string;
export type SharedRiffCouchID = string;
export type LongJamID = string;
