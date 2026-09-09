import { createElement as h, useState } from 'react'
import FileField from '../../admin/src/FileField'

declare global {
    interface Window { pickerStart: string }
}

export default function FileFieldFixture() {
    const [value, setValue] = useState('')
    return h(FileField, { label: 'Path', value, onChange: setValue, defaultPath: window.pickerStart })
}
