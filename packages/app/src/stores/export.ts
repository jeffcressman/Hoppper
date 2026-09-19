import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { HopSequence } from '../hop-recorder/types.js';
import { exportTake as runExport, type ExportDeps } from '../export/export-take.js';
import { log } from '../logging/log-store.js';

/** Exporting takes as WAV files, one at a time. */
export function defineExportStore(deps: ExportDeps) {
  return defineStore('export', () => {
    const exportingId = ref<string | null>(null);
    const lastSaved = ref<{ id: string; path: string } | null>(null);
    const lastError = ref<{ id: string; message: string } | null>(null);

    // Set at the click, before the dialog: a second click while the dialog
    // is open mustn't open another.
    let busy = false;

    async function exportTake(seq: HopSequence): Promise<void> {
      if (busy) return;
      busy = true;
      lastError.value = null;
      let savedTo: string | null = null;
      try {
        const result = await runExport(seq, {
          ...deps,
          chooseFile: async (name) => {
            const path = await deps.chooseFile(name);
            // Only once a place is chosen does the take count as exporting.
            if (path) exportingId.value = seq.id;
            return path;
          },
          write: async (path, bytes) => {
            await deps.write(path, bytes);
            savedTo = path;
          },
        });
        if (result === 'saved' && savedTo) lastSaved.value = { id: seq.id, path: savedTo };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError.value = { id: seq.id, message };
        log('error', 'export', `export of ${seq.id} failed: ${message}`, err);
      } finally {
        exportingId.value = null;
        busy = false;
      }
    }

    return { exportingId, lastSaved, lastError, exportTake };
  });
}
