// Node 25 ships a built-in webstorage that, when launched without a storage
// file, exposes `localStorage` as a bare Object (no Storage prototype, no
// `.clear`). It pre-empts jsdom's Storage implementation. Replace with an
// in-memory polyfill so test code can rely on the full Storage API.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() { return this.store.size }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null }
  getItem(k: string) { return this.store.get(k) ?? null }
  setItem(k: string, v: string) { this.store.set(k, String(v)) }
  removeItem(k: string) { this.store.delete(k) }
  clear() { this.store.clear() }
}

const ls = new MemoryStorage()
const ss = new MemoryStorage()

Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true })
Object.defineProperty(globalThis, 'sessionStorage', { value: ss, configurable: true, writable: true })
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true })
  Object.defineProperty(window, 'sessionStorage', { value: ss, configurable: true, writable: true })
}
