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
export const UPLOAD_TEMP_PREFIX = 'hfs$upload-'
export const UPLOAD_TEMP_HASH = 'upload-temp-hash'
export const MTIME_CHECK = 'x-mtime-check'
export const PREVIOUS_TAG = 'previous'
export const ALLOW_SESSION_IP_CHANGE = 'allow_session_ip_change'
export const HIDE_IN_TESTS = 'hideInTests' // elements that have variable size, where masking would produce changes, must be hidden
export const MASK_IN_TESTS = 'maskInTests'
export const EMBEDDED_LANGUAGE = 'en' // frontend includes this language in the code, and not need to import the translation-json
export const BASIC_AUTHENTICATE_HEADER = 'Basic realm="HFS"'

export const CFG = constMap([
    'accounts', 'acme_domain', 'acme_renew', 'admin_net', 'allowed_referer', 'authorization_header', 'auto_basic',
    'auto_check_update', 'auto_play_seconds', 'base_url', 'block', 'cache_control_disk_files', 'cert', 'comments_storage',
    'create-admin', 'debug', 'delete_unfinished_uploads_after', 'descript_ion', 'descript_ion_encoding',
    'disable_custom_html', 'disableTranslation', 'dont_log_net', 'dont_overwrite_uploading', 'dynamic_dns_url',
    'enable_plugins', 'error_log', 'favicon', 'file_menu_on_link', 'file_timeout', 'folders_first', 'force_address',
    'force_https', 'force_lang', 'force_webdav_login', 'geo_allow', 'geo_allow_unknown', 'geo_enable', 'geo_list',
    'ignore_proxies', 'invert_order', 'keep_session_alive', 'listen_interface', 'localhost_admin', 'log', 'log_api',
    'log_gui', 'log_host', 'log_rotation', 'log_spam', 'log_ua', 'mapped_port', 'max_downloads',
    'max_downloads_per_account', 'max_downloads_per_ip', 'max_kbps', 'max_kbps_per_ip', 'menu_at_top',
    'mime', 'min_available_mb', 'open_browser_at_start', 'outbound_proxy', 'own_upload_delete_hours', 'page_size',
    'plugins_config', 'port', 'private_key', 'proxies', 'roots', 'server_code', 'session_duration', 'show_hidden_files',
    'show_uploader', 'size_1024', 'smart_unc_folder_detection', 'sort_by', 'sort_numerics', 'split_uploads',
    'suspend_plugins', 'theme', 'tile_size', 'title', 'title_with_path', 'track_ips', 'update_to_beta', 'upnp_enabled',
    'version', 'vfs', 'webdav_initial_auth', 'zip_calculate_size_for_seconds', 'https_port'
])

function constMap<T extends string>(a: T[]): { [K in T]: K } {
    return Object.fromEntries(a.map(x => [x, x])) as { [K in T]: K }
}

export const HTTP_OK = 200
export const HTTP_CREATED = 201
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
export const HTTP_LENGTH_REQUIRED = 411
export const HTTP_PRECONDITION_FAILED = 412
export const HTTP_PAYLOAD_TOO_LARGE = 413
export const HTTP_RANGE_NOT_SATISFIABLE = 416
export const HTTP_FOOL = 418
export const HTTP_LOCKED = 423
export const HTTP_FAILED_DEPENDENCY = 424
export const HTTP_TOO_MANY_REQUESTS = 429
export const HTTP_SERVER_ERROR = 500
export const HTTP_SERVICE_UNAVAILABLE = 503
export const HTTP_INSUFFICIENT_STORAGE = 507

export const HTTP_MESSAGES: Record<number, string> = {
    [HTTP_UNAUTHORIZED]: "Unauthorized",
    [HTTP_FORBIDDEN]: "Forbidden",
    [HTTP_NOT_FOUND]: "Not found",
    [HTTP_SERVER_ERROR]: "Server error",
    [HTTP_TOO_MANY_REQUESTS]: "Too many requests",
}
