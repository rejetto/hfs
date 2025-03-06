import { i18nFromTranslations } from '../../src/i18n'
import { getHFS, urlParams } from '@hfs/shared'
import { state } from './state'

const i18n = i18nFromTranslations(getHFS().lang || {})
i18n.state.disabled = !urlParams.lang && state.disableTranslation
export default i18n