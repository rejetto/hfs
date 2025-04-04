import { DragEvent } from 'react'
import { moveFiles } from './clip'
import { DirEntry } from './state'

let entry = '' // dataTransfer.getData is not available onDragOver, so we use this var to keep track
let accept = false
let classedEl: HTMLElement | undefined
const className = 'drop-over'

export const dragFilesSource = (de: DirEntry) => de.canDelete() ? {
    draggable: true,
    onDragStart(ev: DragEvent) {
        entry = (ev.target as HTMLElement).getAttribute('href') || ''
    },
    ...de.canUpload() && dragFilesDestination,
} : { draggable: false} // avoid showing translucent dom elements, that is the default behavior when dragging

export const dragFilesDestination = {
    onDragOver(ev: DragEvent) {
        if (!accept) return
        ev.preventDefault()
        ev.stopPropagation()
        ev.dataTransfer.dropEffect = 'move' // on most browser this just avoids the "+" icon of the 'copy' operation
    },
    onDrop(ev: DragEvent) {
        classedEl?.classList.remove(className)
        const el = ev.currentTarget as HTMLElement
        const src = entry
        if (!src) return
        const dst = el.getAttribute('href') || '/'
        if (src === dst) return
        ev.preventDefault()
        void moveFiles([src], dst)
    },
    onDragEnter(ev: DragEvent) { // we "accept" here and in dropOver, but this is fired first, so we calculate it here
        accept = false
        const src = entry
        if (!src) return
        const dst = (ev.currentTarget as HTMLElement).getAttribute('href') || '/'
        if (src === dst) return
        accept = true
        const el = ev.currentTarget as HTMLElement
        if (el.tagName !== 'A') return
        classedEl?.classList.remove(className)
        classedEl = el
        el.classList.add(className) // manipulating the dom is a risk with react, and would cause problems if React is changing classes in the meantime, but for now this is not the case, so we keep the code simpler
    },
    onDragLeave(ev: DragEvent) {
        if (ev.relatedTarget && ev.currentTarget.contains(ev.relatedTarget as any)) return // with the nested dom (SPAN in A) we can get a second enter before the leave of the previous, and getting the correct behavior was actually empirical: test thoroughly for any change
        if (!accept) return
        const el = ev.currentTarget as HTMLElement
        if (el !== classedEl) return
        if (el.tagName !== 'A') return
        classedEl?.classList.remove(className)
    },
}