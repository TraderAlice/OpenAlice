import { useEffect, useState, type RefObject } from 'react'

export function readMotionNumber(name: string, fallback: number): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const number = Number.parseFloat(value)
  if (!Number.isFinite(number)) return fallback
  return value.endsWith('s') && !value.endsWith('ms') ? number * 1000 : number
}

export function sampleCssEasing(value: string): (progress: number) => number {
  const presets: Record<string, number[]> = {
    linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1],
  }
  const parsed = value.match(/^cubic-bezier\(([^)]+)\)$/)?.[1].split(',').map(Number)
  const curve = parsed?.length === 4 && parsed.every(Number.isFinite) ? parsed : presets[value.trim()] ?? presets.ease
  const [x1, y1, x2, y2] = curve
  const polynomial = (t: number, a: number, b: number) => (((1 - 3 * b + 3 * a) * t + 3 * b - 6 * a) * t + 3 * a) * t
  return progress => {
    if (progress <= 0 || progress >= 1) return Math.min(1, Math.max(0, progress))
    let lower = 0, upper = 1, parameter = progress
    for (let iteration = 0; iteration < 16; iteration++) {
      parameter = (lower + upper) / 2
      const distance = polynomial(parameter, x1, x2) - progress
      if (Math.abs(distance) < 1e-7) break
      if (distance > 0) upper = parameter
      else lower = parameter
    }
    return polynomial(parameter, y1, y2)
  }
}

export function useMotionActivity(ref: RefObject<HTMLElement | null>, enabled = true): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) { setActive(false); return }
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    let visible = typeof IntersectionObserver === 'undefined'
    const update = () => setActive(visible && !document.hidden && !media?.matches)
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting)
      update()
    })
    observer?.observe(element)
    update()
    media?.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer?.disconnect()
      media?.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [ref, enabled])
  return active
}


export function createNoiseChannels(seed: number): { horizontal: Float32Array; vertical: Float32Array } {
  const horizontal = new Float32Array(4096), vertical = new Float32Array(4096)
  for (let index = 0; index < horizontal.length; index++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    horizontal[index] = seed / 2147483648 - 1
    seed = (seed * 1664525 + 1013904223) >>> 0
    vertical[index] = seed / 2147483648 - 1
  }
  return { horizontal, vertical }
}

function sampleGrid(field: Float32Array, x: number, y: number): number {
  const column = Math.floor(x), row = Math.floor(y)
  let horizontal = x - column, vertical = y - row
  horizontal *= horizontal * (3 - 2 * horizontal)
  vertical *= vertical * (3 - 2 * vertical)
  const x0 = column & 63, x1 = (x0 + 1) & 63
  const y0 = row & 63, y1 = (y0 + 1) & 63
  const top = field[y0 * 64 + x0] + (field[y0 * 64 + x1] - field[y0 * 64 + x0]) * horizontal
  const bottom = field[y1 * 64 + x0] + (field[y1 * 64 + x1] - field[y1 * 64 + x0]) * horizontal
  return top + (bottom - top) * vertical
}

export function sampleNoise(field: Float32Array, x: number, y: number, periodX: number, periodY: number): number {
  return (sampleGrid(field, x / periodX, y / periodY) + 0.5 * sampleGrid(field, x * 2 / periodX + 37.7, y * 2 / periodY + 11.3)) / 1.5
}
