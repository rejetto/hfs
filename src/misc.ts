import { stat } from 'fs/promises'

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