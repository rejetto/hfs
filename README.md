# HFS: HTTP File Server

![logo and motto](hfs-logo-color-motto.svg)

## Introduction

Access via web your files directly from your disk.

- Be your own server, share files **fresh from your disk**, with **unlimited** space and bandwidth.
- **Fast:** try zipping 100GB, download starts immediately.
- **Smart:** HFS tries to detect problems and suggest solutions.
- Present things the way you want: share **even a single file**, even with a different name, with our *virtual file system*.
- **Monitor** all activities in real-time.
- **Bandwidth throttling**: decide how much to give.
- **Direct transfers**: share large files with friends without having to upload them first.
- **Expandable**: find the right plugin, or create you own

Runs on: Windows, Linux, macOS, FreeBSD, Android

## How does it work

- run HFS on your computer, administration page automatically shows up
- select what files and folders you want to be accessible
- access those files from a phone or another computer just using a browser
- possibly create accounts and limit access to files

## Features

- https
- easy certificate generation
- virtual file system
- mobile friendly
- search
- accounts
- resumable downloads & uploads
- download folders as zip archive
- delete, move and rename files
- plug-ins (anti-brute-force, thumbnails, ldap, themes, and more)
- simple website serving
- real-time monitoring of connections
- [show some files](https://github.com/rejetto/hfs/discussions/270)
- speed throttler
- geographic firewall
- admin web interface
- multi-language front-end
- virtual hosting
- [reverse-proxy support](https://github.com/rejetto/hfs/wiki/Reverse-proxy)
- comments in file descript.ion
- integrated media player
- [customizable with html, css and javascript](https://github.com/rejetto/hfs/wiki/Customization)
- dynamic-dns updater

## Installation

If you need [Docker installation](https://github.com/damienzonly/hfs-docker) or [Service installation](https://github.com/rejetto/hfs/wiki/Service-installation), click the links.

Minimum Windows version required is 10 or Server 2019. If you have a previous version, you can still follow instructions for [Other systems](#other-systems)  

1. go to https://github.com/rejetto/hfs/releases
2. click on `Assets`
3. **download** the right version for your system, unzip and launch `hfs` file. 
   - Mac: if you get *"cannot be opened because it is from an unidentified developer"*,
     you can hold `control` key while clicking, then click `open`.
   - If your system isn't listed, please see the [Other systems](#other-systems) section.
4. the browser should automatically open on `localhost` address, so you can configure the rest in the Admin-panel.

Troubleshooting
   - if a browser cannot be opened on the computer where you are installing HFS, 
     you should enter this command in the HFS console: `create-admin <PASSWORD>`
   - if you cannot access the console (like when you are running as a service), 
       you can [edit the config file to add your admin account](config.md#accounts)
   - if you don't want to use an editor you can create the file with this command: 
     
     `echo "create-admin: PASSWORD" > config.yaml` 

By default, HFS does not require a login when you access the *Admin-panel* from localhost.
If you don't like this behavior, disable it in the Admin-panel or enter this console command `config localhost_admin false`.

### Other systems

If can't or don't want to run our binary versions, you can try this:

 1. [install node.js](https://nodejs.org) version 20 (or greater, but then compatibility is not guaranteed)
2. execute at command line `npx hfs@latest`

The `@latest` part is optional, and ensures that you are always up to date.

If this procedure fails, it may be that you are missing one of [these requirements](https://github.com/nodejs/node-gyp#installation).

Configuration and other files will be stored in `%HOME%/.vfs`

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

- Append `#LOGIN` to the URL to open the login dialog
- Append `?lang=CODE` to the URL to force a specific language
- `Right-click` on toggle-all checkbox to *invert* the state of all checkboxes
- Append `?login=USER:PASSWORD` to automatically log in to the browser
- Append `?overwrite` when uploading to override the `dont_overwrite_uploading` configuration, provided you also have *delete* permission
- Append `?search=PATTERN` to trigger a search on startup
- Append `?onlyFiles` or `?onlyFolders` to limit the type of results
- Append `?get=basic` to display a basic web interface, intended for older/simpler browsers 
  - This is automatic if a basic browser is detected.
- Append `?autoplay=shuffle` to trigger show & play; `?autoplay` will not shuffle, but also will not start until the list is complete 
- `Right-click` on "check for updates" to enter a URL of a version to install
- `Shift+click` on a file to *show* and play
- `Ctrl+backspace` to navigate to the parent folder
- Start typing a filename to focus it in the list
- `--consoleFile PATH` to also output all stdout/stderr to a file
- Set env.var. `DISABLE_UPDATE=1` (for containers)
- Launch with `--debug` or env.var. `HFS_DEBUG=1` to generate additional console logs 

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