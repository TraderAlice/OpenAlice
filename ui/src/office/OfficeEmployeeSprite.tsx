import { useEffect, useState } from 'react'

import { defaultOfficeSpritePack, type OfficeEmployeeMood } from './sprite-pack'

export function OfficeEmployeeSprite({
  mood,
  reducedMotion,
  label,
  scale = 0.5,
}: {
  mood: OfficeEmployeeMood
  reducedMotion: boolean
  label: string
  scale?: number
}) {
  const pack = defaultOfficeSpritePack
  const pose = pack.pose(mood)
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
  }, [mood, pose.frames, pose.durationsMs, reducedMotion])

  const displayWidth = pack.cell.width * scale
  const displayHeight = pack.cell.height * scale
  return (
    <div
      aria-hidden
      title={label}
      className="shrink-0"
      style={{
        width: displayWidth,
        height: displayHeight,
        backgroundImage: `url(${pack.sheetUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${pack.atlas.columns * displayWidth}px ${pack.atlas.rows * displayHeight}px`,
        backgroundPosition: `-${frame * displayWidth}px -${pose.row * displayHeight}px`,
        imageRendering: 'pixelated',
      }}
    />
  )
}
