import type { CacheEntry } from './types.js'

export class RequestCache {
  private readonly cache: Map<string, CacheEntry<unknown>>
  private readonly maxSize: number
  private readonly keyOrder: string[]

  constructor(maxSize: number = 100) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.keyOrder = []
  }

  set(key: string, value: unknown, ttl: number): void {
    this.removeExpiredEntries()

    if (this.cache.has(key)) {
      const index = this.keyOrder.indexOf(key)
      if (index > -1) {
        this.keyOrder.splice(index, 1)
      }
    }

    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.keyOrder[0]
      if (oldestKey) {
        this.cache.delete(oldestKey)
        this.keyOrder.shift()
      }
    }

    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl,
    })
    this.keyOrder.push(key)
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T>

    if (!entry)
      return null

    if (this.isExpired(entry)) {
      this.delete(key)
      return null
    }

    const index = this.keyOrder.indexOf(key)
    if (index > -1) {
      this.keyOrder.splice(index, 1)
      this.keyOrder.push(key)
    }

    return entry.data
  }

  clear(): void {
    this.cache.clear()
    this.keyOrder.length = 0
  }

  invalidate(pattern: string | RegExp): void {
    const regex = typeof pattern === 'string'
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : pattern

    const keysToDelete: string[] = []

    this.keyOrder.forEach((key) => {
      if (regex.test(key)) {
        keysToDelete.push(key)
      }
    })

    keysToDelete.forEach(key => this.delete(key))
  }

  private isExpired(entry: CacheEntry<unknown>): boolean {
    return Date.now() - entry.timestamp > entry.ttl
  }

  private delete(key: string): void {
    this.cache.delete(key)
    const index = this.keyOrder.indexOf(key)
    if (index > -1) {
      this.keyOrder.splice(index, 1)
    }
  }

  private removeExpiredEntries(): void {
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.delete(key)
      }
    }
  }

  has(key: string): boolean {
    return this.cache.has(key) && !this.isExpired(this.cache.get(key)!)
  }

  size(): number {
    return this.cache.size
  }

  keys(): string[] {
    return [...this.keyOrder]
  }
}
