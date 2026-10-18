// Короткий кэш объединяет одинаковые запросы. Ошибка не блокирует повтор,
// а завершившийся старый запрос не возвращает данные после очистки.
export class ResourceCache {
  constructor(ttl = 15000, now = () => Date.now()) {
    this.ttl = ttl;
    this.now = now;
    this.entries = new Map();
  }
  get(key, load) {
    const entry = this.entries.get(key);
    if (entry && (entry.pending || this.now() - entry.at < this.ttl)) return entry.promise;
    const next = { at: this.now(), pending: true, promise: null };
    next.promise = Promise.resolve().then(load).then((value) => {
      next.pending = false;
      next.at = this.now();
      return value;
    }, (error) => {
      if (this.entries.get(key) === next) this.entries.delete(key);
      throw error;
    });
    if (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, next);
    return next.promise;
  }
  clear() { this.entries.clear(); }
}
