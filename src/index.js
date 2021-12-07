const Koa = require('koa')
const serve = require('koa-static')
const srv = new Koa()

const frontend = serve('frontend')
srv.use((ctx,next) => {
    const rq = ctx.request
    if (rq.method === 'GET' && rq.originalUrl === '/c') {
        ctx.body = 'ciao'
    }
    else
        return frontend(ctx,next)
})
srv.listen(3000)
console.log('running')
/*
body
set(k,v)
* */