// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, StrictMode } from 'react'
import ReactDOM from 'react-dom';
import './index.css';
import '@hfs/shared/src/min-crypto-polyfill'
import App from './App';
//import reportWebVitals from './reportWebVitals';

ReactDOM.render( h(StrictMode, {}, h(App)),
  document.getElementById('root'))

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
//reportWebVitals();
