/**
 * Issues #218 / #219 / #220 (tg12 external audit):
 *
 * Every browser-direct call to Wikipedia or Wikidata must send the
 * `Api-User-Agent` header that Wikimedia's UA policy asks for. These
 * tests pin that requirement on the shared `lib/wikimediaClient`
 * helper that WikiImage, NewsFeed, and useRegionDossier all route
 * through, so a future refactor that drops the header gets a loud
 * test failure rather than a silent ToS regression.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WIKIMEDIA_API_USER_AGENT,
  fetchWikipediaSummary,
  fetchWikidataSparql,
  _resetWikimediaClientCacheForTests,
} from '@/lib/wikimediaClient';

const originalFetch = globalThis.fetch;

describe('lib/wikimediaClient', () => {
  beforeEach(() => {
    _resetWikimediaClientCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('exposes a stable Api-User-Agent identifier with a contact path', () => {
    expect(WIKIMEDIA_API_USER_AGENT).toContain('Shadowbroker');
    expect(WIKIMEDIA_API_USER_AGENT.toLowerCase()).toContain('github.com');
    expect(WIKIMEDIA_API_USER_AGENT.toLowerCase()).toContain('issues');
  });

  it('sends Api-User-Agent on Wikipedia summary fetch', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          type: 'standard',
          title: 'Boeing 747',
          description: 'aircraft',
          extract: 'long extract',
          thumbnail: { source: 'https://example.org/thumb.jpg' },
        }),
        { status: 200 },
      );
    }) as any;

    const summary = await fetchWikipediaSummary('Boeing 747');
    expect(summary?.thumbnail).toBe('https://example.org/thumb.jpg');
    expect(calls).toHaveLength(1);
    const headers = (calls[0].init?.headers || {}) as Record<string, string>;
    expect(headers['Api-User-Agent']).toBe(WIKIMEDIA_API_USER_AGENT);
  });

  it('sends Api-User-Agent on Wikidata SPARQL fetch', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          results: {
            bindings: [
              {
                leaderLabel: { value: 'Test Leader' },
                govTypeLabel: { value: 'Test Government' },
              },
            ],
          },
        }),
        { status: 200 },
      );
    }) as any;

    const bindings = await fetchWikidataSparql('SELECT * WHERE { ?s ?p ?o }');
    expect(bindings).toHaveLength(1);
    const headers = (calls[0].init?.headers || {}) as Record<string, string>;
    expect(headers['Api-User-Agent']).toBe(WIKIMEDIA_API_USER_AGENT);
    expect(headers['Accept']).toBe('application/sparql-results+json');
  });

  it('shares cache across consecutive callers for the same Wikipedia title', async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      return new Response(
        JSON.stringify({
          type: 'standard',
          title: 'Eiffel Tower',
          description: 'iron lattice tower',
          extract: '...',
          thumbnail: { source: 'https://example.org/eiffel.jpg' },
        }),
        { status: 200 },
      );
    }) as any;

    const a = await fetchWikipediaSummary('Eiffel Tower');
    const b = await fetchWikipediaSummary('Eiffel Tower');
    expect(fetchCount).toBe(1);
    expect(a?.thumbnail).toBe(b?.thumbnail);
  });

  it('deduplicates concurrent in-flight requests for the same title', async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 5));
      return new Response(
        JSON.stringify({
          type: 'standard',
          title: 'Mount Fuji',
          description: 'stratovolcano',
          extract: '...',
          thumbnail: { source: 'https://example.org/fuji.jpg' },
        }),
        { status: 200 },
      );
    }) as any;

    const [a, b, c] = await Promise.all([
      fetchWikipediaSummary('Mount Fuji'),
      fetchWikipediaSummary('Mount Fuji'),
      fetchWikipediaSummary('Mount Fuji'),
    ]);
    expect(fetchCount).toBe(1);
    expect(a?.thumbnail).toBe('https://example.org/fuji.jpg');
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('returns null on disambiguation pages without throwing', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ type: 'disambiguation' }), { status: 200 }),
    ) as any;
    const summary = await fetchWikipediaSummary('Mercury');
    expect(summary).toBeNull();
  });

  it('returns null on HTTP error without throwing', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as any;
    const summary = await fetchWikipediaSummary('Nonexistent Article 12345');
    expect(summary).toBeNull();
  });

  it('returns null on network error without throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as any;
    const summary = await fetchWikipediaSummary('Anything');
    expect(summary).toBeNull();
  });

  it('returns null on empty input', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as any;
    expect(await fetchWikipediaSummary('')).toBeNull();
    expect(await fetchWikipediaSummary('   ')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
