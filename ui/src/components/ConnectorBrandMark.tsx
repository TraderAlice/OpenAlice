import { Plug } from 'lucide-react'
import discordIcon from '../assets/connectors/discord.svg'
import feishuIcon from '../assets/connectors/feishu.png'
import slackIcon from '../assets/connectors/slack.svg'
import telegramIcon from '../assets/connectors/telegram.png'

const connectorBrands: Record<string, { src: string; className: string }> = {
  discord: { src: discordIcon, className: 'h-[21px] w-7' },
  telegram: { src: telegramIcon, className: 'size-6' },
  slack: { src: slackIcon, className: 'size-[23px]' },
  feishu: { src: feishuIcon, className: 'size-6' },
}

export function ConnectorBrandMark({
  id,
  className = 'size-6',
}: {
  id: string
  className?: string
}) {
  const brand = connectorBrands[id]
  return (
    <span
      data-connector-glyph
      className={`flex shrink-0 items-center justify-center text-muted-foreground ${className}`}
      aria-hidden
    >
      {brand ? (
        <img
          src={brand.src}
          alt=""
          data-connector-brand={id}
          draggable={false}
          className={`${brand.className} max-h-full max-w-full object-contain`}
        />
      ) : <Plug className="size-[45%]" />}
    </span>
  )
}
