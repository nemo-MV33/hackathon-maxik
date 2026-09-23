export class MemoryCache {
  #items = new Map();

  get(key, { allowStale = false } = {}) {
    const item = this.#items.get(key);
    if (!item) return undefined;
    if (!allowStale && item.expiresAt <= Date.now()) return undefined;
    return item.value;
  }

  set(key, value, ttlMs) {
    this.#items.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }
}
