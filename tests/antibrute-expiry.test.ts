import test, { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { makeQ } from '../src/makeQ'

const HOUR = 3_600_000
type Context = { ip: string, state: { account: { username: string } }, set(name: string, value: number): void }
type Login = { ctx: Context, username: string }
type Handlers = {
    attemptingLogin(input: Login & { via: 'srp' }): Promise<unknown>
    failedLogin(input: Login): void
    login(ctx: Context): void
}

function setup(t: TestContext) {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
    let handlers!: Handlers
    const blocked: string[] = []
    const plugin = { config: {} as Record<string, { defaultValue: unknown }>, init(_api: object) {} }
    // isolate plugin state while exercising its public events with real defaults and a controlled clock
    runInNewContext(readFileSync(resolve(__dirname, '../plugins/antibrute/plugin.js'), 'utf8'), {
        exports: plugin, Date, setTimeout, clearTimeout,
    })
    plugin.init({
        misc: { HOUR, isLocalHost: (ctx: Context) => ctx.ip === '127.0.0.1', netMatches: () => false },
        require: () => ({ makeQ }),
        events: { stop: Symbol('stop'), multi: (value: Handlers) => { handlers = value } },
        getConfig: (key: string) => plugin.config[key]!.defaultValue,
        getAccount: (username: string) => ({ username }),
        addBlock: ({ ip }: { ip: string }) => blocked.push(ip),
        log() {},
    })
    const ctx: Context = { ip: '198.51.100.19', state: { account: { username: 'owned' } }, set() {} }
    return { handlers, ctx, blocked }
}

test('antibrute: successful logins cannot erase IP failures against other accounts', t => {
    const { handlers, ctx, blocked } = setup(t)
    for (let i = 0; i < 100; i++) {
        handlers.failedLogin({ ctx, username: `victim-${i}` })
        handlers.login(ctx)
    }
    assert.equal(blocked.length, 0)
    handlers.failedLogin({ ctx, username: 'another-victim' })
    assert.deepEqual(blocked, [ctx.ip])
})

test('antibrute: successful attempts do not extend the IP failure lifetime', async t => {
    const { handlers, ctx, blocked } = setup(t)
    for (let i = 0; i < 100; i++)
        handlers.failedLogin({ ctx, username: 'victim' })
    for (let hour = 1; hour <= 23; hour++) {
        t.mock.timers.tick(HOUR)
        // the accumulated wait is over by hour 2; successful automation continues for the rest of the day
        if (hour < 2) continue
        await handlers.attemptingLogin({ ctx, username: 'owned', via: 'srp' })
        handlers.login(ctx)
    }
    t.mock.timers.tick(HOUR)
    handlers.failedLogin({ ctx, username: 'victim' })
    assert.equal(blocked.length, 0, 'failures survived 24 hours because successful attempts kept arriving')
})

test('antibrute: a new failure renews the IP lifetime', async t => {
    const { handlers, ctx, blocked } = setup(t)
    for (let i = 0; i < 99; i++)
        handlers.failedLogin({ ctx, username: 'victim' })
    t.mock.timers.tick(23 * HOUR)
    handlers.failedLogin({ ctx, username: 'victim' })
    t.mock.timers.tick(HOUR)
    await handlers.attemptingLogin({ ctx, username: 'owned', via: 'srp' })
    handlers.login(ctx)
    handlers.failedLogin({ ctx, username: 'victim' })
    assert.deepEqual(blocked, [ctx.ip], 'recent failures must survive the original expiry')
})

test('antibrute: queued waits cannot outlive the failures', async t => {
    const { handlers, ctx } = setup(t)
    ctx.ip = '127.0.0.1' // localhost is exempt from banning, so failures can accumulate beyond a day
    for (let i = 0; i < 1500; i++)
        handlers.failedLogin({ ctx, username: 'victim' })
    t.mock.timers.tick(24 * HOUR - 1000)
    let reportDelay!: (delay: number) => void
    const delayStarted = new Promise<number>(resolve => { reportDelay = resolve })
    ctx.set = (_name, value) => reportDelay(value)
    const attempt = handlers.attemptingLogin({ ctx, username: 'victim', via: 'srp' })
    const delay = await delayStarted
    t.mock.timers.tick(delay)
    await attempt
    assert.equal(delay, 1000)
    ctx.set = () => assert.fail('expired penalties delayed a subsequent attempt')
    await handlers.attemptingLogin({ ctx, username: 'victim', via: 'srp' })
})

test('antibrute: account reset survives the old record cleanup timer', async t => {
    const { handlers, ctx } = setup(t)
    const username = ctx.state.account.username
    handlers.failedLogin({ ctx, username })
    handlers.login(ctx)
    ctx.ip = '198.51.100.20'
    ctx.set = () => assert.fail('successful login did not reset the account penalty')
    await handlers.attemptingLogin({ ctx, username, via: 'srp' })
    t.mock.timers.tick(HOUR)
    handlers.failedLogin({ ctx, username })
    t.mock.timers.tick(23 * HOUR)
    ctx.ip = '198.51.100.21'
    await handlers.attemptingLogin({ ctx, username, via: 'srp' })
    handlers.failedLogin({ ctx, username })
    let reportDelay!: (delay: number) => void
    const delayStarted = new Promise<number>(resolve => { reportDelay = resolve })
    ctx.set = (_name, value) => reportDelay(value)
    const attempt = handlers.attemptingLogin({ ctx, username, via: 'srp' })
    const delay = await delayStarted
    t.mock.timers.tick(delay)
    await attempt
    assert.equal(delay, 10_000, 'old cleanup timer deleted the replacement account penalties')
})
