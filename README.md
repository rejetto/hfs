# HFS: HTTP File Server

![logo and motto](hfs-logo-color-motto.svg)

## Introduction

HFS is the best way via web to access or share files from your disk.

- It's a server software, share files **fresh from your disk**. Don't rely on services, be independent! 
- It's all very **fast**. Try download zipping 100GB, it starts immediately!
- **Easy to use**. HFS tries to detect problems and suggest solutions.
- Share **even a single file** with our *virtual file system*, even with a different name, all without touching the real file. Present things the way you want!
- **Watch** all activities in real-time.
- **Control bandwidth**, decide how much to give.

This project is in an early stage, few things are missing, but it already rocks!

This is a full rewrite of [the Delphi version](https://github.com/rejetto/hfs2).
You won't find all previous features here (yet), but still we got:

## How does it work

- run HFS on your computer, configuration page automatically shows up
- select what files and folders you want to be accessible
- possibly create accounts and limit access to files
- access those files from a phone or another computer just using a browser

## Features

- https
- unicode
- virtual file system
- mobile friendly front-end
- search
- accounts
- resumable downloads
- resumable uploads
- download folders as zip archive
- simple website serving
- plug-ins
- log file
- speed throttler
- admin web interface
- virtual hosting (plug-in)
- anti-brute-force (plug-in)

## Installation

1. go to https://github.com/rejetto/hfs/releases
2. click on `Assets`
3. **download** the right version for your computer
4. launch `hfs` file
5. the browser should automatically open on `localhost` address, so you can configure the rest in the Admin-panel.
   - if a browser cannot be opened on the computer where you are installing HFS, 
     you should enter this command in HFS console: `create-admin <PASSWORD>`

If you access *Admin-panel* via localhost, by default HFS **won't** require you to login.
If you don't like this behavior, disable it in the Admin-panel or enter this console command `config localhost_admin false`.

### Other systems

If your system is not Windows/Linux/Mac, you can try this alternative version:

0. [install node.js](https://nodejs.org)
1. execute: `sudo npm -g i hfs`
2. launch: `hfs`

Configuration and other files will be stored in `%HOME%/.vfs`

With this installation method, you can update with `sudo npm -g update hfs` .

### Service

If you want to run HFS as a service
- if you installed with `npm` on Windows 
  - service installation
      - run `npx qckwinsvc2 install name="HFS" description="HFS" path="%APPDATA%\npm\node_modules\hfs\src\index.js" args="--cwd %HOMEPATH%\.hfs" now`
  - service update 
    - run `npx qckwinsvc2 uninstall name="HFS"`
    - run `npm -g update hfs`
    - run the service installation again

## Plug-ins

To install a plugin you just copy its folder inside `plugins` folder.

Delete it to uninstall.

HFS will ignore all folders with `-disabled` at the end of the name.

## Why you should upgrade from HFS 2.x to 3

As you can see from the list of features, we already have some goods that you cannot find in HFS 2.
Other than that, you can also consider: 

- it's more robust: it was designed to be an always-running server, while HFS 1-2 was designed for occasional usage (transfer and quit) 
- passwords are never really stored, just a non-reversible hash is
- faster search (up to 12x)
- more flexible permissions

But you may still want to stay with HFS 2.x (so far) for the following reasons

- smaller
- more tested
- classic window interface (can be easier for some people)

## Console commands

If you have access to HFS' console, you can enter commands. Start with `help` to have a full list. 

## Configuration

Configuration can be done in several ways
- accessing the Admin-panel with your browser
  - it will automatically open when you start HFS. Bookmark it. if your port is 8000 the address will be http://localhost:8000/~/admin 
- after HFS has started you can enter console command in the form `config NAME VALUE`
- passing via command line at start in the form `--NAME VALUE`
- directly editing the `config.yaml` file. As soon as you save it is reloaded and changes are applied

`NAME` stands for the property name that you want to change. See the complete list below.

### Where is it stored
Configuration is stored in the file `config.yaml`, which is stored in the same folder of `hfs.exe` if you are using this
kind of distribution on Windows, or `USER_FOLDER/.hfs` on other systems.

You can decide a different file and location by passing `--config SOME_FILE` at command line, or inside
an *env* called `HFS_CONFIG`. Any relative path provided is relative to the *cwd*.  

### Configuration properties
- `port` where to accept http connections. Default is 80.
- `vfs` the files and folders you want to expose. For details see the dedicated following section.
- `log` path of the log file. Default is `access.log`.
- `log_rotation` frequency of log rotation. Accepted values are `daily`, `weekly`, `monthly`, or empty string to disable. Default is `weekly`.
- `error_log` path of the log file for errors. Default is `error.log`.
- `errors_in_main_log` if you want to use a single file for both kind of entries. Default is false.
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
- `enable_plugins` if a plugin is not present here, it won't run. Defaults is `[ antibrute ]`.
- `custom_header` provide HTML code to be put at the top of your Frontend. Default is none.
- `localhost_admin` should Admin be accessed without credentials when on localhost. Default is true.
- `proxies` number of proxies between server and clients to be trusted about providing clients' IP addresses. Default is 0.
- `keep_unfinished_uploads` should unfinished uploads be deleted immediately when interrupted. Default is true.

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
- `can_see`: specify who can see this entry. Even if a user can download you can still make the file not appear in the list.
- `can_upload` specify who can upload. Applies to folders with a source. Default is none. 
  Remember that to see in the list you must also be able to download, or else you won't see it anyway. Value is a `WhoCan` descriptor, refer above.
- `masks`: maps a file mask to a set of properties as the one documented in this section. E.g.
  ```
  masks:
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

## License

[GPLv3](https://github.com/rejetto/hfs/blob/master/LICENSE.txt)
