import { useTranslation } from 'react-i18next'
import { SettingsScrollArea } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import { MachineManagementSection } from '../components/settings/MachineManagementSection'

export function MachinesSettingsPage() {
  const { t } = useTranslation()
  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader title={t('settings.machines.title')} />
    <SettingsScrollArea className="px-4 py-5 md:px-8">
      <div className="mx-auto w-full max-w-[1100px]">
        <MachineManagementSection />
      </div>
    </SettingsScrollArea>
  </div>
}
