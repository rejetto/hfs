// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { proxy, useSnapshot } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { hIcon } from './misc'

export const state = proxy<{
    stopSearch?: ()=>void,
    stoppedSearch?: boolean,
    iconsReady: boolean,
    username: string,
    list: DirList,
    filteredList?: DirList,
    loading: boolean,
    error?: string,
    listReloader: number,
    patternFilter: string,
    showFilter: boolean,
    selected: { [uri:string]: true }, // by using an object instead of an array, Entry components are not rendered when others get selected
    remoteSearch: string,
    sortBy: string,
    invertOrder: boolean,
    foldersFirst: boolean,
    sortNumerics: boolean,
    theme: string,
    adminUrl?: string,
    loginRequired?: boolean, // force user to login before proceeding
    messageOnly?: string, // no gui, just show this message
    can_upload?: boolean
    can_delete?: boolean
    accept?: string
    tiles?: number
}>({
    iconsReady: false,
    username: '',
    list: [],
    loading: false,
    listReloader: 0,
    patternFilter: '',
    showFilter: false,
    selected: {},
    remoteSearch: '',
    sortBy: 'name',
    invertOrder: false,
    foldersFirst: true,
    sortNumerics: false,
    theme: '',
})

export function useSnapState() {
    return useSnapshot(state)
}

const SETTINGS_KEY = 'hfs_settings'
const SETTINGS_TO_STORE: (keyof typeof state)[] = ['sortBy', 'sortNumerics', 'invertOrder', 'foldersFirst', 'theme', 'tiles']

loadSettings()
for (const k of SETTINGS_TO_STORE)
    subscribeKey(state, k, storeSettings)

function loadSettings() {
    const json = localStorage.getItem(SETTINGS_KEY)
    if (!json) return
    let read
    try { read = JSON.parse(json) }
    catch {
        console.error('invalid settings stored', json)
        return
    }
    for (const k of SETTINGS_TO_STORE) {
        const v = read[k]
        if (v !== undefined) // @ts-ignore
            state[k] = v
    }
}

function storeSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(_.pick(state, SETTINGS_TO_STORE)))
}

export class DirEntry {
    public readonly s?: number
    public readonly m?: string
    public readonly c?: string
    public readonly p?: string
    // we memoize these value for speed
    public readonly name: string
    public readonly uri: string
    public readonly ext: string = ''
    public readonly isFolder:boolean
    public readonly t?:Date
    public readonly cantOpen: boolean

    constructor(public readonly n: string, rest?: object) {
        Object.assign(this, rest) // we actually allow any custom property to be memorized
        this.uri = pathEncode(this.n)
        this.isFolder = this.n.endsWith('/')
        if (!this.isFolder) {
            const i = this.n.lastIndexOf('.') + 1
            this.ext = i ? this.n.substring(i).toLowerCase() : ''
        }
        const t = this.m || this.c
        if (t)
            this.t = new Date(t)
        this.name = this.isFolder ? this.n.slice(this.n.lastIndexOf('/', this.n.length - 2) + 1, -1)
            : this.n.slice(this.n.lastIndexOf('/') + 1)
        this.cantOpen = Boolean(this.p?.includes(this.isFolder ? 'l' : 'r'))  // to open we need list for folders and read for files
    }

    getNext() {
        return this.getSibling(+1)
    }
    getPrevious() {
        return this.getSibling(-1)
    }
    getNextFiltered() {
        return this.getSibling(+1, state.filteredList)
    }
    getPreviousFiltered() {
        return this.getSibling(-1, state.filteredList)
    }
    getSibling(ofs: number, list: DirList=state.list) { // i'd rather make this private, but valtio is messing with types, causing problems in FilesList()
        return list[ofs + list.findIndex(x => x.n === this.n)]
    }

    getDefaultIcon() {
        return hIcon(this.isFolder ? 'folder' : ext2type(this.ext) || 'file')
    }
}
export type DirList = DirEntry[]

function pathEncode(s: string) {
    return encodeURI(s).replace(/#/g, encodeURIComponent)
}
//unused function pathDecode(s: string) { return decodeURI(s).replace(/%23/g, '#') }

const exts = {
    image: ['jpeg','jpg','gif','png','webp','svg'],
    audio: ['mp3','wav','m4a','ogg'],
    video: ['mp4','mpeg','mpg','webm','mov','m4v'],
}

export function ext2type(ext: string) {
    return _.findKey(exts, arr => arr.includes(ext))
}
