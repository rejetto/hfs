import { createElement as h, FormEvent, ReactNode } from 'react'

export default function SearchFieldset({ label, expanded, className, children }: {
    label: string, expanded: boolean, className?: string, children?: ReactNode
}) {
    return h('fieldset', { className, 'aria-label': label },
        h('details', { open: expanded, onInvalidCapture(ev: FormEvent<HTMLDetailsElement>) {
            // reveal invalid fields so the browser can focus them and explain the error
            ev.currentTarget.open = true
        } },
            h('summary', {}, label),
            h('div', { className: 'search-fieldset-content' }, children),
        ),
    )
}
