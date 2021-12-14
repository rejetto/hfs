export function enforceFinal(sub:string, s:string) {
    return s.endsWith(sub) ? s : s+sub
}