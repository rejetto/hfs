This file contains details about the configuration files.

### Where is it stored

Configuration is stored in the file `config.yaml`, exception made for custom HTML which is stored in `custom.html`.

These files are kept in the Current Working Directory (cwd), which is by default the same folder of `hfs.exe`.
if you are using this kind of distribution on Windows, or `USER_FOLDER/.hfs` on other systems.
Many things are stored in the CWD, like the plugins you install.
You can decide a different CWD passing `--cwd SOME_FOLDER` parameter at command line.

If you are not sure what your `cwd` is, look in the console, and you'll see that it is printed in one of the first lines.
Here is an example, look at the 7th line:
```
HFS ~ HTTP File Server - Copyright 2021-2023, Massimo Melina <a@rejetto.com>
License https://www.gnu.org/licenses/gpl-3.0.txt
started 10/5/2023, 10:03:23 AM
version 0.49.0
build 2023-10-04T19:46:22.610Z
pid 27302
cwd /Users/rejetto/.hfs
node v18.17.1
config config.yaml
```

### How to modify configuration

Configuration can be done in several ways
- accessing the Admin-panel with your browser
    - it will automatically open when you start HFS. Bookmark it. if your port is 8000 the address will be http://localhost:8000/~/admin
- passing via command line at start in the form `--NAME VALUE`
- using envs in the form `HFS_NAME` (eg: `HFS_PORT`)
- directly editing the `config.yaml` file. As soon as you save it is reloaded and changes are applied
  - if you don't want to use an editor, consider typing this (example) command inside the folder where the config file is:
    `echo "port: 1080" >> config.yaml` 
- after HFS has started you can enter console command in the form `config NAME VALUE`

`NAME` stands for the property name that you want to change. See the complete list below.

### Configuration properties
- `port` where to accept http connections. Default is 80.
- `vfs` the files and folders you want to expose. For details see the dedicated following section.
- `log` path of the log file. Default is `access.log`.
- `log_rotation` frequency of log rotation. Accepted values are `daily`, `weekly`, `monthly`, or empty string to disable. Default is `weekly`.
- `log_api` should api calls be logged? Default is `true`. 
- `log_gui` should GUI files be logged? Default is `false`. 
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
  [Syntax supports wildcards and more.](https://github.com/rejetto/hfs/wiki/Wildcards#network-masks)
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
- `session_duration` after how many seconds should the login session expire. Default is a day.
- `acme_domain` domain used for ACME certificate generation. Default is none. 
- `acme_email` email used for ACME certificate generation. Default is none.
- `force_base_url` disconnect any connection that's not using the domain used for ACME certificate generation. Default is none.
- `acme_renew` automatically renew acme certificate close to expiration. Default is false.
- `listen_interface` network interface to listen on, by specifying IP address. Default is any.
- `base_url` URL to be used for links generation. Default is automatic.
- `ignore_proxies` stop warning about detected proxies. Default is false. 
- `descript_ion` enable reading and writing of comments in the old file format *DESCRIPT.ION*. Default is yes.
- `descript_ion_encoding` text encoding to be used for file *DESCRIPT.ION*. [List of supported values](https://github.com/ashtuchkin/iconv-lite/wiki/Supported-Encodings). Default is `utf8`.
- `server_code` javascript code that works similarly to [a plugin](dev-plugins.md). 
- `tiles_size` starting value for frontend's tiles size. Default is 0.
- `update_to_beta` includes beta versions searching for updates. Default is false.
- `roots` maps hosts (or mask of hosts) to a root different from the home folder. Default is none. E.g.
  ```
  roots:
    music.domain.com: /music
    image.domain.com: /image
  ``` 
- `roots_mandatory` disconnect any request not made with one of the hosts specified in `roots`. Default is false. 
- `max_downloads` limit the number of concurrent downloads on the whole server. Default is unlimited.
- `max_downloads_per_ip` limit the number of concurrent downloads for the same IP address. Default is unlimited.
- `max_downloads_per_account` limit the number of concurrent downloads for each account. This is enforced only for connections that are logged in, and will override other similar settings. Default is unlimited.
- `geo_enable` when enabled, country is determined for each request/connection. Necessary database will be downloaded every month (2MB).
- `geo_allow` set true if `geo_list` should be treated as white-list, set false for black-list. Default will ignore the list.
- `geo_list` list of country codes to be used as white-list or black-list. Default is empty.
- `geo_allow_unknown` set false to disconnect connections for which country cannot be determined. Works only if `geo_allow` is set. Default is true. 
- `dynamic_dns_url` URL to be requested to keep a domain updated with your latest IP address. Optionally, you can append “>” followed by a regular expression to determine a successful answer, otherwise status code will be used.  
- `create-admin` special entry to quickly create an admin account. The value will be set as password. As soon as the account is created, this entry is removed. 

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
    - `{ this?: WhoCan, children?: WhoCan }`: this form is useful only for folders. By using it, you can have
      different permission for the folder itself and its children. For example, having only the `this` property
      will make the permission limited to the folder and not be inherited by children. Otherwise, having only
      the `children` will make the permission have no effect on the folder, but only on its content.  
        - `this` specifies permission for this folder
        - `children` specifies permission for the content.
- `can_see`: specify who can see this element. Even if a user can download you can still make the file not appear in the list.
  Value is a `WhoCan` descriptor, refer above.
- `can_upload`: specify who can upload. Applies to folders with a source. Default is none.
- `can_delete`: specify who can delete. Applies to folders with a source. Default is none.
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
  Rules on top have priority over bottom rules. Inner rules have priority over parent's rules.
  A mask can carry any node property (even property "masks") plus a special property `maskOnly` (optional) to restrict
  the application of the mask to only files or folders, just by specifying exactly `files` or `folders`

Permissions set on an inner element will override inherited permissions. This means that you can restrict access to folder1,
and yet decide to give free access to folder1/subfolder2.

#### Accounts

All accounts go under `accounts:` property, as a dictionary where the key is the username.
E.g.
```
accounts:
    admin:
        password: hello123
        admin: true
    frank:
        password: another
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
- `disable_password_change` set `true` if you want to forbid password change for users. Default is `false`.

### Specify another file

Do you need to load a different config file, even from a different folder?
Use this parameter at command line `--config PATH` or similarly with an env `HFS_CONFIG`.
The path you specify can be either a folder, or full-path to the file.
