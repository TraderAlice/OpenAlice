import type { ReactElement } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { buttonVariants } from '../components/ui/button'

interface DemoTerminalStubProps {
  readonly label: string
}

export function DemoTerminalStub({ label }: DemoTerminalStubProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-8 text-muted-foreground">
      <div className="max-w-md text-left space-y-3">
        <div className="font-mono text-sm leading-5 text-muted-foreground/70">
          {label}
        </div>
        <div className="text-base font-semibold text-foreground">
          Agent terminal
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{t('demoBanner.terminal')}</p>
        <div className="pt-2">
          <a
            href="https://github.com/TraderAlice/OpenAlice"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'outline' })}
          >
            <span>{t('demoBanner.install')}</span>
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  )
}
