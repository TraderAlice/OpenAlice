import { useTranslation } from 'react-i18next'

import { ConfigSection, SettingsScrollArea } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import { Toggle } from '../components/Toggle'
import { useBetaFeatures } from '../live/beta-features'

export function BetaSettingsPage() {
  const { t } = useTranslation()
  const office = useBetaFeatures((state) => state.office)
  const setOffice = useBetaFeatures((state) => state.setOffice)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t('settings.beta.title')} />
      <SettingsScrollArea className="px-4 py-5 md:px-8">
        <div className="mx-auto w-full max-w-[880px]">
          <ConfigSection
            title={t('settings.beta.office')}
            help={t('settings.beta.officeDescription')}
            accessory={
              <Toggle
                size="sm"
                checked={office}
                ariaLabel={t('settings.beta.office')}
                onChange={setOffice}
              />
            }
          />
        </div>
      </SettingsScrollArea>
    </div>
  )
}
