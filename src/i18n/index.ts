import { ja } from './ja'
import { en } from './en'

export const translations = {
  ja,
  en,
}

export type Language = keyof typeof translations
export type Translations = typeof ja
