// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { SRPClientSession, SRPParameters, SRPRoutines } from 'tssrp6a'

export async function srpClientSequence(username:string, password:string, apiCall: (cmd:string, params:any) => any) {
    const { pubKey, salt } = await apiCall('loginSrp1', { username })
    if (!salt) throw Error('salt')
    const client = await srpClientPart(username, password, salt, pubKey)
    const res = await apiCall('loginSrp2', { pubKey: String(client.A), proof: String(client.M1) }) // bigint-s must be cast to string to be json-ed
    await client.step3(BigInt(res.proof)).catch(() => Promise.reject('trust'))
    return res
}

export async function srpClientPart(username: string, password: string, salt: string, pubKey: string) {
    const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
    const srp = new SRPClientSession(srp6aNimbusRoutines);
    const res = await srp.step1(username, password)
    return await res.step2(BigInt(salt), BigInt(pubKey))
}