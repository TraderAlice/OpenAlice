import { createContext, type ReactNode } from 'react'

/** The shell supplies one control. A page navigator consumes it and masks it
 * from its content, so nested headers never duplicate global navigation. */
export const PrimaryNavigationContext = createContext<ReactNode>(null)
