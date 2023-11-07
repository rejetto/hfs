// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, KeyboardEvent, ReactElement, ReactNode,
    useCallback, useEffect, useRef, useState } from 'react'
import { useIsMounted, useWindowSize } from 'usehooks-ts'
import { Falsy } from '.'

export function useStateMounted<T>(init: T) {
    const isMounted = useIsMounted()
    const [v, set] = useState(init)
    const setIfMounted = useCallback((newValue:T | ((previous:T)=>T)) => {
        if (isMounted())
            set(newValue)
    }, [isMounted, set])
    return [v, setIfMounted, isMounted] as [T, typeof setIfMounted, typeof isMounted]
}

export function reactFilter(elements: any[]) {
    return elements.filter(x=> x===0 || x && (!Array.isArray(x) || x.length))
}

export function reactJoin(joiner: string | ReactElement, elements: Parameters<typeof reactFilter>[0]) {
    const ret = []
    for (const x of reactFilter(elements))
        ret.push(x, joiner)
    ret.splice(-1,1)
    return dontBotherWithKeys(ret)
}

export function dontBotherWithKeys(elements: ReactNode[]): (ReactNode|string)[] {
    return elements.map((e,i)=>
        !e || typeof e === 'string' ? e
            : Array.isArray(e) ? dontBotherWithKeys(e)
                : h(Fragment, { key:i, children:e }) )
}

export function useRequestRender() {
    const [state, setState] = useState(0)
    return Object.assign(useCallback(() =>  setState(x => x + 1), [setState]), { state })
}

/* the idea is that you need a job done by a worker, but the worker will execute only after it collected jobs for some time
    by other "users" of the same worker, like other instances of the same component, but potentially also different components.
    User of this hook will just be returned with the single result of its own job.
    As an additional feature, results are cached. You can clear the cache by calling cache.clear()
*/
export function useBatch<Job=unknown,Result=unknown>(
    worker: Falsy | ((jobs: Job[]) => Promise<Result[]>),
    job: undefined | Job,
    { delay=0 }={}
) {
    interface Env {
        batch: Set<Job>
        cache: Map<Job, Result | null>
        waiter?: Promise<void>
    }
    const worker2env = (useBatch as any).worker2env ||= worker && new Map<typeof worker, Env>()
    const env = worker2env && (worker2env.get(worker) || (() => {
        const ret = { batch: new Set<Job>(), cache: new Map<Job, Result>() } as Env
        worker2env.set(worker, ret)
        return ret
    })())
    const requestRender = useRequestRender()
    useEffect(() => {
        worker && (env.waiter ||= new Promise<void>(resolve => {
            setTimeout(async () => {
                if (!env.batch.size)
                    return resolve()
                const jobs = [...env.batch.values()]
                env.batch.clear()
                const res = await worker(jobs)
                jobs.forEach((job, i) =>
                    env.cache.set(job, res[i] ?? null) )
                env.waiter = undefined
                resolve()
            }, delay)
        })).then(requestRender)
    }, [worker])
    const cached = env && env.cache.get(job) // don't use ?. as env can be falsy
    if (env && cached === undefined)
        env.batch.add(job)
    return { data: cached, ...env } as Env & { data: Result | undefined | null } // so you can cache.clear
}

export function KeepInScreen({ margin, ...props }: any) {
    const ref = useRef<HTMLDivElement>()
    const [maxHeight, setMaxHeight] = useState<undefined | number>()
    const size = useWindowSize()
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const doc = document.documentElement
        const limit = window.innerHeight || doc.clientHeight
        setMaxHeight(limit - rect?.top - margin)
    }, [size])
    return h('div', { ref, style: { maxHeight, overflow: 'auto' }, ...props })
}

const isMac = navigator.platform.match('Mac')
export function isCtrlKey(ev: KeyboardEvent) {
    return (ev.ctrlKey || isMac && ev.metaKey) && ev.key
}