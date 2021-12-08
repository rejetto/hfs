import { h, render, Fragment } from 'https://unpkg.com/preact@latest?module';
import { useState, useEffect } from 'https://unpkg.com/preact@latest/hooks/dist/hooks.module.js?module';
export { h, render, Fragment, useState, useEffect }

import { useApi } from './api.js'
//import * as Fluid from 'https://unpkg.com/preact-fluid@latest?module'; console.log(Fluid)

document.addEventListener('DOMContentLoaded', ()=>
    render( h(App), document.body) )

function App() {
    return h(BrowseFiles)
}

function BrowseFiles() {
    return h(Fragment, {},
        h(Head),
        h(FilesList) )
}

function Head() {
    return null
}

function FilesList() {
    const list = useApi('files_list', { path:'/' })
    return h('pre', {}, list ? JSON.stringify(list) : 'list')
}