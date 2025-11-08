// services/cacheService.ts

// Time-to-live for cache entries in milliseconds (e.g., 1 hour)
const CACHE_TTL = 3600 * 1000;
const CACHE_PREFIX = 'gemini_cache_';

interface CacheEntry<T> {
  timestamp: number;
  data: T;
}

/**
 * Retrieves an item from the session cache if it exists and hasn't expired.
 * @param key The key for the cache entry.
 * @returns The cached data or null if not found or expired.
 */
export const getCache = <T>(key: string): T | null => {
  const itemStr = sessionStorage.getItem(CACHE_PREFIX + key);
  if (!itemStr) {
    return null;
  }
  try {
    const item = JSON.parse(itemStr) as CacheEntry<T>;
    const now = new Date().getTime();

    // Check if the item has expired
    if (now - item.timestamp > CACHE_TTL) {
      sessionStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return item.data;
  } catch (error) {
    console.error('Error getting cache item:', error);
    return null;
  }
};

/**
 * Stores an item in the session cache with a timestamp.
 * @param key The key for the cache entry.
 * @param data The data to be stored.
 */
export const setCache = <T>(key: string, data: T): void => {
  const item: CacheEntry<T> = {
    timestamp: new Date().getTime(),
    data,
  };
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(item));
  } catch (error) {
    console.error('Error setting cache item:', error);
    // Handle potential storage full errors
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        // Optionally, implement a cache cleanup strategy here
        console.warn('Cache storage is full. Consider clearing some entries.');
    }
  }
};

/**
 * Creates a consistent cache key from an array of strings or numbers.
 * @param parts The parts to include in the key.
 * @returns A single string key.
 */
export const createCacheKey = (parts: (string | number)[]): string => {
    return parts.join(':');
};
