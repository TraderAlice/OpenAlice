import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Binary, ChevronDown, MessageSquare, Microscope } from 'lucide-react'
import { PageContentLayout, PageTopBar } from '../components/PageTopBar'
import { Button } from '../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu'
import { AutoPredictionLandingPage, AutoQuantLandingPage, ChatLandingPage } from './ChatLandingPage'

const HARNESS_CHOICES = [
  { id: 'chat', label: 'nav.generalChat', Icon: MessageSquare, Page: ChatLandingPage },
  { id: 'auto-quant', label: 'nav.item.autoQuant', Icon: Microscope, Page: AutoQuantLandingPage },
  { id: 'prediction', label: 'nav.item.autoPrediction', Icon: Binary, Page: AutoPredictionLandingPage },
] as const
type Harness = typeof HARNESS_CHOICES[number]['id']

/** A launch surface only: workspace readiness and Session creation stay in each Harness. */
export function QuickStartPage() {
  const { t } = useTranslation()
  const [harness, setHarness] = useState<Harness>('chat')
  const [drafts, setDrafts] = useState<Record<Harness, string>>({ chat: '', 'auto-quant': '', prediction: '' })
  const selected = HARNESS_CHOICES.find(choice => choice.id === harness)!
  const { Page, Icon } = selected
  return (
    <PageContentLayout title={t('nav.quickStart')}>
      <PageTopBar title={t('nav.quickStart')} actions={(
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={`${t('quickStart.chooseHarness')}: ${t(selected.label)}`} />}>
            <Icon className="size-3.5" aria-hidden />
            <span>{t(selected.label)}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={harness} onValueChange={value => {
              const choice = HARNESS_CHOICES.find(item => item.id === value)
              if (choice) setHarness(choice.id)
            }}>
              {HARNESS_CHOICES.map(choice => (
                <DropdownMenuRadioItem key={choice.id} value={choice.id} closeOnClick>
                  <choice.Icon className="size-3.5" aria-hidden />{t(choice.label)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )} />
      <Page key={harness} spec={{ params: { initialPrompt: drafts[harness] } }} showHeader={false}
        onPromptChange={prompt => setDrafts(previous => ({ ...previous, [harness]: prompt }))} />
    </PageContentLayout>
  )
}
