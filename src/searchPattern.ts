import picomatch from 'picomatch/lib/picomatch'
import { hasNestedMatcherQuantifiers } from './cross'
import { createContext, Script } from 'node:vm'
import { basename } from 'path'
import _ from 'lodash'
import { ApiError } from './ApiError'
import { HTTP_BAD_REQUEST } from './cross-const'

const searchMatcherContext = createContext({ makeSearchMatcher, now: () => performance.now(),
    pattern: '', matcher: undefined, value: '', elapsed: undefined })
const compileSearchMatcher = new Script('makeSearchMatcher(pattern)')
const testSearchMatcher = new Script('{ const start = now(); try { matcher(value) } finally { elapsed = now() - start } }')

export function pattern2filter(pattern: string, budget?: { remaining: number }){
    if (!pattern) return () => true
    // short literal terms cannot backtrack, so ordinary searches do not need a timeout per entry
    if (pattern.length <= 128 && !/[^\p{L}\p{N}_. -]/u.test(pattern)) {
        const literal = new RegExp(_.escapeRegExp(pattern), 'i')
        return (value: string) => literal.test(basename(value || ''))
    }
    // a lone wildcard or one next to bounded literal text cannot cause combinatorial backtracking
    if (pattern.length <= 128 && /^(?:\*[\p{L}\p{N}.]*|[\p{L}\p{N}.]+\*)$/u.test(pattern)) {
        const matcher = makeSearchMatcher(pattern)
        return (value: string) => matcher(basename(value || ''))
    }
    searchMatcherContext.pattern = pattern.includes('*') ? pattern // if you specify *, we'll respect its position
        : pattern.split('|').map(x => `*${x}*`).join('|')
    const matcher = run(compileSearchMatcher, 100)
    return (s: string): boolean => {
        if (budget && budget.remaining <= 0)
            throw new ApiError(HTTP_BAD_REQUEST, "Search patterns exceeded the total matching time limit")
        // matching is synchronous, so filters can share the context without retaining each other's state
        searchMatcherContext.matcher = matcher
        searchMatcherContext.value = basename(s || '')
        const result = run(testSearchMatcher, 5)
        if (budget && budget.remaining <= 0)
            throw new ApiError(HTTP_BAD_REQUEST, "Search patterns exceeded the total matching time limit")
        return result
    }

    function run(script: Script, timeout: number) {
        const start = performance.now()
        try {
            // interrupt expensive regexes without changing the supported wildcard grammar
            return script.runInContext(searchMatcherContext, { timeout })
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')
                throw new ApiError(HTTP_BAD_REQUEST, "Search pattern takes too long to evaluate")
            throw error
        }
        finally {
            // charge matching work, excluding watchdog setup and directory I/O shared by otherwise cheap searches
            if (budget && script === testSearchMatcher)
                budget.remaining -= searchMatcherContext.elapsed ?? performance.now() - start
            searchMatcherContext.pattern = ''
            searchMatcherContext.matcher = undefined
            searchMatcherContext.value = ''
            searchMatcherContext.elapsed = undefined
        }
    }
}

export function makeSearchMatcher(mask: string) {
    if (!mask) return () => false
    const wrapped = mask.replace(/^(!)?/, '$1(') + ')'
    const opts: picomatch.PicomatchOptions = { nocase: true, noextglob: true }
    const state = picomatch.parse(wrapped, opts)
    const original = picomatch.compileRe(state, opts)
    if (hasNestedMatcherQuantifiers(original.source)) return () => false
    const outputs = state.tokens.map(token => (token.output ?? token.value)
        + ('suffix' in token ? token.suffix : ''))
    // parser repairs can change output independently of tokens; retain those expressions unchanged
    if (outputs.join('') === state.output) {
        let output = '', pending = '', minimum = 0, hasStar = false
        for (let i = 0; i <= outputs.length; i++) {
            const token = state.tokens[i], part = outputs[i]
            if (token?.type === 'star' && part === '[^/]*?') {
                hasStar = true
                pending += part
            }
            else if (token?.type === 'qmark' && part === '[^/]') {
                minimum++
                pending += part
            }
            else {
                // adjacent wildcards need only a minimum length, unless a raw quantifier binds to the last atom
                if (hasStar || minimum) output += token?.type === 'plus' && part === '+' ? pending
                    : `[^/]{${minimum}${hasStar ? ',' : ''}}${hasStar ? '?' : ''}`
                pending = ''
                minimum = 0
                hasStar = false
                output += part ?? ''
            }
        }
        state.output = output
    }
    const regex = picomatch.compileRe(state, opts)
    return (value: string) => picomatch.test(value, regex, opts, { glob: wrapped }).isMatch
}
