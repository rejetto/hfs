# HFS: HTTP File Server

HFS is a file server offering a virtual file system (vfs).
You can easily share a single file instead of the whole folder,
or you can rename it, but without touching the real file, just virtually.

Listing files, searching files, zipping folders, it's all very fast, streamed while data is produced, so you don't have to wait. 

This project is in an early stage and distribution will be made easier.

This is a full rewrite of [the Delphi version](https://github.com/rejetto/hfs2).
You won't find all previous features here (yet), but still we got:

# Features
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

# Configuration

At the moment there's no administration UI. You must edit configuration files.

## Config

General configuration is read by default from file `config.yaml`.
When not specified, default values will be used.
Supported entries are:
- `port` where to accept http connections. Default is 80.
- `vfs` the files and folders you want to expose. For details see the dedicated following section.
- `log` path of the log file. Default is `access.log`.
- `error_log` path of the log file for errors. Default is `error.log`.
- `errors_in_main_log` if you want to use a single file for both kind of entries. Default is false.
- `accounts` path of the accounts file. Default is `accounts.yaml`.
- `mime` command what mime-type to be returned with some files. 
    E.g.: `"*.jpg": image/jpeg`
    You can specify multiple entries, or separate multiple file masks with a p|pe.
    You can use the special value `auto` to attempt automatic detection.
- `max_kbps` throttle output speed. Default is Infinity.
- `max_kbps_per_ip` throttle output speed on a per-ip basis. Default is Infinity.
 
## Virtual File System (VFS)

The virtual file system is a tree of files and folders, collectively called *nodes*.
By default a node is folder, unless you provide for it a source that's a file.
Valid keys in a node are: 
- `name`: how to display it. If not provided HFS will infer it from the source.  
- `source`: where to get its content from. Absolute or relative file path, or even http url.
- `children`: just for folders, specify its virtual children.
     Value is a list and its entries are nodes.  
- `hidden`: this must not be listed, but it's still downloadable.
- `hide`: similar to hidden, but it's from the parent node point of view.
     Use this to hide entries that are read from the source, not listed in the VFS.
     Value can be just a file name, a mask, or a list of names/masks. 
- `rename`: similar to name, but it's  from the parent node point.
     Use this to change the name of  entries that are read from the source, not listed in the VFS.
     Value is a dictionary, where the key is the original name.   
- `perm`: specify who can see this.
     Use this to limit access to this node.
     Value is a dictionary, where the key is the username, and the value is `r`.    
- `mime`: specify what mime to use for this resource. Use "auto" for automatic detection.
- `default`: to be used with a folder where you want to serve a default html. E.g.: "index.html". Using this will make `mime` default to "auto".  

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

# Building instructions

0. Install [Node.js](https://nodejs.org/) 16+ 
1. Install Typescript: launch `npm -g i typescript`
3. Launch `npm run build-all` in the root

You'll find the output in `dist` folder.

Now you can run it with `node dist`.

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
This file is javascript module that is supposed to expose one or more of the supported keys:

- `frontend_css: string | string[]` path to one or more css files that you want the frontend to load. These are to be placed in the `public` folder (refer below).
- `frontend_js: string | string[]` path to one or more js files that you want the frontend to load. These are to be placed in the `public` folder (refer below).
- `middleware: (Context) => void | true` a function that will be used as a middleware: it can interfere with http activity.

  To know what the Context object contains please refer to [Koa's documentation](https://github.com/koajs/koa/blob/master/docs/api/context.md).
  You don't get the `next` parameter as in standard Koa's middlewares because this is different, but we are now explaining how to achieve the same results.
  To interrupt other middlewares on this http request, return `true`.
  If you want to execute something in the "upstream" of middlewares, return a function.
  
- `unload: () => void` callback called when unloading a plugin. This is a good place for example to clearInterval().
- `onDirEntry: ({ entry: DirEntry, listPath: string }) => void | false` by providing this callback you can manipulate the record
  that is sent to the frontend (`entry`), or you can return false to exclude this entry from the results.
- `api: object` if your plugin exports an empty object with name `api`, it will be filled with useful functions.
  You'll just need this line
  ```js
  const api = exports.api = {}
  ```
  Now let's have a look at what you'll find inside.
  - `getConfig(key: string): any` this is the way to go if you need some configuration to do your job.
    
    Eg: you want a `message` text. This should be put by the user in the main config file, under the `plugins_config` property.
    If for example your plugin is called `banner`, in the `config.yaml` you should have
    ```yaml
    plugins_config:
      banner:
        message: Hi there!
    ```
    Now you can use `api.getConfig('message')` to read it.

  Beware: `api` object is filled just after plugin initialization. So it will be empty if you use it right-away, but it will
  be good if you use it inside a callback. If you need to do something with it at the very start, then please make your code like this
  ```js
  
  setTimeout(() => { // delay execution just a bit
    console.log('getting my message correctly', api.getConfig('message')) // this is good
  })
  //console.log( api.getConfig('message') ) // this would fail because the api object is still empty
  ```

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
  - parameters `{ entry: Entry }`
  
    The `Entry` type is an object with the following properties:
    - `n: string` name of the entry, including relative path in some cases.
    - `s?: number` size of the entry, in bytes. It may be missing, for example for folders.
    - `t?: Date` generic timestamp, combination of creation-time and modified-time.
    - `c?: Date` creation-time.
    - `m?: Date` modified-time.
  - output `string | void`
  - you receive each entry of the list, and optionally produce HTML code that will be added in the `entry-props` container.  
