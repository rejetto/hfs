// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

export type ApiCall = (cmd:string, params:any) => any
type Srp = typeof import('tssrp6a')

export async function srpClientSequence(srp: Srp, username:string, password:string, apiCall: ApiCall, extra?: object) {
    const { pubKey, salt } = await apiCall('loginSrp1', { username })
    if (!salt) throw Error('salt')
    const client = await srpClientPart(srp, username, password, salt, pubKey)
    const res = await apiCall('loginSrp2', { pubKey: String(client.A), proof: String(client.M1), ...extra }) // bigint-s must be cast to string to be json-ed
    await client.step3(BigInt(res.proof)).catch(() => Promise.reject('trust'))
    return res
}

export async function srpClientPart(srp: Srp, username: string, password: string, salt: string, pubKey: string) {
    const srp6aNimbusRoutines = new srp.SRPRoutines(new srp.SRPParameters())
    const srpClient = new srp.SRPClientSession(srp6aNimbusRoutines)
    const res = await srpClient.step1(username, password)
    return await res.step2(BigInt(salt), BigInt(pubKey))
}
