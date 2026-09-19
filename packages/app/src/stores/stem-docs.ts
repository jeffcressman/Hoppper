import { defineStore } from 'pinia';
import { shallowRef, triggerRef } from 'vue';
import {
  resolveStemUrl,
  type EndlesssClient,
  type JamCouchID,
  type ResolvedStem,
  type RiffDocument,
  type StemCouchID,
  type StemDocument,
} from '@hoppper/sdk';

export type StemDocsClient = Pick<EndlesssClient, 'getStemDocuments'>;

/**
 * Stem documents, fetched once each and kept by ID. A stem document never
 * changes (CLAUDE.md → server etiquette), so what the rifff history fetched to
 * colour its splats is what a hop uses to play — the click costs no request.
 * In memory only for now; keeping them on disk is Phase 9.
 */
export function defineStemDocsStore(client: StemDocsClient) {
  return defineStore('stemDocs', () => {
    // null: Endlesss has no document for that stem. Remembered too.
    const docs = shallowRef(new Map<StemCouchID, StemDocument | null>());
    const inFlight = new Map<StemCouchID, Promise<void>>();

    function has(id: StemCouchID): boolean {
      return docs.value.has(id);
    }

    /** The document, null if Endlesss has none, undefined if not fetched yet. */
    function get(id: StemCouchID): StemDocument | null | undefined {
      return docs.value.get(id);
    }

    async function ensure(jamId: JamCouchID, ids: StemCouchID[]): Promise<void> {
      const wanted = [...new Set(ids)].filter((id) => !docs.value.has(id));
      const toFetch = wanted.filter((id) => !inFlight.has(id));
      if (toFetch.length > 0) {
        const request = client.getStemDocuments(jamId, toFetch).then((found) => {
          toFetch.forEach((id, i) => docs.value.set(id, found[i] ?? null));
          triggerRef(docs);
        });
        const settled = request.finally(() => toFetch.forEach((id) => inFlight.delete(id)));
        // Waiters see the request's own outcome; the bookkeeping promise
        // mustn't raise an unhandled rejection of its own.
        settled.catch(() => {});
        toFetch.forEach((id) => inFlight.set(id, request));
      }
      await Promise.all(wanted.map((id) => inFlight.get(id)).filter(Boolean));
    }

    async function resolve(jamId: JamCouchID, riff: RiffDocument): Promise<ResolvedStem[]> {
      const ids = riff.slots
        .filter((s) => s.on && s.stemId)
        .map((s) => s.stemId as StemCouchID);
      await ensure(jamId, ids);
      return ids
        .map((id) => docs.value.get(id))
        .map((doc) => (doc ? resolveStemUrl(doc) : null))
        .filter((s): s is ResolvedStem => s !== null);
    }

    return { has, get, ensure, resolve };
  });
}
