import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
    localStorage.setItem('i18nextLng', lang)
  }

  return (
    <div className="flex items-center gap-2">
      <Globe className="w-4 h-4 text-text-muted" />
      <select
        aria-label={t('settings.language')}
        value={i18n.language}
        onChange={(e) => handleLanguageChange(e.target.value)}
        className="bg-bg-secondary text-text text-sm border border-border rounded px-2 py-1 focus:outline-none focus:border-accent"
      >
        <option value="en">{t('settings.english')}</option>
        <option value="zh">{t('settings.chinese')}</option>
      </select>
    </div>
  )
}
