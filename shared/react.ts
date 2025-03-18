// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    createElement as h, Fragment, KeyboardEvent, MutableRefObject, ReactElement, ReactNode,
    useCallback, useEffect, useMemo, useRef, useState
} from 'react'
import { useIsMounted, useWindowSize, useMediaQuery } from 'usehooks-ts'
import { Callback, Falsy } from '.'
import _ from 'lodash'

export function useStateMounted<T>(init: T) {
    const isMounted = useIsMounted()
    const [v, set] = useState(init)
    const ref = useRef(init)
    ref.current = v
    const setIfMounted = useCallback((newValue:T | ((previous:T)=>T)) => {
        if (isMounted())
            set(newValue)
    }, [isMounted, set])
    return [v, setIfMounted, () => ref.current] as const
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
    As an additional feature, results are cached, but you can refresh()
*/
export function useBatch<Job=unknown,Result=unknown>(
    worker: Falsy | ((jobs: Job[]) => Promise<Result[]>),
    job: undefined | Job,
    { delay=0, expireAfter=0 }={}
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
                try {
                    if (!env.batch.size)
                        return
                    const jobs = [...env.batch.values()]
                    env.batch.clear()
                    worker(jobs).then(res => {
                        jobs.forEach((job, i) =>
                            env.cache.set(job, res[i] ?? null) )
                    }).finally(resolve)
                    if (expireAfter)
                        setTimeout(() => {
                            for (const job of jobs)
                                env.cache.delete(job)
                        }, expireAfter)
                }
                finally {
                    env.waiter = undefined
                }
            }, delay)
        })).then(requestRender) // all instances share the same 'waiter', but each instance will call its own 'requestRender'
    }, [worker, requestRender.state])
    const cached = env && env.cache.get(job) // don't use ?. as env can be falsy
    useEffect(() => {
        if (env && cached === undefined) {
            requestRender()
            env.batch.add(job)
        }
    }, [job, cached])
    return {
        data: cached,
        refresh() {
            if (!env) return
            env.batch.add(job)
            requestRender()
        }
    }
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

export function useIsMobile() {
    return useMediaQuery('(pointer:coarse)')
}

// returns props to assign to your component, and a copy of the ref; calls back with [width, height]
export function useOnResize(cb: Callback<[number, number]>) {
    const observer = useMemo(() =>
        new ResizeObserver(_.debounce(([{ contentRect: r, target }]) => {
            const style = getComputedStyle(target)
            const pw = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
            const ph = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
            cb([r.width + pw, r.height + ph])
        }, 10)),
        [])
    const ref = useRef<HTMLElement>()
    return {
        ref,
        refToPass: useCallback((el: any) => {
            observer.disconnect()
            if (el)
                observer.observe(el)
            ref.current = el
        }, [observer])
    }
}

export function useGetSize() {
    const [size, setSize] = useState<[number,number]>()
    const { refToPass, ref } = useOnResize(setSize)
    return useMemo(() => ({
        w: size?.[0],
        h: size?.[1],
        ref,
        refToPass
    }), [size, ref])
}

export function useEffectOnce(cb: Callback, deps: any[]) {
    const state = useRef<any>()
    useEffect(() => {
        if (_.isEqual(deps, state.current)) return
        state.current = deps
        cb(...deps)
    }, deps)
}

type FunctionRef<T=HTMLElement> = (instance: (T | null)) => void
export function passRef<T=any>(el: T, ...refs: (MutableRefObject<T> | FunctionRef<T>)[]) {
    for (const ref of refs)
        if (_.isFunction(ref))
            ref(el)
        else if (ref)
            ref.current = el
}

export function AriaOnly({ children }: { children?: ReactNode }) {
    return children ? h('div', { className: 'ariaOnly' }, children) : null
}

export function noAriaTitle(title: string) {
    return {
        onMouseEnter(ev: any) {
            ev.target.title = title
        }
    }
}
export const isMac = navigator.platform.match('Mac')
export function isCtrlKey(ev: KeyboardEvent) {
    return (ev.ctrlKey || isMac && ev.metaKey) && ev.key
}
