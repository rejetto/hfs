# For plug-in makers

A plug-in is a folder with a `plugin.js` file in it.

Plug-ins can be hot-swapped, and at some extent can be edited without restarting the server.

Each plug-in has access to the same set of features.
Normally you'll have a plug-in that's a theme, and another that's a firewall,
but nothing is preventing a single plug-in from doing both tasks.

`plugin.js` is a javascript module that exports an `init` function like this:
```js
exports.init = api => ({
    frontend_css: 'mystyle.css'
})
```

The init function is called when the module is loaded and should return an object with things to customize.
In the example above we are asking a css file to be loaded in the frontend.
The parameter `api` object contains some useful things we'll see later.
You can decide to return things in the `init` function, or directly in the `exports`.
If you need to access the api you must use `init`, otherwise you can go directly with `exports`.

Let's first look at the things you can return:

## Things a plugin can return or export

All the following properties are essentially optional.

- `description: string` try to explain what this plugin is for. This must go in `exports` and use "double quotes".
- `version: number` use progressive numbers to distinguish each release. This must go in `exports`.
- `apiRequired: number | [min:number,max:number]` declare version(s) for which the plugin is designed for. You'll find api version in `src/const.ts`. This must go in `exports`.
- `frontend_css: string | string[]` path to one or more css files that you want the frontend to load. These are to be placed in the `public` folder (refer below).
- `frontend_js: string | string[]` path to one or more js files that you want the frontend to load. These are to be placed in the `public` folder (refer below).
- `middleware: (Context) => void | true | function` a function that will be used as a middleware: use this to interfere with http activity.
  
  ```js
  exports.middleware = ctx => {
    ctx.body = "You are in the wrong place"
    ctx.status = 404
  }
  ```
  You'll find more examples by studying plugins like `vhosting` or `antibrute`.
  This API is based on [Koa](https://koajs.com), because that's what HFS is using.
  To know what the Context object contains please refer to [Koa's documentation](https://github.com/koajs/koa/blob/master/docs/api/context.md).
  You don't get the `next` parameter as in standard Koa's middlewares because this is different, but we are now explaining how to achieve the same results.
  To interrupt other middlewares on this http request, return `true`.
  If you want to execute something in the "upstream" of middlewares, return a function.

- `unload: function` called when unloading a plugin. This is a good place for example to clearInterval().
- `onDirEntry: ({ entry: DirEntry, listPath: string }) => void | false` by providing this callback you can manipulate the record
  that is sent to the frontend (`entry`), or you can return false to exclude this entry from the results.
- `config: { [key]: FieldDescriptor }` declare a set of admin-configurable values owned by the plugin that will be displayed inside Admin-panel for change.
  Each property is identified by its key, and the descriptor is another object with options about the field.
  A simple empty object `{}` is a text field.

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
- `type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect' | 'real_path' | 'array'` . Default is `string`.
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

## api object

The `api` object you get as parameter of the `init` contains the following:

- `require: function` use this instead of standard `require` function to access modules already loaded by HFS.

- `getConfig(key: string): any` get config's value set up by using `exports.config`.

- `setConfig(key: string, value: any)` set config's value set up by using `exports.config`.

- `subscribeConfig(key: string, callback: (value: any) => void): Unsubscriber`
  will call `callback` with initial value and then at each change.  

- `getHfsConfig(key: string): any` similar to getConfig, but retrieves HFS' config instead.

- `log(...args)` print log in a standard form for plugins.

- `const: object` all constants of the `const.ts` file are exposed here. E.g. BUILD_TIMESTAMP, API_VERSION, etc.

- `getConnections: Connections[]` retrieve current list of active connections.

- `events: EventEmitter` this is the main events emitter used by HFS.

- `srcDir: string` this can be useful if you need to import some extra function not available in `api`.
  ```js
  exports.init = api => {
      const { watchLoad } = api.require(api.srcDir + '/watchLoad')
  }
  ```
  You *should* try to keep this kind of behavior at its minimum, as name of sources and of elements in them are subject to change.
  If you need something for your plugin that's not covered by `api`, you can test it with this method,
  but you should then discuss it on the forum because an addition to `api` is your best option for making a future-proof plugin.

Each plug-in can have a `public` folder, and its files will be accessible at `/~/plugins/PLUGIN_NAME/FILENAME`.

## Front-end specific

The following information applies to the default front-end, and may not apply to a custom one.

Once your script is loaded into the frontend (via `frontend_js`), you will have access to the `HFS` object in the global scope.

The HFS objects contains many properties:
- `onEvent` this is the main API function inside the frontend. Refer to dedicated section below.  
- `apiCall`
- `reloadList`
- `logout`
- `state` [object with many values in it](https://github.com/rejetto/hfs/blob/main/frontend/src/state.ts)
- `React` whole React object, as for `require('react')` (JSX syntax is not supported here)
- `h` shortcut for React.createElement
- `t` [translator function](https://github.com/rejetto/hfs/blob/main/frontend/src/i18n.ts)
- `_` [lodash library](https://lodash.com/docs/)

### Front-end API events

API at this level is done with frontend-events, that you can handle by calling

```typescript
HFS.onEvent(eventName, callback)

//type callback = (parameters: object, HFS: object) => any
``` 

Parameters of your callback and meaning of returned value varies with the event name.
Refer to the specific event for further information.
HFS object is the same you access globally. Here just for legacy, consider it deprecated.

Some frontend-events can return Html, which can be expressed in several ways
- as string, containing markup
- as DOM Nodes, as for document.createElement()
- as ReactElement
- null, undefined, false and empty-string will just be discarded 

This is a list of available frontend-events, with respective object parameter and output.

- `additionalEntryProps`
    - you receive each entry of the list, and optionally produce HTML code that will be added in the `entry-props` container.
    - parameter `{ entry: Entry }`

      The `Entry` type is an object with the following properties:
        - `name: string` name of the entry.
        - `n: string` name of the entry, including relative path when searched in sub-folders.
        - `uri: string` relative url of the entry.
        - `s?: number` size of the entry, in bytes. It may be missing, for example for folders.
        - `t?: Date` generic timestamp, combination of creation-time and modified-time.
        - `c?: Date` creation-time.
        - `m?: Date` modified-time.
    - output `Html`
- `afterEntryName`
    - you receive each entry of the list, and optionally produce HTML code that will be added after the name of the entry.
    - parameter `{ entry: Entry, cantOpen: boolean }` (refer above for Entry object)
    - output `Html`
- `beforeHeader` & `afterHeader`
    - use this to produce content that should go right before/after the `header` part
    - output `Html`
- `beforeLogin`
    - no parameter
    - output `Html`
- `fileMenu`
    - add your entries to the menu.
    - parameter `{ entry: Entry, menu: FileMenuEntry[], props: FileMenuProp[] }`
    - output `FileMenuEntry | FileMenuEntry[]`
      ```typescript
      interface FileMenuEntry { 
          label: ReactNode,
          href?: string, // use this if you want your entry to be a link
          icon?: string, // supports: emoji, name from a limited set
          onClick?: () => (Promisable<boolean>) // return false to not close menu dialog
          //...rest is transfered to <a> element, for example 'target', or 'title' 
      }
      type FileMenuProp = [ReactNode,ReactNode] | ReactElement
      ```
## Publish your plug-in

Suggested method for publishing is to have a dedicated repository on GitHub, with topic `hfs-plugin`.
To set the topic go on the repo home and click on the gear icon near the "About" box.
Be sure to also fill the "description" field, especially with words that people may search for.

The files intended to be installed must go in a folder named `dist`.
You can keep other files outside.

You can refer to these published plugins for reference, like
- https://github.com/rejetto/simple-player/
- https://github.com/rejetto/theme-example/

Published plugins are required to specify the `apiRequired` property.

It is possible to publish different versions of the plugin to be compatible with different versions of HFS.
To do that, just have your other versions in branches with name starting with `api`.
HFS will scan through them in inverted alphabetical order searching for a compatible one. 

## API version history

- 8.1 (v0.44.0)
  - afterEntryname.cantOpen
  - HFS.apiCall, reloadList, logout
- 8 (v0.43.0)
  - entry.name & .uri
  - tools.dialogLib
  - HFS.getPluginConfig()
- 7 (v0.42.0)
  - event.fileMenu
  - HFS.SPECIAL_URI, PLUGINS_PUB_URI, FRONTEND_URI,
- 6 (v0.38.0)
  - config.frontend
- 5 (v0.33.0)
  - event.afterEntryName
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
