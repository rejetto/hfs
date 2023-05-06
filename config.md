This file contains details the configuration files.

### Configuration properties
- `port` where to accept http connections. Default is 80.
- `vfs` the files and folders you want to expose. For details see the dedicated following section.
- `log` path of the log file. Default is `access.log`.
- `log_rotation` frequency of log rotation. Accepted values are `daily`, `weekly`, `monthly`, or empty string to disable. Default is `weekly`.
- `error_log` path of the log file for errors. Default is `error.log`.
- `errors_in_main_log` if you want to use a single file for both kind of entries. Default is false.
- `dont_log_net` don't include in log entries if IP matches this network mask. Default is `127.0.0.1|::1`.
- `accounts` list of accounts. For details see the dedicated following section.
- `mime` command what mime-type to be returned with some files.
  E.g.: `"*.jpg": image/jpeg`
  You can specify multiple entries, or separate multiple file masks with a p|pe.
  You can use the special value `auto` to attempt automatic detection.
- `max_kbps` throttle output speed. Default is Infinity.
- `max_kbps_per_ip` throttle output speed on a per-ip basis. Default is Infinity.
- `zip_calculate_size_for_seconds` how long should we wait before the zip archive starts streaming, trying to understand its finale size. Default is 1.
- `open_browser_at_start` should HFS open browser on localhost on start? Default is true.
- `https_port` listen on a specific port. Default is 443.
- `cert` use this file for https certificate. Minimum to start https is to give a cert and a private_key. Default is none.
- `private_key` use this file for https private key. Default is none.
- `allowed_referer` you can decide what domains can link to your files. Wildcards supported. Default is empty, meaning any.
- `block` a list of rules that will block connections. E.g.:
    ```
    block:
      - ip: 192.168.0.90
    ```
  Syntax supports, other than simple address, `*` as wildcard and CIDR format.
- `plugins_config` this is a generic place where you can find/put configuration for each plugin, at least those that need configuration.
- `enable_plugins` if a plugin is not present in this list, it won't run. Defaults is `[ antibrute ]`.
- `localhost_admin` should Admin be accessed without credentials when on localhost. Default is true.
- `proxies` number of proxies between server and clients to be trusted about providing clients' IP addresses. Default is 0.
- `delete_unfinished_uploads_after` should unfinished uploads be deleted after a number of seconds. 0 for immediate, empty for never. Default is 1 day.
- `favicon` path to file to be used as favicon. Default is none.
- `force_https` redirect http traffic to https. Requires https to be working. Default is false.
- `force_lang` force translation for frontend. Default is none, meaning *let browser decide*.
- `admin_net` net-mask specifying what addresses are allowed to access Admin-panel. Default is any.
- `title` text displayed in the tab of your browser. Default is "File server".
- `file_menu_on_link` if to display file-menu when clicking on link, or have a dedicated button instead. Default is true.
- `min_available_mb` refuse to accept uploads if available disk space is below this threshold. Default is 100.
- `dont_overwrite_uploading` uploading a file with name already present in the folder will be renamed if this is enabled. Default is false.
- `keep_session_alive` keeps you logged in while the page is left open and the computer is on. Default is true.

#### Virtual File System (VFS)

The virtual file system is a tree of files and folders, collectively called *nodes*.
By default, a node is a folder, unless you provide for it a source that's a file.
Valid keys in a node are:
- `name`: this is the name we'll use to display this file/folder. If not provided, HFS will infer it from the source. At least `name` or `source` must be provided.
- `source`: absolute or relative path of where to get the content
- `children`: just for folders, specify its virtual children.
  Value is a list and its entries are nodes.
- `rename`: similar to name, but it's  from the parent node point.
  Use this to change the name of  entries that are read from the source, not listed in the VFS.
  Value is a dictionary, where the key is the original name.
- `mime`: specify what mime to use for this resource. Use "auto" for automatic detection.
- `default`: to be used with a folder where you want to serve a default html. E.g.: "index.html". Using this will make `mime` default to "auto".
- `can_read`: specify who can download this entry. Value is a `WhoCan` descriptor, which is one of these values
    - `true`: anyone can, even people who didn't log in. This is normally the default value.
    - `false`: no one can.
    - `"*"`: any account can, i.e. anyone who logged in.
    - `[ frank, peter ]`: the list of accounts who can.
- `can_see`: specify who can see this element. Even if a user can download you can still make the file not appear in the list.
  Value is a `WhoCan` descriptor, refer above.
- `can_upload`: specify who can upload. Applies to folders with a source. Default is none.
- `can_delete`: specify who can delete. Applies to folders with a source. Default is none.
- `propagate`: by default, permissions propagate. Use this to stop propagation of some permissions assigned to this node. 
  For each permission you don't want to propagate you specify the name and set it to false. E.g.
  ```
  can_see: false
  ```
  Default is "all propagates".
- `masks`: maps a file mask to a set of properties as the one documented in this section. E.g.
  ```
  myfile.txt:
    can_see: false
    can_read: false
  "**/*.mp3":
    can_read: false
  "*.jpg|*.png": 
    mime: auto
  ```

Permissions set on an inner element will override inherited permissions. This means that you can restrict access to folder1,
and yet decide to give free access to folder1/subfolder2.

#### Accounts

All accounts go under `accounts:` property, as a dictionary where the key is the username.
E.g.
```
accounts:
    admin:
        password: hello123
        belongs: group1
    guest:
        password: guest
    group1:
```

As soon as the config is read HFS will encrypt passwords (if necessary) in a non-reversible way. It means that `password` property is replaced with an encrypted property: `srp`.

As you can see in the example, `group1` has no password. This implies that you cannot log in as `group1`, but still `group1` exists and its purpose is to
gather multiple accounts and refer to them collectively as `group1`, so you can quickly share powers among several accounts.

For each account entries, this is the list of properties you can have:

- `ignore_limits` to ignore speed limits. Default is `false`.
- `redirect` provide a URL if you want the user to be redirected upon login. Default is none.
- `admin` set `true` if you want to let this account log in to the Admin-panel. Default is `false`.
- `belongs` an array of usernames of other accounts from which to inherit their permissions. Default is none.
