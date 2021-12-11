import glob from 'fast-glob'

export default {
    async files_list(params:any) {
        const res = await glob('.' + (params.path || '/') + '*', {
            stats: true,
            dot: true,
            markDirectories: true,
            onlyFiles: false,
        })
        const list = res.map(x => {
            const o = x.stats
            const folder = x.path.endsWith('/')
            return {
                n: x.name+(folder ? '/' : ''),
                c: o?.ctime,
                m: o?.mtime,
                s: folder ? undefined : o?.size,
            }
        })
        return { list }
    }
}