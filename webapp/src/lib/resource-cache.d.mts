export class ResourceCache {
  constructor(ttl?: number, now?: () => number);
  get<T>(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
}
