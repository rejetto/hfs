# For plug-in makers

If the information you are searching for is not in this document, [please ask](https://github.com/rejetto/hfs/discussions). 

A plug-in is a folder with a `plugin.js` file in it. To install a plugin you just copy the folder into `plugins` folder.
You will find `plugins` folder near `config.yaml`, and then in `USER_FOLDER/.hfs` for Linux and Mac, or near `hfs.exe` on Windows. 

Plug-ins can be hot-swapped, and at some extent can be edited without restarting the server.

Each plug-in has access to the same set of features.
Normally you'll have a plug-in that's a theme, and another that's a firewall,
but nothing is preventing a single plug-in from doing both tasks.

## Exported object
`plugin.js` is a javascript module (executed by Node.js), and its main way to communicate with HFS is by exporting things.
For example, it can define its description like this 
```js
exports.description = "I'm a nice plugin"
```

The set of things exported goes by the name "exported object".
A plugin can define an `init` function like this:
```js
exports.init = api => ({
    frontend_css: 'mystyle.css'
})
```

The init function is called by HFS when the module is loaded and should return an object with more things to
add/merge to the exported object. In the example above we are asking a css file to be loaded in the frontend.
Since it's a basic example, you could have simply defined it like this:
```js
exports.frontend_css = 'mystyle.css'
```
but in more complex cases you'll need go through the `init`.
Thus, you can decide to return things in the `init` function, or directly in the `exports`.
If you need to access the api you must use `init`, since that's the only place where it is found, otherwise you
can go directly with `exports`. The parameter `api` of the init is an object containing useful things [we'll see later](#api-object).

Let's first look at the things you can export:

## Things a plugin can export

All the following properties are optional unless otherwise specified.

- `description: string` try to explain what this plugin is for. (JSON syntax)
- `version: number` use progressive numbers to distinguish each release
- `apiRequired: number | [min:number,max:number]` declare version(s) for which the plugin is designed for. Mandatory. [Refer to API version history](#api-version-history)   
- `isTheme: boolean | "light" | "dark"` set true if this is a theme that's not supposed to work together with other themes. 
  Running a theme will cause other themes to be stopped. Missing this, HFS will check if the name of the plugin ends with `-theme`.
  Special values "light" and "dark" to declare the theme is (for example) dark and forces HFS to use dark-theme as a base.   
- `preview: string | string[]` one or more URLs to images you want to show before your plugin is downloaded. (JSON syntax) 
- `depend: { repo: string, version: number }[]` declare what other plugins this depends on. (JSON syntax)
- `repo: string | object` pointer to a GitHub repo where this plugin is hosted. (JSON syntax)
    - the string form is for GitHub repos. Example: "rejetto/file-icons"
    - the object form will point to other custom repo. Object properties:
        - `web: string` link to a web page
        - `main: string` link to the plugin.js (can be relative to `web`)
        - `zip: string` link to the zip with the whole plugin (can be relative to `web`)
        - `zipRoot: string` optional, in case the plugin in the zip is inside a folder

      Example:
      ```
      { 
        "web": "https://github.com/rejetto/file-icons", 
        "zip": "/archive/refs/heads/main.zip",
        "zipRoot: "file-icons-main/dist", 
        "main": "https://raw.githubusercontent.com/rejetto/file-icons/main/dist/plugin.js" 
      }
      ```
      Note that in this example we are pointing to a github repo just for clarity. You are not supposed to use this
      complicated object form to link github, use the string form.
      Plugins with custom repos are not included in search results, but the update feature will still work.

WARNING: All the properties above are a bit special and must go in `exports` only (thus, not returned in `init`) and the syntax
used must be strictly JSON (thus, no single quotes, only double quotes for strings and objects), and must fit one line.

- `init` described in the previous section. 
- `frontend_css: string | string[]` path to one or more css files that you want the frontend to load. These are to be placed in the `public` folder (refer below).
  You can also include external files, by entering a full URL. Multiple files can be specified as `['file1.css', 'file2.css']`.  
- `frontend_js: string | string[]` path to one or more js files that you want the frontend to load. These are to be placed in the `public` folder (refer below).
  You can also include external files, by entering a full URL.
- `middleware: (Context) => Promisable<void | true | function>` a function that will be used as a middleware: use this to interfere with http activity.
  
  ```js
  exports.middleware = ctx => {
    ctx.body = "You are in the wrong place"
    ctx.status = 404
  }
  ```
  You'll find more examples by studying plugins like `antidos` or `antibrute`.
  To interrupt other middlewares on this http request, return `true`.
  If you want to execute something in the "upstream" of middlewares, return a function. This function can be async.
  You can read more in [the ctx object](#the-ctx-object) section.

- `unload: function` called when unloading a plugin. This is a good place for example to clearInterval().
- `onDirEntry: ({ entry: DirEntry, listUri: string }) => Promisable<void | false>` by providing this callback you can manipulate
  the record that is sent to the frontend (`entry`), or you can return false to exclude this entry from the results.
  Refer to source `frontend/src/state.ts`.
- `config: { [key]: FieldDescriptor }` declare a set of admin-configurable values owned by the plugin
  that will be displayed inside Admin-panel for change. Each property is identified by its key,
  and the descriptor is another object with options about the field. 

  Eg: you want a `message` text. You add this to your `plugin.js`:
  ```js
  exports.config = { message: {} }
  ``` 

  Once the admin has chosen a value for it, the value will be saved in the main config file, under the `plugins_config` property.
    ```yaml
    plugins_config:
      name_of_the_plugin:
        message: Hi there!
    ```
  When necessary your plugin will read its value using `api.getConfig('message')`.

- `configDialog: DialogOptions` object to override dialog options. Please refer to sources for details.
- `onFrontendConfig: (config: object) => void | object` manipulate config values exposed to front-end 

### FieldDescriptor

Currently, these properties are supported:
- `type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect' | 'real_path' | 'array' | 'username'ì` . Default is `string`.
- `label: string` what name to display next to the field. Default is based on `key`.
- `defaultValue: any` value to be used when nothing is set.
- `helperText: string` extra text printed next to the field.
- `frontend: boolean` expose this setting on the frontend, so that javascript can access it as
   `HFS.getPluginConfig()[CONFIG_KEY]` but also css can access it as `var(--PLUGIN_NAME-CONFIG_KEY)`

Based on `type`, other properties are supported:
- `string`
    - `multiline: boolean`. Default is `false`.
- `number`
    - `min: number`
    - `max: number`
- `select`
    - `options: { [label]: AnyJsonValue }`
- `multiselect` it's like `select` but its result is an array of values.
- `array` list of objects
    - `fields`: an object of `FieldDescriptor`s, i.e. same format as `config`.
      This field will be use for both the configuration of the grid's column, and the form's field.
      Other than properties of `FieldDescriptor` you get these extra properties:
        - `$column`: where you can put all the properties you want specifically to be set on the [grid's column](https://mui.com/x/api/data-grid/grid-col-def/).
        - `$width`: a shortcut property that can substitute `$column: { width }` or `$column: { flex }`.
          By default, a column gets flex:1 unless you specify $width. A value of 8 and higher is considered width's pixels,
          while lower are flex-values.
- `real_path` path to server disk
    - `files: boolean` allow to select a file. Default is `true`.
    - `folders: boolean` allow to select a folder. Default is `false`.
    - `defaultPath: string` what path to start from if no value is set. E.g. __dirname if you want to start with your plugin's folder.
    - `fileMask: string` restrict files that are displayed. E.g. `*.jpg|*.png`
- `username`

## api object

The `api` object you get as parameter of the `init` contains the following:

- `getConfig(key?: string): any` get plugin's config value, described in `exports.config`.
  If key is not provided, an object with all keys is returned. 
  
- `setConfig(key: string, value: any)` set plugin's config value.

- `subscribeConfig(key: string, callback: (value: any) => void): Unsubscriber`
  will call `callback` with initial value and then at each change.

- `getHfsConfig(key: string): any` similar to getConfig, but retrieves HFS' config instead.

- `log(...args)` print log in a standard form for plugins.

- `Const: object` all constants of the `const.ts` file are exposed here. E.g. BUILD_TIMESTAMP, API_VERSION, etc.

- `getConnections(): Connections[]` retrieve current list of active connections.

- `storageDir: string` folder where a plugin is supposed to store run-time data. This folder is preserved during
  an update of the plugin, while the rest could be deleted.

- `events` this is the main events emitter used by HFS.
  These are backend side events, not to be confused with frontend ones. It's not the standard EventEmitter class,
  and the API is slightly different.

    - `events.on(name: string, listener: Callback): Callback`

      call your listener every time the event is emitted.
      The returned callback will unsubscribe the event.

    - `events.once(name: string, listener?: Callback): Promise<eventArguments>`

      when the event is emitted, your (optional) listener is called, and the returned promise is resolved.

- `require(module: string)` use this instead of standard `require` function to access modules already loaded by HFS. Example:
  ```js
  const { watchLoad } = api.require('./watchLoad')
  ```
  You *should* try to keep this kind of behavior at its minimum, as name of sources and elements can change, and your
  plugin can become incompatible with future versions.
  If you need something for your plugin that's not covered by `api`, you can test it with this method, but you should
  then discuss it on the forum because an addition to `api` is your best option for making a future-proof plugin.

- `customApiCall(method: string, ...params): any[]` this will invoke other plugins if they define `method`
  exported inside `customApi: object`

- `openDb(filename, options): Promise<{ get, put, del, close, unlink, sublevel }>` LevelDB-like class for storage.
  The specified file name will be stored in the "storage" folder of the plugin, by default.
  Refer to [dedicated documentation](https://www.npmjs.com/package/@rejetto/kvstorage) for details.

- `notifyClient(channel: string, eventName: string, data?: any)` send a message to those frontends that are on the same channel.

## Front-end specific

The following information applies to the default front-end, and may not apply to a custom one.

Once your script is loaded into the frontend (via `frontend_js`), you will have access to the `HFS` object in the global scope.

The HFS objects contains many properties:
- `onEvent` this is the main API function inside the frontend. Refer to dedicated section below.
- `apiCall`
- `useApi`
- `reloadList`
- `logout`
- `prefixUrl: string` normally an empty string, it will be set in case a [reverse-proxy wants to mount HFS on a path](https://github.com/rejetto/hfs/wiki/Reverse-proxy).
- `state` [object with many values in it](https://github.com/rejetto/hfs/blob/main/frontend/src/state.ts)
- `watchState: (key: string, callback)=>function`
    - watch the `key` property of the state object above
    - `callback(newValue)` will be called at each change
    - use returned callback to stop watching
- `React` whole React object, as for `require('react')` (JSX syntax is not supported here)
- `h` shortcut for React.createElement
- `t` [translator function](https://github.com/rejetto/hfs/blob/main/frontend/src/i18n.ts)
- `_` [lodash library](https://lodash.com/docs/)
- `toast: (message: string | ReactElement, type: ToastType='info')`
    - show a brief message that doesn't steal focus
    - `ToastType = 'error' | 'warning' | 'info' | 'success'`
- `dialogLib` this exposes all functions available in [dialog.ts](https://github.com/rejetto/hfs/blob/main/frontend/src/dialog.ts), for example alertDialog and newDialog. These are not documented yet, and subject to change without notification, but you can study the sources if you are interested in using them.
- `misc` many functions and constants available in [cross.ts](https://github.com/rejetto/hfs/blob/main/src/cross.ts). These are not documented, probably never will, and are subject to change without notifications, but you can study the sources if you are interested in using them.
- `navigate: (uri: string): void` use this if you have to change the page address without causing reload
- `emit: (name: string, params?: object) => any[]` use this to emit a custom event. Prefix name with your plugin name to avoid conflicts.
- `Icon: ReactComponent` Properties:
    - `name: string` refer to file `icons.ts` for names, but you can also enter an emoji instead.
- `useBatch: (worker, job) => any`
- `getNotifications(channel: string, cb: (eventName: string, data:any) => void)`
  receive messages when the backend uses `notifyClient` on the same channel. 

The following properties are accessible only immediately at top-level; don't call it later in a callback.
- `getPluginConfig()` returns object of all config keys that are declared frontend-accessible by this plugin.
- `getPluginPublic()` returns plugin's public folder, with final slash. Useful to point to public files.

### Front-end API events

API at this level is done with frontend-events, that you can handle by calling

```typescript
HFS.onEvent(eventName, callback)

//type callback = (parameters: object) => any
``` 

Parameters of your callback and meaning of returned value varies with the event name.
Refer to the specific event for further information.
HFS object is the same you access globally. Here just for legacy, consider it deprecated.

Some frontend-events can return Html, which can be expressed in several ways
- as string, containing markup
- as DOM Nodes, as for document.createElement()
- as ReactElement
- as array of ReactNode
- null, undefined, false and empty-string will just be discarded

These events will receive a `def` property, with the default content that will be displayed if no callback return
a valid output. You can decide to embed such default content inside your content.
You can produce output for such events also by adding sections (with same name as the event) to file `custom.html`.

This is a list of available frontend-events, with respective object parameter and output.

- `additionalEntryDetails`
    - you receive each entry of the list, and optionally produce HTML code that will be added in the `entry-details` container.
    - parameter `{ entry: Entry }`

      The `Entry` type is an object with the following properties:
        - `name: string` name of the entry.
        - `ext: string` just the extension part of the name, dot excluded and lowercase.
        - `isFolder: boolean` true if it's a folder.
        - `n: string` name of the entry, including relative path when searched in sub-folders.
        - `uri: string` relative url of the entry.
        - `s?: number` size of the entry, in bytes. It may be missing, for example for folders.
        - `t?: Date` generic timestamp, combination of creation-time and modified-time.
        - `c?: Date` creation-time.
        - `m?: Date` modified-time.
        - `p?: string` permissions missing
        - `cantOpen: boolean` true if current user has no permission to open this entry
        - `getNext/getPrevious: ()=>Entry` return next/previous Entry in list
        - `getNextFiltered/getPreviousFiltered: ()=>Entry` as above, but considers the filtered-list instead
        - `getDefaultIcon: ()=>ReactElement` produces the default icon for this entry
    - output `Html`
- `entry`
    - you receive each entry of the list, and optionally produce HTML code that will completely replace the entry row/slot.
    - parameter `{ entry: Entry }` (refer above for Entry object)
    - output `Html`
- `afterEntryName`
    - you receive each entry of the list, and optionally produce HTML code that will be added after the name of the entry.
    - parameter `{ entry: Entry }` (refer above for Entry object)
    - output `Html`
- `entryIcon`
    - you receive an entry of the list and optionally produce HTML that will be used in place of the standard icon.
    - parameter `{ entry: Entry }` (refer above for Entry object)
    - output `Html`
- `beforeHeader` & `afterHeader`
    - use this to produce content that should go right before/after the `header` part
    - output `Html`
- `beforeLogin`
    - no parameter
    - output `Html`
- `fileMenu`
    - add or manipulate entries of the menu. If you return something, that will be added to the menu.
      You can also delete or replace the content of the `menu` array.
    - parameter `{ entry: Entry, menu: FileMenuEntry[], props: FileMenuProp[] }`
    - output `undefined | FileMenuEntry | FileMenuEntry[]`
      ```typescript
      interface FileMenuEntry {
          id?: string, 
          label: ReactNode,
          subLabel: ReactNode,
          href?: string, // use this if you want your entry to be a link
          icon?: string, // supports: emoji, name from a limited set
          onClick?: () => (Promisable<boolean>) // return false to not close menu dialog
          //...rest is transfered to <a> element, for example 'target', or 'title' 
      }
      type FileMenuProp = { id?: string, label: ReactNode, value: ReactNode } | ReactElement
      ```
      Example, if you want to remove the 'show' item of the menu:
      ```typescript
      HFS.onEvent('fileMenu', ({ entry, menu }) => {
        const index = menu.findIndex(x => x.id === 'show')
        if (index >= 0)
            menu.splice(index, 1)
      })
      ```
      or if you like lodash, you can simply `HFS._.remove(menu, { id: 'show' })`
- `fileShow`
    - you receive an entry of the list, and optionally produce React Component for visualization.
    - parameter `{ entry: Entry }` (refer above for Entry object)
    - output `ReactComponent`
- `menuZip`
    - parameter `{ def: ReactNode }`
    - output `Html`
- `userPanelAfterInfo`
    - no parameter
    - output `Html`
- `uriChanged`
    - DEPRECATED: use `watchState('uri', callback)` instead.
    - parameter `{ uri: string, previous: string }`

## Back-end events

These events happen in the server, and not in the browser.
You can listen to these events accessing `api.events` in the `init` function of the plugin.
E.g.:
```js
exports.init = function(api) {
    const cancelListening = api.events.on('spam', () => 'spam received!')
    // pass the canceller callback to the 'unload', so the subscription will be correctly disposed when the plugin is stopped   
    return { unload: cancelListening }
}
```

Of course the example above can be written more shortly as follows, but they are equivalent.

```js
exports.init = api => ({
    unload: api.events.on('spam', () => 'spam received!')
})
```

### Async

Only where specified, events support async listeners, like
```js
api.events.on('deleting', async () => your-code-here)
```

### Stop, the way you prevent default behavior

Some events allow you to stop their default behavior, by returning `false`.
This is reported in the list below with the word "stoppable".

```js
api.events.on('deleting', ({ node }) => node.source.endsWith('.jpg'))
```

The example above will return false only when the file is NOT ending with .jpg, thus allowing only jpg files to be deleted.

### Available events

This section is still partially documented, and you may need to have a look at the sources for further details.

- `deleting`
  - parameters: { node, ctx }
  - called just before trying to delete a file or folder (which still may not exist and fail)
  - async supported
  - stoppable
- `logout`
- `config ready`
- `config.KEY` where KEY is the key of a config that has changed
- `connectionClosed`
- `connection`
- `connectionUpdated`
- `console`
- `dynamicDnsError`
- `httpsReady`
- `spam`
- `log`
- `error_log`
- `failedLogin`
- `accountRenamed`
- `pluginDownload`
- `pluginUpdated`
- `pluginInstalled`
- `pluginUninstalled`
- `pluginStopped`
- `pluginStarted`
- `uploadStart`
  - parameters: { ctx, writeStream } 
  - stoppable
  - return: callback to call when upload is finished
- `uploadFinished`
- `publicIpsChanged`
  - parameters: { IPs, IP4, IP6, IPX }

# Notifications (backend-to-frontend events)

You can send messages from the backend (plugin.js) using `api.notifyClient`, and receive on the frontend
using `HFS.getNotifications`. Find details in the reference above.

Example:

`plugin.js`
```js
exports.init = api => {
    const t = setInterval(() => api.notifyClient('test', 'message', 'hello'), 5000)
    return {
        frontend_js: 'main.js',
        unload() {
            clearInterval(t)
        }
    }
}
```
`public/main.js`
```js
HFS.getNotifications('test', console.log)
```

# The `ctx` object

HFS is currently based on [Koa](https://koajs.com), so you'll see some things related to it in the backend API.
The most prominent is the `ctx` object, short for "context".
To know what the Context object contains please refer to [Koa documentation](https://github.com/koajs/koa/blob/master/docs/api/context.md).

HFS adds a few useful properties in the `ctx.state` object. Some of it may turn to be useful,
so we prepared this list as a quick reference, but beware that it may become out of date and needs double check.
If so, please report, and we'll do our best to update it asap.
Where information is too little, you'll have to consult the source code, sorry.

        originalPath: string // before roots is applied
        browsing?: string // for admin/monitoring
        dontLog?: boolean // don't log this request
        logExtra?: object
        completed?: Promise<unknown>
        spam?: boolean // this request was marked as spam
        params: Record<string, any>
        account?: Account // user logged in
        revProxyPath: string
        connection: Connection
        skipFilters?: boolean
        vfsNode?: VfsNode
        includesLastByte?: boolean
        serveApp?: boolean // please, serve the frontend app
        uploadPath?: string // current one
        uploads?: string[] // in case of request with potentially multiple uploads (POST), we register all filenames (no full path)
        length?: number
        originalStream?: typeof ctx.body
        uploadDestinationPath?: string // this value is the temporary file in uploadStart and the final one in uploadFinished
        archive?: string

## Other files

Together with the main file (plugin.js), you can have other files, both for data and javascript to include with `require('./other-file')`.
Notice that in this case you don't use `api.require` but classic `require` because it's in your plugin folder.

These files have a special meaning:

- `public` folder, and its files will be accessible at `/~/plugins/PLUGIN_NAME/FILENAME`
- `custom.html` file, that works exactly like the main `custom.html`. Even when same section is specified
  by 2 (or more) files, both contents are appended.

## Dependencies

You run vanilla javascript here, in the backend and/or in the browser, so the tools you have for dependencies
are the ones provided by node.js and/or the browser.
If you use a library for the browser, you'll have to keep it in the "public" folder, as the browser must be able to load it.
If you want to use a module for node.js, just include "node_modules" folder (not in "public" folder).
You can decide if you want to use some building system/transpiler, but you'll have to set it up yourself.

## Publish your plug-in

Suggested method for publishing is to have a dedicated repository on GitHub, with topic `hfs-plugin`.
To set the topic go on the repo home and click on the gear icon near the "About" box.
Be sure to also fill the "description" field, especially with words that people may search for.

The files intended to be installed must go in a folder named `dist`.
You can keep other files outside.

If you have platform-dependent files, you can put those files in `dist-PLATFORM` or `dist-PLATFORM-ARCHITECTURE`.
For example, if you want some files to be installed only on Windows with Intel CPUs, put them in `dist-win32-x64`.

Possible values for platform are `aix`, `darwin`, `freebsd`, `linux`, `openbsd`, `sunos`, `win32`.

Possible values for CPUs are `arm`, `arm64`, `ia32`, `mips`, `mipsel`, `ppc`, `ppc64`, `s390`, `s390x`, `x64`.

You can refer to these published plugins for reference, like
- https://github.com/rejetto/simple-player/
- https://github.com/rejetto/theme-example/

Published plugins are required to specify the `apiRequired` property.

It is possible to publish different versions of the plugin to be compatible with different versions of HFS.
To do that, just have your other versions in branches with name starting with `api`.
HFS will scan through them in inverted alphabetical order searching for a compatible one.

## React developers

Most React developers are used to JSX, which is not (currently) supported here.
If you want, you can try solutions to JSX support, like transpiling.
Anyway, React is not JSX, and can be easily used without.

Any time in JSX you do
```jsx
<button onClick={() => console.log('hi')}>Say hi</button>
```

This is just translated to
```js
h('button', { onClick: () => console.log('hi') }, 'Say hi')
```

Where `h` is just `import { createElement as h } from 'react'`.

## Internationalization (i18n)

To make your plugin multi-language you can use `HFS.t` function in javascript, like this: `HFS.t('myPlugin_greeting', "Hello!")`.
Now, to add translations, you'll add files like `hfs-lang-XX.json` to your plugin (same folder as plugin.js),
where XX is the language code. The system is basically the same used to translate the rest of HFS,
and you can [read details here](https://github.com/rejetto/hfs/wiki/Translation).

In the previous example `myPlugin_greeting` is the name of the translation, while `Hello!` is the default text.
Instead of `myPlugin` use some text that you feel unique and no one else will use, to be sure that the same name
is not used by another plugin, or even HFS in the future.

If you need to pass variables in the text, introduce a third parameter in the middle.
Eg: `HFS.t('myPlugin_filter_count', {n:filteredVariable}, "{n} filtered")`

### Language customization

One can change a specific text by overriding existing translation. Example: you want to change the text for "Options" to "Settings".
If you want to override for a specific language, for example english with language-code `en`:

```js
HFS._.set(HFS.lang, 'en.translate.Options', 'Settings')
```

This works because all translations are stored inside `HFS.lang`.
Using `HFS._.set` is not necessary, but in this case is convenient, because the language-code key may not exist.

If you want to override a text regardless of the language, use the special language-code `all`.

## API version history

- 8.84 (v0.53.0)
    - api.openDb
    - frontend event: menuZip
    - config.type:username
    - api.events class has changed
    - frontend event "fileMenu": changed props format
    - api.getConfig() without parameters
    - api.notifyClient + HFS.getNotifications
- 8.72 (v0.52.0)
    - HFS.toast
    - HFS.misc functions
    - HFS.state.uri
    - ~~frontend event: uriChanged~~
- 8.65 (v0.51.0)
    - plugin's own hfs-lang files
    - HFS.state.props.can_overwrite
    - ctx.state.considerAsGui
    - frontend event: userPanelAfterInfo
    - breaking: moved custom properties from ctx to ctx.state
    - HFS.navigate
    - internationalization
- 8.5 (v0.49.0)
    - frontend event: entry
    - exports.onDirEntry: entry.icon
    - customApiCall supports any number of parameters
- 8.4 (v0.48.2)
    - HFS.fileShow
    - api.Const (api.const is now deprecated)
- 8.3 (v0.47.0)
    - HFS.useBatch
    - FileMenuEntry.id, .subLabel
- 8.23 (v0.46.0)
    - entry.getNext, getPrevious, getNextFiltered, getPreviousFiltered, getDefaultIcon
    - platform-dependent distribution
    - HFS.watchState, emit, useApi
    - api.storageDir, customApiCall
    - exports.depend
    - frontend event: fileShow
- 8.1 (v0.45.0) should have been 0.44.0 but forgot to update number
    - full URL support for frontend_js and frontend_css
    - custom.html
    - entry.cantOpen, ext, isFolder
    - HFS.apiCall, reloadList, logout, h, React, state, t, _, dialogLib, Icon, getPluginPublic
    - second parameter of onEvent is now deprecated
    - renamed: additionalEntryProps > additionalEntryDetails & entry-props > entry-details
    - frontend event: entryIcon
- 8 (v0.43.0)
    - entry.name & .uri
    - tools.dialogLib
    - HFS.getPluginConfig()
- 7 (v0.42.0)
    - frontend event: fileMenu
    - HFS.SPECIAL_URI, PLUGINS_PUB_URI, FRONTEND_URI,
- 6 (v0.38.0)
    - config.frontend
- 5 (v0.33.0)
    - frontend event: afterEntryName
- 4.1 (v0.23.4)
    - config.type:array added $width, $column and fixed height
- 4 (v0.23.0)
    - config.type:real_path
    - api.subscribeConfig
    - api.setConfig
    - api.getHfsConfig
- 3 (v0.21.0)
    - config.defaultValue
    - async for init/unload
    - api.log
- 2
    - config.type:array
