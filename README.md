# HFS: HTTP File Server

HFS is a file server offering a virtual file system (vfs).
You can easily share a single file instead of the whole folder,
or you can rename it, but without touching the real file, just virtually.

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

# Configuration

At the moment there's no administration UI. You must edit configuration files.

## Config

General configuration is read by default from file `config.yaml`.
When not specified, default values will be used.
Supported entries are:
- `port` where to accept http connections. Default is 80.
- `vfs` the files and folders you want to expose. For details see the dedicated following section.
- `log` path of the log file. Default is `access.log`.
- `accounts` path of the accounts file. Default is `accounts.yaml`.
- `mime` command what mime-type to be returned with some files. 
    E.g.: `"*.jpg": image/jpeg`
    You can specify multiple entries, or separate multiple file masks with a p|pe.
    You can use the special value `auto` to attempt automatic detection.

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

As soon as the file is read HFS will encrypt passwords in a non-reversible way.
For this reason HFS needs that your accounts file is writable.

# Building instructions

0. Install [Node.js](https://nodejs.org/) 16+ 
1. Install Typescript: launch `npm -g i typescript`
3. Launch `npm run build-all` in the root

You'll find the output in `dist` folder.

Now to run it you should `cd dist` and `node .`

# Plug-ins

We are slowly introducing a plug-ins system.
Each plug-in is a sub-folder of `plugins` folder.
You can quickly disable a plug-in by appending `-disabled` to the plug-in's folder name.
Plug-ins can be hot-swapped, and at some extent can be edited without restarting the server. 

Each plug-in has access to the same set of features.
Normally you'll have a plug-in that's a theme, and another that's a firewall,
but nothing is preventing a single plug-in from doing both tasks.

## For plug-in makers

What a plug-in does is declared in its `plugin.yaml` file.
Supported keys are:

- `middleware` javascript file exporting a function that will be used as a middleware: it can interfere with http activity. 

    If the function returns `true`, other executions on this http request will be interrupted.
    Return another function if you want to execute it in the "upstream" of middlewares.
 
- `frontend_css` path to one or more css files that you want the frontend to load.

Each plug-in can have a `public` folder, and its files will be accessible at `/~/plugins/PLPUGIN_NAME/FILENAME`.
