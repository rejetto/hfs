# HFS: HTTP File Server (version 3)

![logo and motto](hfs-logo-color-motto.svg)

## Introduction

Access via web your files directly from your disk.

- You be the server, share files **fresh from your disk**, with **unlimited** space and bandwidth.
- **Fast!** Try zipping 100GB, download starts immediately!
- **Intelligent**. HFS tries to detect problems and suggest solutions.
- Share **even a single file** with our *virtual file system*, even with a different name, all without touching the real file. Present things the way you want!
- **Watch** all activities in real-time.
- **Control bandwidth**, decide how much to give.
- **No intermediaries**, give a huge file to your friend without waiting for it to be uploaded on a server first.

This is a full rewrite of [the Delphi version](https://github.com/rejetto/hfs2).

## How does it work

- run HFS on your computer, administration page automatically shows up
- select what files and folders you want to be accessible
- access those files from a phone or another computer just using a browser
- possibly create accounts and limit access to files

## Features

- https
- easy certificate generation
- unicode
- virtual file system
- mobile friendly
- search
- accounts
- resumable downloads & uploads
- download folders as zip archive
- delete, move and rename files
- simple website serving
- plug-ins
- real-time monitoring of connections
- [show some files](https://github.com/rejetto/hfs/discussions/270)
- speed throttler
- geographic firewall
- admin web interface
- multi-language front-end
- virtual hosting
- anti-brute-force (plug-in)
- [reverse-proxy support](https://github.com/rejetto/hfs/wiki/Reverse-proxy)
- comments in file descript.ion
- integrated media player
- [customizable with html, css and javascript](https://github.com/rejetto/hfs/wiki/Customization)
- dynamic-dns updater

## Installation

For service installation instructions, [see our wiki](https://github.com/rejetto/hfs/wiki/Service-installation).

For Docker installation, [see dedicated repo](https://github.com/damienzonly/hfs-docker).

NB: minimum Windows version required is 8.1 , Windows Server 2012 R2 (because of Node.js 18)

1. go to https://github.com/rejetto/hfs/releases
2. click on `Assets`
3. **download** the right version for your system, unzip and launch `hfs` file. 
   - Mac: if you get *"cannot be opened because it is from an unidentified developer"*,
     you can hold `control` key while clicking, then click `open`.
   - If you cannot find your system in the list, see next section [Other systems](#other-systems).
4. the browser should automatically open on `localhost` address, so you can configure the rest in the Admin-panel.
   - if a browser cannot be opened on the computer where you are installing HFS, 
     you should enter this command in the HFS console: `create-admin <PASSWORD>`
   - if you cannot access the console (like when you are running as a service), 
       you can [edit the config file to add your admin account](config.md#accounts)
   - if you don't want to use an editor you can create the file with this command: 
     
     `echo "create-admin: PASSWORD" > config.yaml` 

If you access *Admin-panel* via localhost, by default HFS **won't** require you to login.
If you don't like this behavior, disable it in the Admin-panel or enter this console command `config localhost_admin false`.

### Other systems

If your system is not Windows/Linux/Mac or you just don't want to run the binaries, you can try this alternative version:

1. [install node.js](https://nodejs.org) version 18
2. execute at command line `npx hfs@latest`

The `@latest` part is optional, and ensures that you are always up to date.

If this procedure fails, it may be that you are missing one of [these requirements](https://github.com/nodejs/node-gyp#installation).

Configuration and other files will be stored in `%HOME%/.vfs`

## Console commands

If you have full access to HFS' console, you can enter commands. Start with `help` to have a full list.

## Configuration

For configuration please see [file config.md](config.md).

### Where is it stored

Configuration is stored in the file `config.yaml`, exception made for custom HTML which is stored in `custom.html`.

These files are kept in the Current Working Directory (cwd), which is by default the same folder of `hfs.exe`
if you are using this kind of distribution on Windows, or `USER_FOLDER/.hfs` on other systems.
You can decide a different folder passing `--cwd SOME_FOLDER` parameter at command line.
Any relative path provided is relative to the *cwd*.

[Check details about config file format](config.md).

## Internationalization

It is possible to show the Front-end in other languages.
Translation for some languages is already provided. If you find an error, consider reporting it
or [editing the source file](https://github.com/rejetto/hfs/tree/main/src/langs). 

In the Languages section of the Admin-panel you can install additional language files.

If your language is missing, please consider [translating yourself](https://github.com/rejetto/hfs/wiki/Translation). 

## Hidden features

- Appending `#LOGIN` to address will bring up the login dialog
- Appending ?lang=CODE to address will force a specific language
- Right/ctrl/command click on toggle-all checkbox will invert each checkbox state
- Appending `?login=USER:PASSWORD` will automatically log in the browser
- Appending `?overwrite` on uploads, will override the dont_overwrite_uploading configuration, provided you also have delete permission
- Appending `?search=PATTERN` will trigger search at start 
- Right-click on "check for updates" will let you input a URL of a version to install
- Shift+click on a file will show & play
- Type the name of a file/folder to focus it, and ctrl+backspace to go to parent folder

## Contribute

There are several ways to contribute

- [Report bugs](https://github.com/rejetto/hfs/issues/new?labels=bug&template=bug_report.md)

  It's very important to report bugs, and if you are not so sure about it, don't worry, we'll discuss it.
  If you find important security problems, please [contact us privately](mailto:a@rejetto.com) so that we can publish a fix before
  the problem is disclosed, for the safety of other users.  

- Use beta versions, and give feedback. 

  While betas have more problems, you'll get more features and give a huge help to the project. 

- [Translate to your language](https://github.com/rejetto/hfs/wiki/Translation).

- [Suggest ideas](https://github.com/rejetto/hfs/discussions)

  While the project should not become too complex, yours may be an idea for a plugin.

- Write guides or make videos for other users. [We got a wiki](https://github.com/rejetto/hfs/wiki)! 

- Submit your code

  If you'd like to make a change yourself in the code, please first open an "issue" or "discussion" about it,
  so we'll try to cooperate and understand what's the best path for it.

- [Make a plugin](dev-plugins.md)

  A plugin can change the look (a theme), and/or introduce a new functionality.

## More

- [APIs](https://github.com/rejetto/hfs/wiki/APIs)

- [Build yourself](dev.md)

- [License](https://github.com/rejetto/hfs/blob/master/LICENSE.txt)

- Flag images are public-domain, downloaded from https://flagpedia.net