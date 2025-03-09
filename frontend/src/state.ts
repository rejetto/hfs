// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { proxy, useSnapshot } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Dict, FRONTEND_OPTIONS, getHFS, hfsEvent, hIcon, objSameKeys, pathEncode, typedKeys } from './misc'
import { DirEntry as ServerDirEntry } from '../../src/api.get_file_list'

export const state = proxy<typeof FRONTEND_OPTIONS & {
    stopSearch?: ()=>void,
    searchManuallyInterrupted?: boolean,
    iconsReady: boolean,
    username: string,
    accountExp?: string,
    list: DirList,
    filteredList?: DirList,
    clip: DirList
    loading: boolean,
    error?: string,
    listReloader: number,
    patternFilter: string,
    showFilter: boolean,
    selected: { [uri:string]: true }, // by using an object instead of an array, Entry components are not rendered when others get selected
    remoteSearch: Dict<any> | undefined,
    adminUrl?: string,
    loginRequired?: boolean, // force user to login before proceeding
    messageOnly?: string, // no gui, just show this message
    props?: {
        can_upload?: boolean
        accept?: string
        can_delete?: boolean
        can_archive?: boolean
        can_comment?: boolean
        can_overwrite?: boolean
        comment?: string
    }
    canChangePassword: boolean
    uri: string
    uploadOnExisting: 'skip' | 'overwrite' | 'rename'
    expandedUsername: string[]
}>({
    expandedUsername: [],
    uploadOnExisting: getHFS().dontOverwriteUploading ? 'rename' : 'skip',
    uri: '',
    canChangePassword: false,
    props: {},
    ...objSameKeys(FRONTEND_OPTIONS, (v,k) => getHFS()[k] ?? v),
    iconsReady: false,
    username: '',
    list: [],
    clip: [],
    loading: false,
    listReloader: 0,
    patternFilter: '',
    showFilter: false,
    selected: {},
    remoteSearch: undefined,
})

export function useSnapState() {
    return useSnapshot(state)
}

const SETTINGS_KEY = 'hfs_settings'
type StateKey = keyof typeof state
const SETTINGS_WITHOUT_GUI: StateKey[] = ['file_menu_on_link']
const SETTINGS_TO_STORE: StateKey[] = _.difference(typedKeys(FRONTEND_OPTIONS), SETTINGS_WITHOUT_GUI)
    .concat(['uploadOnExisting']) // not adding this to FRONTEND_OPTIONS, as its possible values vary with the user permissions, but still makes sense to save on a single browser, supposedly for a single user

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

export class DirEntry implements ServerDirEntry {
    static FORBIDDEN = 'FORBIDDEN'
    public readonly n: string
    public readonly s?: number
    public readonly m?: Date
    public readonly c?: Date
    public readonly p?: string
    public readonly icon?: string | true
    public readonly web?: true
    public readonly url?: string
    public readonly target?: string
    public readonly order?: number
    public comment?: string
    // we memoize these value for speed
    public readonly name: string
    public readonly uri: string
    public readonly ext: string = ''
    public readonly isFolder: boolean
    public readonly cantOpen?: true | typeof DirEntry.FORBIDDEN
    public readonly key?: string

    constructor(n: string, rest?: any) {
        this.isFolder = n.endsWith('/')
        if (this.isFolder)
            n = n.slice(0, -1)
        Object.assign(this, rest) // we actually allow any custom property to be memorized
        this.n = n // must do it after 'rest' to avoid overwriting
        this.uri = rest?.url || ((!n || n[0] === '/' ? '' : location.pathname) + pathEncode(n) + (this.isFolder ? '/' : ''))
        if (!this.isFolder) {
            const i = n.lastIndexOf('.') + 1
            this.ext = i ? n.substring(i).toLowerCase() : ''
        }
        this.c &&= new Date(this.c)
        this.m = this.m ? new Date(this.m) : this.c
        this.name = n.slice(n.lastIndexOf('/') + 1)
        const x = this.isFolder && !this.web ? 'L' : 'R' // to open we need list for folders and read for files
        this.cantOpen = this.p?.match(x) ? true : this.p?.match(x.toLowerCase()) ? DirEntry.FORBIDDEN : undefined
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
        return hIcon(this.icon === true ? `${this.n}?get=icon` : (this.icon ?? (this.isFolder || this.web ? 'folder' : this.url ? 'link' : ext2type(this.ext) || 'file')))
    }

    canArchive() {
        return this.p?.includes('A') || state.props?.can_archive && !this.p?.includes('a')
    }
    canDelete() {
        return this.p?.includes('D') || state.props?.can_delete && !this.p?.includes('d')
    }
    canSelect() {
        if (this.url) return false
        return this.canArchive() || this.canDelete() // selection is used only by zip and delete, but consider custom logic from plugins
            || hfsEvent('enableEntrySelection', { entry: this }).some(Boolean)
    }
}
export type DirList = DirEntry[]

const exts = {
    image: ['jpeg','jpg','gif','png','webp','svg'],
    audio: ['mp3','wav','m4a','ogg','flac'],
    video: ['mp4','mpeg','mpg','webm','mov','m4v','mkv'],
    archive: ['zip', 'rar', 'gz', 'tgz'],
}

export function ext2type(ext: string) {
    return _.findKey(exts, arr => arr.includes(ext))
}
