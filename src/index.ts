import Koa from 'koa'
import serve from 'koa-static'

const srv = new Koa()
const frontend = serve('frontend')
srv.use((ctx,next) => {
    const rq = ctx.request
    if (rq.method === 'GET' && rq.originalUrl === '/c') {
        ctx.body = 'ciao3'
    }
    else
        return frontend(ctx,next)
})
srv.on('error', err => console.error('server error', err))
srv.listen(3000, ()=> console.log('running'))
/*
body
set(k,v)
* */