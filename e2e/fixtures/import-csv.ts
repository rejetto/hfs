import { createElement as h } from 'react'
import { importAccountsCsv } from '../../admin/src/importAccountsCsv'
export default function ImportCsvFixture() {
    return h('button', { onClick: () => importAccountsCsv() }, 'Import CSV')
}
