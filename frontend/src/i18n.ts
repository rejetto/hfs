import { i18nFromTranslations } from '../../src/i18n'
import { getHFS } from '@hfs/shared'

export default i18nFromTranslations(getHFS().lang || {})