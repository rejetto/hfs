// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { SRPClientSession, SRPParameters, SRPRoutines } from 'tssrp6a'

export async function srpSequence(username:string, password:string, apiCall: (cmd:string, params:any) => any) {
    const { pubKey, salt } = await apiCall('loginSrp1', { username })
    if (!salt) throw Error('salt')
    const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
    const srp = new SRPClientSession(srp6aNimbusRoutines);
    const resStep1 = await srp.step1(username, password)
    const resStep2 = await resStep1.step2(BigInt(salt), BigInt(pubKey))
    const res = await apiCall('loginSrp2', { pubKey: String(resStep2.A), proof: String(resStep2.M1) }) // bigint-s must be cast to string to be json-ed
    await resStep2.step3(BigInt(res.proof)).catch(() => Promise.reject('trust'))
    return res
}

