import { Socket } from 'net'
import { app } from './index'

interface Connection {
    socket: Socket
    secure: boolean
    started: Date
}

const all: Connection[] = []

export function newConnection(socket: Socket, secure:boolean) {
    const conn: Connection = { socket, secure, started: new Date() }
    all.push(conn)
    app.emit('connection', socket) // we'll use these events for SSE
    socket.on('close', () => {
        all.splice(all.indexOf(conn), 1)
        app.emit('connectionClosed', socket)
    })
}

export function getConnections(): Readonly<typeof all> {
    return all
}
