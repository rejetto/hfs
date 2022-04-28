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

- `description: string` try to explain what this plugin is for. This must go in `exports` and use "double quotes".
- `version: number` use progressive numbers to distinguish each release. This must go in `exports`.
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
- `config: { [key]: FieldDescriptor }` declare a set of admin-configurable values owned by the plugin that will be displayed inside Admin panel for change.
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

### FieldDescriptor

Currently, these properties are supported:
- `type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect'` . Default is `string`.
- `label: string` what name to display next to the field. Default is based on `key`.
- `helperText: string` extra text printed next to the field.

Based on `type`, other properties are supported:
- `string`
    - `multiline: boolean`. Default is `false`.
- `number`
    - `min: number`
    - `max: number`
- `select`
    - `options: { [label]: AnyJsonValue }`
- `multiselect` it's like `select` but its result is an array of values.

## api object

The `api` object you get as parameter of the `init` contains the following:

- `require: function` use this instead of standard `require` function to access modules already loaded by HFS.

- `getConfig(key: string): any` get config's value set up by using `exports.config`.

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

### Javascript
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

