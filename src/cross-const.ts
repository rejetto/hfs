export const SPECIAL_URI = '/~/'
export const FRONTEND_URI = SPECIAL_URI + 'frontend/'
export const ADMIN_URI = SPECIAL_URI + 'admin/'
export const API_URI = SPECIAL_URI + 'api/'
export const PLUGINS_PUB_URI = SPECIAL_URI + 'plugins/'
export const ICONS_URI = SPECIAL_URI + 'icons/'
export const PORT_DISABLED = -1
export const NBSP = '\xA0'
export const PLUGIN_CUSTOM_REST_PREFIX = '_'
export const HFS_REPO = 'rejetto/hfs'
export const UPLOAD_RESUMABLE = 'upload.resumable'
export const UPLOAD_STATUS = 'upload.status'
export const PREVIOUS_TAG = 'previous'

export const HTTP_OK = 200
export const HTTP_NO_CONTENT = 204
export const HTTP_PARTIAL_CONTENT = 206
export const HTTP_MOVED_PERMANENTLY = 301
export const HTTP_TEMPORARY_REDIRECT = 302
export const HTTP_NOT_MODIFIED = 304
export const HTTP_BAD_REQUEST = 400
export const HTTP_UNAUTHORIZED = 401
export const HTTP_FORBIDDEN = 403
export const HTTP_NOT_FOUND = 404
export const HTTP_METHOD_NOT_ALLOWED = 405
export const HTTP_NOT_ACCEPTABLE = 406
export const HTTP_CONFLICT = 409
export const HTTP_PRECONDITION_FAILED = 412
export const HTTP_PAYLOAD_TOO_LARGE = 413
export const HTTP_RANGE_NOT_SATISFIABLE = 416
export const HTTP_FOOL = 418
export const HTTP_FAILED_DEPENDENCY = 424
export const HTTP_TOO_MANY_REQUESTS = 429
export const HTTP_SERVER_ERROR = 500
export const HTTP_SERVICE_UNAVAILABLE = 503

export const HTTP_MESSAGES: Record<number, string> = {
    [HTTP_UNAUTHORIZED]: "Unauthorized",
    [HTTP_FORBIDDEN]: "Forbidden",
    [HTTP_NOT_FOUND]: "Not found",
    [HTTP_SERVER_ERROR]: "Server error",
    [HTTP_TOO_MANY_REQUESTS]: "Too many requests",
}

