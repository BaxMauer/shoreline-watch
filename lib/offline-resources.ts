export const OFFLINE_DATA_CACHE = "shoreline-watch-offline-data-v1";

export async function loadPersistentJson<T>(url: string, fetcher: typeof fetch = fetch): Promise<T> {
  const cache = "caches" in globalThis ? await caches.open(OFFLINE_DATA_CACHE) : null;
  const cached = await cache?.match(url);
  if (cached) return cached.json() as Promise<T>;

  const response = await fetcher(url);
  if (!response.ok) throw new Error(`${url} could not be loaded.`);
  if (cache) await cache.put(url, response.clone());
  return response.json() as Promise<T>;
}
