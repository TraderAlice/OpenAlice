import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

export interface MobilePageNavigation {
  title: string
  controlsId: string
  expanded: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
  open: () => void
  close: () => void
}

interface MobilePageNavigationOwner {
  token: symbol
  navigation: MobilePageNavigation
}

interface MobilePageNavigationRegistry {
  owner: MobilePageNavigationOwner | null
  register: (owner: MobilePageNavigationOwner) => () => void
}

const MobilePageNavigationContext = createContext<MobilePageNavigationRegistry | null>(null)

export function MobilePageNavigationProvider({ children }: { children: ReactNode }) {
  const [owner, setOwner] = useState<MobilePageNavigationOwner | null>(null)
  const register = useCallback((nextOwner: MobilePageNavigationOwner) => {
    setOwner(nextOwner)
    return () => {
      setOwner((current) => current?.token === nextOwner.token ? null : current)
    }
  }, [])
  const value = useMemo(() => ({ owner, register }), [owner, register])

  return (
    <MobilePageNavigationContext.Provider value={value}>
      {children}
    </MobilePageNavigationContext.Provider>
  )
}

export function useMobilePageNavigation(): MobilePageNavigation | null {
  return useContext(MobilePageNavigationContext)?.owner?.navigation ?? null
}

export function useRegisterMobilePageNavigation(
  navigation: MobilePageNavigation,
  enabled: boolean,
): boolean {
  const registry = useContext(MobilePageNavigationContext)
  const register = registry?.register
  const tokenRef = useRef(Symbol('mobile-page-navigation'))

  useLayoutEffect(() => {
    if (!register || !enabled) return
    return register({
      token: tokenRef.current,
      navigation,
    })
  }, [
    enabled,
    navigation.close,
    navigation.controlsId,
    navigation.expanded,
    navigation.open,
    navigation.title,
    navigation.triggerRef,
    register,
  ])

  return Boolean(register) && enabled
}
