# HFS: HTTP File Server

## Introduction

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
- virtual hosting (plug-in)
- anti-brute-force (plug-in)

## Installation

1. go to https://github.com/rejetto/hfs/releases
2. click on `Assets`
3. **download** the right version for your computer
4. run the file

If your system is not covered, you can try this alternative version:

1. install node.js version 16+ from https://nodejs.org/
2. download and unzip `hfs-node.zip`
3. chmod +x run
4. launch `./run`

## Plug-ins

To install a plugin you just copy its folder inside `plugins` folder.

Delete it to uninstall.

HFS will ignore all folders with `-disabled` at the end of the name.

## Why you should upgrade from HFS 2.x to 3

As you can see from the list of features, we already have some goods that you cannot find in HFS 2.
Other than that, you can also consider: 

- it's more robust: it was designed to be an always-running server, while HFS 1-2 was designed for occasional usage (transfer and quit) 
- passwords are never really stored, just a non-reversible hash is
- more flexible permissions

But you may still want to stay with HFS 2.x (so far) for the following reasons

- smaller
- more tested
- classic window interface (can be easier for some people)

## License

[GPLv3](https://github.com/rejetto/hfs/blob/master/LICENSE.txt)
