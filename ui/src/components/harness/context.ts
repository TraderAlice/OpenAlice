import { createContext, useContext } from 'react'
export const HarnessWorkbenchContext = createContext<{ wsId: string; open: boolean; toggle(): void } | null>(null)
export const useHarnessWorkbenchContext = () => useContext(HarnessWorkbenchContext)
