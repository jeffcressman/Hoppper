import { getClient } from '../client';
import { defineSessionStore } from './session';
import { defineJamsStore } from './jams';
import { defineCurrentJamStore } from './current-jam';
import { definePerformanceStore, type PerformanceDeps } from './performance';

// Bind each store factory to the production client lazily, so that store
// definitions stay tree-shakeable in tests (which never call these) and so
// that boot-order issues surface as a getClient() error rather than a
// confusing 'undefined' deep inside a store action.
let _useSessionStore: ReturnType<typeof defineSessionStore> | undefined;
let _useJamsStore: ReturnType<typeof defineJamsStore> | undefined;
let _useCurrentJamStore: ReturnType<typeof defineCurrentJamStore> | undefined;
let _usePerformanceStore: ReturnType<typeof definePerformanceStore> | undefined;
let _performanceDeps: PerformanceDeps | undefined;

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

// Performance needs an AudioEngine that can't be constructed at module load
// (needs an AudioContext from a user gesture). Bootstrap calls this once.
export function initPerformanceStore(deps: PerformanceDeps): void {
  _performanceDeps = deps;
  _usePerformanceStore = definePerformanceStore(deps);
}

export function usePerformanceStore() {
  if (!_usePerformanceStore || !_performanceDeps) {
    throw new Error(
      'Performance store not initialized — call initPerformanceStore() during bootstrap',
    );
  }
  return _usePerformanceStore();
}
