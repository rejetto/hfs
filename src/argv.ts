import minimist from 'minimist'

export const argv = minimist(process.argv.slice(2))

// Node's internal flag is read-only when enabled via its CLI, but remains configurable
Object.defineProperty(process, 'traceProcessWarnings', {
    value: argv['trace-warnings'] !== false, writable: true, configurable: true,
})
