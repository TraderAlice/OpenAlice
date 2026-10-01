import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MeasuredText } from './MeasuredText'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from './ui/popover'

export function ContextHelp({ children, label, className }: { children: string; label?: string; className?: string }) {
  const { t } = useTranslation()
  const name = label ? t('common.helpFor', { name: label }) : t('common.help')

  return (
    <Popover>
      <PopoverTrigger
        aria-label={name}
        openOnHover
        delay={250}
        closeDelay={100}
        render={<Button variant="ghost" size="icon-xs" className={cn('shrink-0 text-muted-foreground', className)} />}
      >
        <Info aria-hidden className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-80 max-w-[calc(100vw-2rem)] rounded-xl p-4">
        <PopoverTitle className="sr-only">{name}</PopoverTitle>
        <PopoverDescription>
          <MeasuredText className="block text-sm leading-6">{children}</MeasuredText>
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  )
}
