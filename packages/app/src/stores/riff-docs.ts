import { defineStore } from 'pinia';
import { shallowRef, triggerRef } from 'vue';
import type { EndlesssClient, JamCouchID, RiffCouchID, RiffDocument } from '@hoppper/sdk';

export type RiffDocsClient = Pick<EndlesssClient, 'getRiffs'>;

/**
 * Rifff documents, fetched once each and kept by ID — like the stem
 * documents, they never change. Replay and the hop editor read rifffs
 * through here, so replaying a take doesn't fetch each rifff again per hop.
 * In memory only for now; keeping them on disk is Phase 9.
 */
export function defineRiffDocsStore(client: RiffDocsClient) {
  return defineStore('riffDocs', () => {
    // null: Endlesss has no such rifff. Remembered too.
    const docs = shallowRef(new Map<RiffCouchID, RiffDocument | null>());
    const inFlight = new Map<RiffCouchID, Promise<void>>();

    /** The rifff, null if Endlesss has none, undefined if not fetched yet. */
    function get(id: RiffCouchID): RiffDocument | null | undefined {
      return docs.value.get(id);
    }

    /** Rifffs already fetched another way (a jam's pages). */
    function remember(riffs: RiffDocument[]): void {
      let changed = false;
      for (const r of riffs) {
        if (!docs.value.has(r.riffId)) {
          docs.value.set(r.riffId, r);
          changed = true;
        }
      }
      if (changed) triggerRef(docs);
    }

    async function ensure(jamId: JamCouchID, ids: RiffCouchID[]): Promise<void> {
      const wanted = [...new Set(ids)].filter((id) => !docs.value.has(id));
      const toFetch = wanted.filter((id) => !inFlight.has(id));
      if (toFetch.length > 0) {
        const request = client.getRiffs(jamId, toFetch).then((found) => {
          const byId = new Map(found.map((r) => [r.riffId, r]));
          for (const id of toFetch) docs.value.set(id, byId.get(id) ?? null);
          triggerRef(docs);
        });
        const settled = request.finally(() => toFetch.forEach((id) => inFlight.delete(id)));
        settled.catch(() => {});
        toFetch.forEach((id) => inFlight.set(id, request));
      }
      await Promise.all(wanted.map((id) => inFlight.get(id)).filter(Boolean));
    }

    async function fetch(jamId: JamCouchID, id: RiffCouchID): Promise<RiffDocument | null> {
      await ensure(jamId, [id]);
      return docs.value.get(id) ?? null;
    }

    return { get, remember, ensure, fetch };
  });
}
