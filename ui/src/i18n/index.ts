import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'

const resources = {
  en: { translation: en },
  zh: { translation: zh },
}

const getInitialLanguage = (): string => {
  const saved = localStorage.getItem('i18nextLng')
  if (saved && (saved === 'en' || saved === 'zh')) {
    return saved
  }
  
  const browserLang = navigator.language.split('-')[0]
  if (browserLang === 'zh') {
    return 'zh'
  }
  
  return 'en'
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
