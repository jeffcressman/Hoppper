import { getClient } from '../client';
import { defineSessionStore } from './session';
import { defineJamsStore } from './jams';
import { defineCurrentJamStore } from './current-jam';
import { definePerformanceStore, type PerformanceDeps } from './performance';
import { defineRecorderStore, type RecorderDeps } from './recorder';
import { defineStemDocsStore } from './stem-docs';
import { defineRiffDocsStore } from './riff-docs';
import { defineHopEditorStore, type HopEditorDeps } from './hop-editor';
import { defineExportStore } from './export';
import type { ExportDeps } from '../export/export-take';

// Bind each store factory to the production client lazily, so that store
// definitions stay tree-shakeable in tests (which never call these) and so
// that boot-order issues surface as a getClient() error rather than a
// confusing 'undefined' deep inside a store action.
let _useSessionStore: ReturnType<typeof defineSessionStore> | undefined;
let _useJamsStore: ReturnType<typeof defineJamsStore> | undefined;
let _useCurrentJamStore: ReturnType<typeof defineCurrentJamStore> | undefined;
let _usePerformanceStore: ReturnType<typeof definePerformanceStore> | undefined;
let _performanceDeps: PerformanceDeps | undefined;
let _useRecorderStore: ReturnType<typeof defineRecorderStore> | undefined;
let _recorderDeps: RecorderDeps | undefined;
let _useStemDocsStore: ReturnType<typeof defineStemDocsStore> | undefined;
let _useRiffDocsStore: ReturnType<typeof defineRiffDocsStore> | undefined;
let _useHopEditorStore: ReturnType<typeof defineHopEditorStore> | undefined;
let _useExportStore: ReturnType<typeof defineExportStore> | undefined;

export function useSessionStore() {
  _useSessionStore ??= defineSessionStore(getClient());
  return _useSessionStore();
}

export function useJamsStore() {
  _useJamsStore ??= defineJamsStore(getClient());
  return _useJamsStore();
}

export function useStemDocsStore() {
  _useStemDocsStore ??= defineStemDocsStore(getClient());
  return _useStemDocsStore();
}

export function useRiffDocsStore() {
  _useRiffDocsStore ??= defineRiffDocsStore(getClient());
  return _useRiffDocsStore();
}

// The editor saves through the Tauri filesystem, only there after bootstrap.
export function initHopEditorStore(deps: HopEditorDeps): void {
  _useHopEditorStore = defineHopEditorStore(deps);
}

export function useHopEditorStore() {
  if (!_useHopEditorStore) {
    throw new Error('Hop editor store not initialized — call initHopEditorStore() during bootstrap');
  }
  return _useHopEditorStore();
}

// Export renders through the app's decoded stems and writes through Tauri.
export function initExportStore(deps: ExportDeps): void {
  _useExportStore = defineExportStore(deps);
}

export function useExportStore() {
  if (!_useExportStore) {
    throw new Error('Export store not initialized — call initExportStore() during bootstrap');
  }
  return _useExportStore();
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

// Recorder, like performance, depends on the AudioContext-backed engine and
// the Tauri filesystem — both only available after bootstrap.
export function initRecorderStore(deps: RecorderDeps): void {
  _recorderDeps = deps;
  _useRecorderStore = defineRecorderStore(deps);
}

export function useRecorderStore() {
  if (!_useRecorderStore || !_recorderDeps) {
    throw new Error(
      'Recorder store not initialized — call initRecorderStore() during bootstrap',
    );
  }
  return _useRecorderStore();
}
