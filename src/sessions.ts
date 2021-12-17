import { randomUUID } from 'crypto'

const EXP_TIME = 5*60_000

type SessionId = string
class Session {
    id: string
    user?: string
    exp: Date
    constructor(init:Session | string){
        if (typeof init === 'string')
            this.user = init
        else
            Object.assign(this, init)
        this.id = randomUUID()
        this.exp = new Date(Date.now() + EXP_TIME)
    }
}

export const sessions = {
    all: new Map(),
    create(user:string) : Session {
        const sess = new Session(user)
        this.all.set(sess.id, sess)
        setTimeout(()=> this.all.delete(sess.id), EXP_TIME)
        return sess
    },
    get(id:SessionId) : Session | undefined {
        return this.all.get(id)
    },
    refresh(id:SessionId) : Session | undefined {
        let sess = this.get(id)
        if (!sess) return
        this.all.delete(sess.id)
        sess = new Session(sess)
        this.all.set(sess.id, sess)
        return sess
    },
    destroy(id:SessionId) {
        return this.all.delete(id)
    }
}
