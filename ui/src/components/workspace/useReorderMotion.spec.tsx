import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useReorderMotion } from './useReorderMotion'

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
const animateMock = vi.fn<(
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
  options?: number | KeyframeAnimationOptions,
) => Animation>(() => ({
  addEventListener: vi.fn(),
  cancel: vi.fn(),
}) as unknown as Animation)

function rect(top: number, height = 32): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 200,
    bottom: top + height,
    width: 200,
    height,
    toJSON: () => ({}),
  }
}

function Harness({ ids }: { ids: readonly string[] }) {
  const ref = useReorderMotion<HTMLDivElement>(ids)
  return (
    <div ref={ref}>
      {ids.map((id) => <div key={id} data-reorder-id={id}>{id}</div>)}
    </div>
  )
}

beforeEach(() => {
  animateMock.mockClear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const parent = this.parentElement
    if (!parent) return rect(0)
    const index = Array.from(parent.children).indexOf(this)
    return rect(index * 32)
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animateMock,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalAnimate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>)['animate']
  }
})

describe('useReorderMotion', () => {
  it('animates rows from their previous positions after the order changes', () => {
    const view = render(<Harness ids={['a', 'b']} />)
    expect(animateMock).not.toHaveBeenCalled()

    view.rerender(<Harness ids={['b', 'a']} />)

    expect(animateMock).toHaveBeenCalledTimes(2)
    const startTransforms = animateMock.mock.calls.map(([frames]) => (
      (frames as Keyframe[] | null)?.[0]?.transform
    ))
    expect(startTransforms).toContain('translate3d(0, 32px, 0) scale(0.985)')
    expect(startTransforms).toContain('translate3d(0, -32px, 0) scale(0.985)')
  })

  it('does not animate when the operating system requests reduced motion', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    const view = render(<Harness ids={['a', 'b']} />)
    view.rerender(<Harness ids={['b', 'a']} />)

    expect(animateMock).not.toHaveBeenCalled()
  })
})
