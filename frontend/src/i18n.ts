import { i18nFromTranslations } from '../../src/i18n'
import { getHFS } from '@hfs/shared'
import { state } from './state'

const i18n = i18nFromTranslations(getHFS().lang || {})
i18n.state.disabled = state.disableTranslation
export default i18n