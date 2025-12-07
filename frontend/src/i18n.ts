import { i18nFromTranslations } from '../../src/i18n'
import { EMBEDDED_LANGUAGE, getHFS, urlParams } from '@hfs/shared'
import { state } from './state'

const i18n = i18nFromTranslations(getHFS().lang || {}, EMBEDDED_LANGUAGE)
i18n.state.disabled = !urlParams.lang && state.disableTranslation
export default i18n