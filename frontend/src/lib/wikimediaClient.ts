/**
 * wikimediaClient — single fetch surface for Wikipedia / Wikidata.
 *
 * Issues #218, #219, #220 (tg12 external audit):
 *
 * Wikimedia's User-Agent policy asks API clients to identify themselves
 * via `Api-User-Agent` when calling from browser JavaScript (because the
 * browser does not let JS set `User-Agent` directly). Before this
 * module existed, three independent components issued anonymous browser
 * fetches against Wikipedia / Wikidata:
 *
 *   - useRegionDossier  (Wikidata SPARQL + Wikipedia REST summary)
 *   - WikiImage          (Wikipedia REST summary)
 *   - NewsFeed           (Wikipedia REST summary)
 *
 * Each component shipped its own copy-pasted fetch + module-local cache.
 * Provider-policy compliance was missing in all three places.
 *
 * This module centralizes:
 *
 *   1. The `Api-User-Agent` header on every request.
 *   2. A single LRU cache for Wikipedia summary lookups (keyed by article
 *      title).  Multiple components asking for the same article share
 *      one in-flight request and one cache slot.
 *   3. One predictable kill switch — if Wikimedia ever asks us to back
 *      off, we change `WIKIMEDIA_API_USER_AGENT` here and the whole
 *      frontend updates.
 *
 * This does NOT change end-user UX:
 *
 *   - WikiImage still shows the same thumbnails.
 *   - NewsFeed still shows aircraft thumbnails.
 *   - useRegionDossier still returns the same place summary + leader.
 *
 * What changes:
 *
 *   - Wikimedia can identify our traffic from any other anonymous
 *     browser visitor pool.
 *   - Provider-policy fixes happen here once, not in three places.
 */

// Stable identifier per Wikimedia UA policy. Includes a contact path so
// Wikimedia's operators can reach the project if they need to rate-limit
// or coordinate. Bump the version when the contact path changes.
export const WIKIMEDIA_API_USER_AGENT =
  'Shadowbroker/1.0 (+https://github.com/BigBodyCobain/Shadowbroker; ' +
  'report issues at /issues)';

// Module-level cache shared by WikiImage, NewsFeed, and useRegionDossier.
// Keyed by Wikipedia article title (NOT slug — we keep the human-readable
// form so debugging the cache is easier). Values track in-flight state
// so concurrent callers for the same title share one network request.
export interface WikipediaSummary {
  title: string;
  description: string;
  extract: string;
  thumbnail: string;
  type: string; // 'standard' | 'disambiguation' | etc.
}

interface CacheEntry {
  summary: WikipediaSummary | null;
  inflight: Promise<WikipediaSummary | null> | null;
  loaded: boolean;
}

const _summaryCache: Map<string, CacheEntry> = new Map();
const SUMMARY_CACHE_MAX = 512;

function evictIfOverCap() {
  if (_summaryCache.size <= SUMMARY_CACHE_MAX) return;
  const oldest = _summaryCache.keys().next().value;
  if (oldest) _summaryCache.delete(oldest);
}

/** Fetch a Wikipedia article summary (titles, NOT URLs).
 *
 * Empty / invalid input resolves to `null`. Network errors and disambig
 * pages also resolve to `null` so callers can render a fallback without
 * a try/catch. Per the audit's "fail forward, not loud" rule.
 */
export async function fetchWikipediaSummary(
  title: string,
): Promise<WikipediaSummary | null> {
  const trimmed = (title || '').trim();
  if (!trimmed) return null;

  const cached = _summaryCache.get(trimmed);
  if (cached?.loaded) return cached.summary;
  if (cached?.inflight) return cached.inflight;

  const slug = encodeURIComponent(trimmed.replace(/ /g, '_'));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;

  const promise = fetch(url, {
    headers: { 'Api-User-Agent': WIKIMEDIA_API_USER_AGENT },
  })
    .then(async (r) => {
      if (!r.ok) return null;
      const d = await r.json();
      if (d?.type === 'disambiguation') return null;
      const summary: WikipediaSummary = {
        title: trimmed,
        description: d?.description || '',
        extract: d?.extract || '',
        thumbnail: d?.thumbnail?.source || d?.originalimage?.source || '',
        type: d?.type || 'standard',
      };
      return summary;
    })
    .catch(() => null)
    .then((summary) => {
      _summaryCache.set(trimmed, { summary, inflight: null, loaded: true });
      evictIfOverCap();
      return summary;
    });

  _summaryCache.set(trimmed, { summary: null, inflight: promise, loaded: false });
  evictIfOverCap();
  return promise;
}

/** Fetch a Wikidata SPARQL query result.
 *
 * Returns the parsed JSON `results.bindings` array on success; `null`
 * (not throwing) on any failure so callers can render fallbacks
 * silently. Kept as a thin wrapper so the audit-required UA header is
 * applied in exactly one place.
 */
export async function fetchWikidataSparql<T = Record<string, { value: string }>>(
  sparql: string,
): Promise<T[] | null> {
  const trimmed = (sparql || '').trim();
  if (!trimmed) return null;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(
    trimmed,
  )}&format=json`;
  try {
    const res = await fetch(url, {
      headers: {
        'Api-User-Agent': WIKIMEDIA_API_USER_AGENT,
        Accept: 'application/sparql-results+json',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const bindings = json?.results?.bindings;
    return Array.isArray(bindings) ? (bindings as T[]) : null;
  } catch {
    return null;
  }
}

/** Internal: clear the shared cache. Exposed for tests only. */
export function _resetWikimediaClientCacheForTests() {
  _summaryCache.clear();
}
