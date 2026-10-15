import { create } from 'zustand'
import type { SessionRecord } from './api'

export const useSessionDetailsDialog = create<{
  record: SessionRecord | null
  show(record: SessionRecord): void
  close(): void
}>(set => ({ record: null, show: record => set({ record }), close: () => set({ record: null }) }))

