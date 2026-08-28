import { useEffect, useState } from 'react'

import { defaultOfficeSpritePack, type OfficeAlicePose } from './sprite-pack'

export type OfficeAliceDirection = 'up' | 'right' | 'down' | 'left'

export function officeAlicePose(
  direction: OfficeAliceDirection,
  walking: boolean,
): OfficeAlicePose {
  if (direction === 'up') return 'idle-back'
  if (!walking || direction === 'down') return 'idle'
  return direction === 'left' ? 'walk-left' : 'walk-right'
}

export function OfficeAliceSprite({
  direction,
  walking,
  reducedMotion,
  label,
  scale = 0.5,
}: {
  direction: OfficeAliceDirection
  walking: boolean
  reducedMotion: boolean
  label: string
  scale?: number
}) {
  const pack = defaultOfficeSpritePack
  const action = officeAlicePose(direction, walking)
  const pose = pack.pose(action)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    setFrame(0)
    if (reducedMotion || pose.frames <= 1) return
    let index = 0
    let timer: number
    const tick = () => {
      const duration = pose.durationsMs[index] ?? pose.durationsMs[pose.durationsMs.length - 1] ?? 200
      timer = window.setTimeout(() => {
        index = (index + 1) % pose.frames
        setFrame(index)
        tick()
      }, duration)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [action, pose.durationsMs, pose.frames, reducedMotion])

  const displayWidth = pose.cell.width * scale
  const displayHeight = pose.cell.height * scale
  return (
    <div
      aria-hidden
      title={label}
      className="shrink-0"
      data-pose={action}
      data-frame={frame}
      style={{
        width: displayWidth,
        height: displayHeight,
        backgroundImage: `url(${pose.sheetUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${pose.atlas.columns * displayWidth}px ${pose.atlas.rows * displayHeight}px`,
        backgroundPosition: `-${frame * displayWidth}px -${pose.row * displayHeight}px`,
        imageRendering: 'pixelated',
      }}
    />
  )
}
