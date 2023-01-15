// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { loginDialog } from './login'

export default function useAuthorized() {
    const { loginRequired } = useSnapState()
    const navigate = useNavigate()
    useEffect(() => {
        (async () => {
            while (state.loginRequired)
                await loginDialog(navigate).then()
        })()
    }, [loginRequired, navigate])
    return loginRequired ? null : true
}

