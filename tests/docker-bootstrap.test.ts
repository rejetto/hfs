import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import yaml from 'yaml'

const image = process.env.HFS_DOCKER_TEST_IMAGE
const exec = promisify(execFile)

test('Docker initial admin password, persistence, and legacy compatibility', {
    skip: !image && 'set HFS_DOCKER_TEST_IMAGE to a locally built image', timeout: 120000,
}, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-docker-bootstrap-'))
    const name = 'hfs-bootstrap-' + randomUUID()
    t.after(async () => {
        await docker('rm', '-f', name).catch(() => {})
        await rm(cwd, { recursive: true, force: true })
    })
    for (const scenario of ['multiline', 'empty-legacy', 'initial', 'legacy', 'default']) {
        const data = join(cwd, scenario)
        await mkdir(data)
        const supplied = scenario === 'multiline' ? "quote'\" slash\\ tab\t CR\r\nend\n" : "initial'password"
        const initial = scenario === 'legacy' ? 'legacy-password' : scenario === 'default' ? 'please-change' : supplied
        const env = scenario === 'default' ? [] : ['-e', 'HFS_INITIAL_ADMIN_PASSWORD=' + supplied]
        if (scenario === 'legacy') env.push('-e', 'HFS_CREATE_ADMIN=legacy-password')
        if (scenario === 'empty-legacy') env.push('-e', 'HFS_CREATE_ADMIN=')
        let url = await start(data, env, 8123)
        await ready(initial)
        const before = await persistedVerifier(data)
        assert.equal((await api('set_account', {
            username: 'admin', changes: { password: 'changed-password' },
        }, initial)).status, 200)
        await persistedVerifier(data, before)
        await docker('restart', name)
        // Docker can allocate a different host port when restarting a container with an ephemeral mapping
        url = 'http://' + (await docker('port', name, '8123')).trim()
        const expected = scenario === 'legacy' ? initial : 'changed-password'
        await ready(expected)
        assert.equal((await api('get_accounts', {}, scenario === 'legacy' ? 'changed-password' : initial)).status, 401)
        await docker('rm', '-f', name)
        if (scenario === 'initial' || scenario === 'empty-legacy') {
            // a recreated container must keep credentials but still apply a new HFS_PORT
            url = await start(data, [...env, '-e', 'HFS_INITIAL_ADMIN_PASSWORD=different-password'], 8124)
            await ready('changed-password')
            assert.equal((await api('get_accounts', {}, 'different-password')).status, 401)
            await docker('rm', '-f', name)
        }

        async function ready(password: string) {
            for (let i = 0; i < 100; i++) {
                if (await api('get_accounts', {}, password).then(r => r.status === 200, () => false)) return
                await delay(200)
            }
            assert.fail(`${scenario}: admin login failed; ${await docker('logs', name)}`)
        }
        function api(method: string, body: object, password: string) {
            return fetch(url + '/~/api/' + method, {
                method: 'POST', signal: AbortSignal.timeout(2000),
                headers: { 'Content-Type': 'application/json', 'x-hfs-anti-csrf': '1',
                    Authorization: 'Basic ' + Buffer.from('admin:' + password).toString('base64') },
                body: JSON.stringify(body),
            })
        }
    }

    async function start(data: string, env: string[], port: number) {
        await docker('run', '-d', '--name', name, '-p', `127.0.0.1::${port}`,
            '-v', `${data}:/data`, '-e', `HFS_PORT=${port}`, ...env, image!, '--no-central')
        return 'http://' + (await docker('port', name, String(port))).trim()
    }
})

async function docker(...args: string[]) {
    return (await exec('docker', args, { timeout: 30000 })).stdout
}

async function persistedVerifier(data: string, previous?: string): Promise<string> {
    // authentication uses memory; wait for a complete disk write before comparing credentials or restarting
    for (let i = 0; i < 50; i++) {
        let saved
        try { saved = yaml.parse(await readFile(join(data, 'config.yaml'), 'utf8')) }
        catch {} // reads can overlap the server truncating and rewriting the YAML file
        const verifier = saved?.accounts?.admin?.srp
        if (typeof verifier === 'string' && verifier && verifier !== previous && !saved['create-admin']) return verifier
        await delay(100)
    }
    assert.fail('expected admin credential was not persisted')
}
