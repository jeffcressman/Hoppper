import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  EndlesssClient,
  JamCouchID,
  RiffDocument,
} from '@hoppper/sdk';

export type CurrentJamClient = Pick<EndlesssClient, 'iterateRiffs'>;

const PAGE_SIZE = 25;

export function defineCurrentJamStore(client: CurrentJamClient) {
  return defineStore('currentJam', () => {
    const jamId = ref<JamCouchID | null>(null);
    const riffPage = ref<RiffDocument[]>([]);
    const hasMore = ref(false);

    let iterator: AsyncGenerator<RiffDocument[], void, void> | null = null;
    let nextBuffered: RiffDocument[] | null = null;

    // Pulls the next page from the iterator into `nextBuffered` so hasMore
    // reflects whether more data exists *without* the caller having to ask.
    // Costs one extra page-fetch on open / loadNextPage, which is acceptable
    // because the user is likely to want it anyway and we still respect the
    // 'no refetch of cached data' rule from CLAUDE.md.
    async function peekNext(): Promise<void> {
      if (!iterator) {
        nextBuffered = null;
        hasMore.value = false;
        return;
      }
      const { value, done } = await iterator.next();
      if (done) {
        nextBuffered = null;
        hasMore.value = false;
        iterator = null;
        return;
      }
      nextBuffered = value;
      hasMore.value = true;
    }

    async function open(id: JamCouchID): Promise<void> {
      jamId.value = id;
      riffPage.value = [];
      nextBuffered = null;
      hasMore.value = false;
      iterator = client.iterateRiffs(id, { pageSize: PAGE_SIZE });
      // Pull first page synchronously into riffPage; then peek so hasMore
      // is decided before the caller awaits.
      await peekNext();
      if (nextBuffered) {
        riffPage.value = nextBuffered;
        nextBuffered = null;
        await peekNext();
      }
    }

    async function loadNextPage(): Promise<void> {
      if (!nextBuffered) return;
      riffPage.value = [...riffPage.value, ...nextBuffered];
      nextBuffered = null;
      await peekNext();
    }

    function close(): void {
      jamId.value = null;
      riffPage.value = [];
      hasMore.value = false;
      iterator = null;
      nextBuffered = null;
    }

    return { jamId, riffPage, hasMore, open, loadNextPage, close };
  });
}
