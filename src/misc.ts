import { stat } from 'fs/promises'
import glob from 'fast-glob'
import { objSameKeys } from './obj'

export function enforceFinal(sub:string, s:string) {
    return s.endsWith(sub) ? s : s+sub
}

export function wantArray(x:any) {
    return x == null ? [] : Array.isArray(x) ? x : [x]
}

export async function isDirectory(path: string) {
    try { return (await stat(path)).isDirectory() }
    catch(e) { return false }
}

export function complySlashes(path: string) {
    return glob.escapePath(path.replace(/\\/g,'/'))
}

export function prefix(pre:string, v:string|number, post:string='') {
    return v ? pre+v+post : ''
}

export function setHidden(dest: object, src:object) {
    Object.defineProperties(dest, objSameKeys(src, value => ({ enumerable:false, value })))
}
