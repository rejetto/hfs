import { ApiHandlers } from './apis'
import { file_list } from './api.file_list'
import * as api_auth from './api.auth'

export const frontEndApis: ApiHandlers = {
    file_list,
    ...api_auth,
}
