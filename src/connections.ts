import { Socket } from 'net'
import events from './events'

export interface Connection {
    socket: Socket
    secure: boolean
    started: Date
    got: number
    sent: number
    outSpeed?: number
}

const all: Connection[] = []

export function newConnection(socket: Socket, secure:boolean=false) {
    const conn: Connection = { socket, secure, got: 0, sent: 0, started: new Date() }
    all.push(conn)
    events.emit('connection', conn) // we'll use these events for SSE
    socket.on('data', data =>
        conn.got += data.length )
    socket.on('close', () => {
        all.splice(all.indexOf(conn), 1)
        events.emit('connectionClosed', conn)
    })
}

export function getConnections(): Readonly<typeof all> {
    return all
}

export function socket2connection(socket: Socket) {
    return all.find(x => // socket exposed by Koa is TLSSocket which encapsulates simple Socket, and I've found no way to access it for simple comparison
        x.socket.remotePort === socket.remotePort // but we can still match them because IP:PORT is key
        && x.socket.remoteAddress === socket.remoteAddress )
}

export function updateConnection(conn: Connection, change: Partial<Connection>) {
    Object.assign(conn, change)
    events.emit('connectionUpdated', conn, change)
}
