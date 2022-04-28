# For developers

## Building instructions

0. Install [Node.js](https://nodejs.org/) 16+
1. Install Typescript: launch `npm -g i typescript`
3. Launch `npm run build-all` in the root

You'll see some warnings about vulnerabilities. Fear not, for those are in the dev tools we are using.
If you want to be assured, run `npm audit --production` that will exclude dev stuff, and you should see something
more reassuring, like "found 0 vulnerabilities", hopefully.

## Dev environment

First `npm install`.

One way of working on sources here is to `npm run watch-server`.
This will give you auto-restarting of the server on back-end changes.
Set an env `DEV=1` to let the code know we are in a dev environment.

If you want to work on the frontend and admin too, you should *first*
1. set an env `FRONTEND_PROXY=3005`
2. `npm run start-frontend`
1. set an env `ADMIN_PROXY=3006`
2. `npm run start-admin`

Having this env-s will make the server get all related stuff from the other dev servers.
Otherwise, you should be sure that frontend and admin have been built, and its files are ready to be used in `dist` folder.
In this latter case, the `DEV=1` you set before will make the server get the files from inside the `dist` folder.

## File formats

General configuration is read by default from file `config.yaml`.
When not specified, default values will be used.
Supported entries are:
- `port` where to accept http connections. Default is 80.
- `vfs` the files and folders you want to expose. For details see the dedicated following section.
- `log` path of the log file. Default is `access.log`.
- `log_rotation` frequency of log rotation. Accepted values are `daily`, `weekly`, `monthly`, or empty string to disable. Default is `weekly`.
- `error_log` path of the log file for errors. Default is `error.log`.
- `errors_in_main_log` if you want to use a single file for both kind of entries. Default is false.
- `accounts` path of the accounts file. Default is `accounts.yaml`.
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
- `allowed_referer` you can decide what domains can link to your files. Wildcards supported. Default is any.
- `block` a list of rules that will block connections. E.g.:
    ```
    block:
      - ip: 192.168.0.90
    ```
  Syntax supports, other than simple address, `*` as wildcard and CIDR format.
- `plugins_config` this is a generic place where you can find/put configuration for each plugin, at least those that need configuration.
- `enable_plugins` if a plugin is not present here, it won't run. Defaults is `[ antibrute ]`.
- `custom_header` provide HTML code to be put at the top of your Frontend. Default is none.
- `localhost_admin` should Admin be accessed without credentials when on localhost. Default is true.
- `proxies` number of proxies between server and clients to be trusted about providing clients' IP addresses. Default is 0.

### Virtual File System (VFS)

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
- `can_see`: specify who can see this entry. Even if a user can download you can still make the file not appear in the list.
  Remember that to see in the list you must also be able to download, or else you won't see it anyway. Value is a `WhoCan` descriptor, refer above.
- `masks`: maps a file mask to a set of properties as the one documented in this section. E.g.
  ```
  masks:
    "**/*.mp3":
      can_read: false
    "*.jpg|*.png": 
      mime: auto
  ```  

## Accounts

All accounts go under `accounts:` key, as a dictionary where the key is the username.
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

## Account options

Other options you can define as properties of an account:

- `ignore_limits` to ignore speed limits. Default is `false`.
- `redirect` provide a URL if you want the user to be redirected upon login. Default is none.
- `admin` set `true` if you want to let this account log in to the Admin interface.
- `belongs` an array of usernames of other accounts from which to inherit their permissions. 
