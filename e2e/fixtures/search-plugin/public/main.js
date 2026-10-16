HFS.onEvent('searchFields:', ({ value, onChange }) => HFS.h('input', {
    'aria-label': "File suffix",
    value: value?.suffix || '',
    onChange: event => onChange(event.currentTarget.value ? { suffix: event.currentTarget.value } : undefined),
}))
