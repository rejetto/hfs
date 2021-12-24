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
- simple website serving

# Configuration

At the moment there's no administration UI. You must edit configuration files.

## Virtual File System (VFS)

The virtual file system is a tree of nodes.
By default, it's in the file `vfs.yaml`.
You can decide a different file by passing it as first parameter at command line.
A node is folder, unless you provide for it a source that's not a folder itself.
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
    guest:
        password: guest    
```

As soon as the file is read HFS will encrypt passwords in a non-reversible way.

# Building instructions

0. Install [Node.js](https://nodejs.org/) 16+ 
1. Launch `npm run build-all` in the root

You'll find the output in `dist` folder.

Now to run it you should `cd dist` and `node .`
