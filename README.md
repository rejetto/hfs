# HFS: HTTP File Server

HFS is a file server offering a virtual file system (vfs).
You can easily share a single file instead of the whole folder,
or you can rename it, but without touching the real file, just virtually.

Listing files, searching files, zipping folders, it's all very fast, streamed while data is produced, so you don't have to wait. 

This project is in an early stage and distribution will be made easier.

This is a full rewrite of [the Delphi version](https://github.com/rejetto/hfs2).
You won't find all previous features here (yet), but still we got:

## Features
- https
- unicode
- virtual file system
- mobile friendly front-end
- search
- accounts
- resumable downloads
- download folders as zip archive
- simple website serving
- plug-ins
- log file
- speed throttler
- admin web interface

### Why you should upgrade from HFS 2.x to 3

As you can see from the list above, we already have some goods that you can't find in HFS 2

- https
- fully supports unicode
- more robust
- plugins system
- ZIP format for archives instead of TAR

### Why you should still stay with HFS 2.x (so far)

- smaller
- more tested
- easier to configure (not sure about this anymore)

# Installation

1. go on https://github.com/rejetto/hfs/releases
2. **download** the latest version in a folder you choose
   * if you have Windows, download `exe` version
   * else download release for your system, if available  
3. run the file

If your system is not covered, you can try this alternative version:

1. install node.js version 16+ from https://nodejs.org/
2. download and unzip the latest package named `hfsVERSION.zip` from https://github.com/rejetto/hfs/releases/
3. chmod +x run
4. launch `./run`

# Building instructions

0. Install [Node.js](https://nodejs.org/) 16+ 
1. Install Typescript: launch `npm -g i typescript`
3. Launch `npm run build-all` in the root

You'll see some warnings about vulnerabilities. Fear not, for those are in the dev tools we are using.
If you want to be assured, run `npm audit --production` that will exclude dev stuff, and you should see something
more reassuring, like "found 0 vulnerabilities", hopefully.

# Dev environment

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

# Plug-ins

We are slowly introducing a plug-ins system.
Each plug-in is a sub-folder of `plugins` folder.
You can quickly disable a plug-in by appending `-disabled` to the plug-in's folder name.
Plug-ins can be hot-swapped, and at some extent can be edited without restarting the server. 

Each plug-in has access to the same set of features.
Normally you'll have a plug-in that's a theme, and another that's a firewall,
but nothing is preventing a single plug-in from doing both tasks.

## For plug-in makers

You should find some examples within your installation.

A plug-in must have a `plugin.js` file in its own folder.
This file is javascript module that exports an `init` function like this:
```js
exports.init = api => ({
    frontend_css: 'mystyle.css'
})
```

The init function is called when the module is loaded and should return an object with things to customize.
In this example we are asking a css file to be loaded in the frontend.
The parameter `api` object contains some useful things we'll see later.
Let's first look at the things you can return:

### Things a plugin can return

- `frontend_css: string | string[]` path to one or more css files that you want the frontend to load. These are to be placed in the `public` folder (refer below).
- `frontend_js: string | string[]` path to one or more js files that you want the frontend to load. These are to be placed in the `public` folder (refer below).
- `middleware: (Context) => void | true | function` a function that will be used as a middleware: it can interfere with http activity.

  To know what the Context object contains please refer to [Koa's documentation](https://github.com/koajs/koa/blob/master/docs/api/context.md).
  You don't get the `next` parameter as in standard Koa's middlewares because this is different, but we are now explaining how to achieve the same results.
  To interrupt other middlewares on this http request, return `true`.
  If you want to execute something in the "upstream" of middlewares, return a function.
  
- `unload: function` called when unloading a plugin. This is a good place for example to clearInterval().
- `onDirEntry: ({ entry: DirEntry, listPath: string }) => void | false` by providing this callback you can manipulate the record
  that is sent to the frontend (`entry`), or you can return false to exclude this entry from the results.

### api object

The `api` object you get as parameter of the `init` contains the following:

  - `require: function` use this instead of standard `require` function to access modules already loaded by HFS.

  - `getConfig(key: string): any` this is the way to go if you need some configuration to do your job.
    
    Eg: you want a `message` text. This should be put by the user in the main config file, under the `plugins_config` property.
    If for example your plugin is called `banner`, in the `config.yaml` you should have
    ```yaml
    plugins_config:
      banner:
        message: Hi there!
    ```
    Now you can use `api.getConfig('message')` to read it.
   
  - `srcDir: string` this can be useful if you need to import some extra function not available in `api`.
    ```js
    exports.init = api => {
        const { BUILD_TIMESTAMP } = api.require(api.srcDir + '/const')
        console.log(BUILD_TIMESTAMP)
    }
    ```
    You *should* try to keep this kind of behavior at its minimum, as name of sources and of elements in them are subject to change.
    If you need something for your plugin that's not covered by `api`, you can test it with this method, 
    but you should then discuss it on the forum because an addition to `api` is your best option for making a future-proof plugin. 
    
Each plug-in can have a `public` folder, and its files will be accessible at `/~/plugins/PLUGIN_NAME/FILENAME`.

### Front-end specific

The following information applies to the default front-end, and may not apply to a custom one.

#### Javascript
Once your script is loaded into the frontend (via `frontend_js`), you will have access to the `HFS` object in the global scope.
There you'll find `HFS.onEvent` function that is the base of communication.

`onEvent(eventName:string, callback: (object) => any)` your callback will be called on the specified event.
Depending on the event you'll have an object with parameters in it, and may return some output. Refer to the specific event for further information.

This is a list of available frontend events, with respective parameters and output.

- `additionalEntryProps` 
  - you receive each entry of the list, and optionally produce HTML code that will be added in the `entry-props` container.
  - parameters `{ entry: Entry }`
  
    The `Entry` type is an object with the following properties:
    - `n: string` name of the entry, including relative path in some cases.
    - `s?: number` size of the entry, in bytes. It may be missing, for example for folders.
    - `t?: Date` generic timestamp, combination of creation-time and modified-time.
    - `c?: Date` creation-time.
    - `m?: Date` modified-time.
  - output `string | void`

# File formats

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
- `block` a list of rules that will block connections. At the moment only `ip` rules are supported. E.g.: 
    ```
    block:
      - ip: 192.168.0.90
    ```
- `plugins_config` this is a generic place where you can find/put configuration for each plugin, at least those that need configuration.

## Virtual File System (VFS)

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

# Accounts

Accounts are kept in `accounts.yaml` if any, or you can decide another file by passing parameter `--accounts`.
Inside the file, all accounts should go under `accounts:` key, as a dictionary where the key is the username.
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

As soon as the file is read HFS will encrypt passwords in a non-reversible way. It means that `password` property is replaced with an encrypted property: `srp`.
For this reason HFS needs that your accounts file is writable.

As you can see in the example, `group1` has no password. This implies that you cannot log in as `group1`, but still `group1` exists and its purpose is to
gather multiple accounts and refer to them collectively as `group1`, so you can quickly share powers among several accounts.

## Account options

Other options you can define as properties of an account:

- `ignore_limits` to ignore speed limits. Default is `false`.
- `redirect` provide a URL if you want the user to be redirected upon login. Default is none.
- `admin` set `true` if you want to let this account log in to the Admin interface.
- `belongs` an array of usernames of other accounts from which to inherit their permissions. 

## License

[GPLv3](https://github.com/rejetto/hfs/blob/master/LICENSE.txt).
