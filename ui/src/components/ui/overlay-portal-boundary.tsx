import * as React from 'react'

const OverlayPortalBoundaryContext = React.createContext<HTMLElement | null>(null)

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  if (ref) ref.current = value
}

function OverlayPortalBoundary({
  container,
  children,
}: {
  container: HTMLElement | null
  children: React.ReactNode
}) {
  return (
    <OverlayPortalBoundaryContext.Provider value={container}>
      {children}
    </OverlayPortalBoundaryContext.Provider>
  )
}

function useOverlayPortalBoundary<T extends HTMLElement>(forwardedRef?: React.Ref<T>) {
  const [container, setContainer] = React.useState<T | null>(null)
  const boundaryRef = React.useCallback((node: T | null) => {
    setContainer(node)
    assignRef(forwardedRef, node)
  }, [forwardedRef])

  return { boundaryRef, container }
}

function useOverlayPortalContainer() {
  return React.useContext(OverlayPortalBoundaryContext)
}

export {
  OverlayPortalBoundary,
  useOverlayPortalBoundary,
  useOverlayPortalContainer,
}
