import { ApiHandlers } from './apis'
import * as api_file_list from './api.file_list'
import * as api_auth from './api.auth'

export const frontEndApis: ApiHandlers = {
    ...api_file_list,
    ...api_auth,
}
