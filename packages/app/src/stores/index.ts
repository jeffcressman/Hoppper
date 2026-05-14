import { getClient } from '../client';
import { defineSessionStore } from './session';
import { defineJamsStore } from './jams';
import { defineCurrentJamStore } from './current-jam';

// Bind each store factory to the production client lazily, so that store
// definitions stay tree-shakeable in tests (which never call these) and so
// that boot-order issues surface as a getClient() error rather than a
// confusing 'undefined' deep inside a store action.
let _useSessionStore: ReturnType<typeof defineSessionStore> | undefined;
let _useJamsStore: ReturnType<typeof defineJamsStore> | undefined;
let _useCurrentJamStore: ReturnType<typeof defineCurrentJamStore> | undefined;

export function useSessionStore() {
  _useSessionStore ??= defineSessionStore(getClient());
  return _useSessionStore();
}

export function useJamsStore() {
  _useJamsStore ??= defineJamsStore(getClient());
  return _useJamsStore();
}

export function useCurrentJamStore() {
  _useCurrentJamStore ??= defineCurrentJamStore(getClient());
  return _useCurrentJamStore();
}
