import { useTranslation } from 'react-i18next'
import { SettingsScrollArea } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import { AliceLocationSection } from '../components/settings/AliceLocationSection'
import { MachineManagementSection } from '../components/settings/MachineManagementSection'

export function MachinesSettingsPage() {
  const { t } = useTranslation()
  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader title={t('settings.machines.title')} />
    <SettingsScrollArea>
      <div className="w-full max-w-[1100px] space-y-6">
        <AliceLocationSection />
        <MachineManagementSection />
      </div>
    </SettingsScrollArea>
  </div>
}
