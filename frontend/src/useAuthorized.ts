import { state, useSnapState } from './state'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { loginDialog } from './menu'

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

