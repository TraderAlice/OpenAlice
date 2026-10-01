import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MeasuredText } from './MeasuredText'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from './ui/popover'

export function ContextHelp({ children, label }: { children: string; label?: string }) {
  const { t } = useTranslation()
  const name = label ? t('common.helpFor', { name: label }) : t('common.help')

  return (
    <Popover>
      <PopoverTrigger
        aria-label={name}
        render={<Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" />}
      >
        <Info aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-[calc(100vw-2rem)] p-3">
        <PopoverTitle className="sr-only">{name}</PopoverTitle>
        <PopoverDescription>
          <MeasuredText className="block text-xs leading-5">{children}</MeasuredText>
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  )
}
