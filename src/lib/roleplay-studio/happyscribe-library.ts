export type HappyScribeLibraryItem = {
  id: string; importProof: string; name: string; state: string; language: string | null;
  durationSeconds: number | null; createdAt: string | null; folder: string | null;
};
export const HAPPY_SCRIBE_RESULT_PAGE_SIZE = 20;
export const happyScribeReady = (item: HappyScribeLibraryItem) => ['automatic_done','done'].includes(item.state);
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export type HappyScribeLibraryFilter = { query: string; readyOnly: boolean; language: string; folder: string };
export function filterHappyScribeLibrary<T extends HappyScribeLibraryItem>(items: readonly T[], filter: HappyScribeLibraryFilter): T[] {
  const terms = normalize(filter.query).split(/\s+/).filter(Boolean);
  return items.filter(item => {
    if (filter.readyOnly && !happyScribeReady(item)) return false;
    if (filter.language && (item.language ?? '') !== filter.language) return false;
    if (filter.folder && (item.folder ?? '') !== filter.folder) return false;
    const text = normalize([item.name,item.folder ?? '',item.language ?? ''].join(' '));
    return terms.every(term => text.includes(term));
  });
}
export function happyScribeResultPage<T extends HappyScribeLibraryItem>(items: readonly T[], page: number, selected?: T) {
  const pages = Math.max(1, Math.ceil(items.length / HAPPY_SCRIBE_RESULT_PAGE_SIZE));
  const index = Math.max(0,Math.min(pages-1,Number.isInteger(page)?page:0));
  const results = items.slice(index*HAPPY_SCRIBE_RESULT_PAGE_SIZE,(index+1)*HAPPY_SCRIBE_RESULT_PAGE_SIZE);
  // Keep the current selection visible even when filtering or paging.
  const pinned = selected && !results.some(item=>item.id===selected.id) ? selected : undefined;
  return { index,pages,results,pinned };
}
export function happyScribeProofExpiry(proof: string | undefined): number | null {
  if (typeof proof !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(proof)) return null;
  const expiry=Number(proof.split('.')[0]);
  return Number.isSafeInteger(expiry)?expiry:null;
}
