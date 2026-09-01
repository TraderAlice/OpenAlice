import { useEffect, useState } from 'react'

import { defaultOfficeSpritePack, type OfficeAlicePose } from './sprite-pack'

export type OfficeAliceDirection = 'up' | 'right' | 'down' | 'left'

export function officeAlicePose(
  direction: OfficeAliceDirection,
  walking: boolean,
): OfficeAlicePose {
  return `${walking ? 'walk' : 'idle'}-${direction}` as OfficeAlicePose
}

export function OfficeAliceSprite({
  direction,
  walking,
  sprinting = false,
  reducedMotion,
  label,
  scale = 1,
}: {
  direction: OfficeAliceDirection
  walking: boolean
  sprinting?: boolean
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
      const authoredDuration = pose.durationsMs[index] ?? pose.durationsMs[pose.durationsMs.length - 1] ?? 200
      const duration = sprinting ? Math.round(authoredDuration * 2 / 3) : authoredDuration
      timer = window.setTimeout(() => {
        index = (index + 1) % pose.frames
        setFrame(index)
        tick()
      }, duration)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [action, pose.durationsMs, pose.frames, reducedMotion, sprinting])

  const displayWidth = pose.cell.width * scale
  const displayHeight = pose.cell.height * scale
  return (
    <div
      aria-hidden
      title={label}
      className="shrink-0"
      data-pose={action}
      data-frame={frame}
      data-sprinting={sprinting || undefined}
      style={{
        width: displayWidth,
        height: displayHeight,
        backgroundImage: `url(${pose.sheetUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${pose.atlas.columns * displayWidth}px ${pose.atlas.rows * displayHeight}px`,
        backgroundPosition: `-${(pose.column + frame) * displayWidth}px -${pose.row * displayHeight}px`,
        imageRendering: 'pixelated',
      }}
    />
  )
}
