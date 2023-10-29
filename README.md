# HFS: HTTP File Server (version 3)

![logo and motto](hfs-logo-color-motto.svg)

## Introduction

HFS is the best way via web to access or share files from your disk.

- You be the server, share files **fresh from your disk**, with **unlimited** space and bandwidth.
- It's all very **fast**. Try download zipping 100GB, it starts immediately!
- **Easy to use**. HFS tries to detect problems and suggest solutions.
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
- remote delete
- simple website serving
- plug-ins
- real-time monitoring of connections
- [show some files](https://github.com/rejetto/hfs/discussions/270)
- speed throttler
- admin web interface
- multi-language front-end
- virtual hosting (plug-in)
- anti-brute-force (plug-in)
- [reverse-proxy support](https://github.com/rejetto/hfs/wiki/Reverse-proxy)
- comments in file descript.ion

## Installation

NB: minimum Windows version required is 8.1 , Windows Server 2012 R2 (because of Node.js 18)

1. go to https://github.com/rejetto/hfs/releases
2. click on `Assets`
3. **download** the right version for your system, unzip and launch `hfs` file. 
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

### Service

If you want to run HFS at boot (as a service), we suggest the following methods

#### On Linux 
1. [install node.js](https://nodejs.org)
2. create a file `/etc/systemd/system/hfs.service` with this content
  ```
  [Unit]
  Description=HFS
  After=network.target
  
  [Service]
  Type=simple
  Restart=always
  ExecStart=/usr/bin/npx -y hfs@latest
  
  [Install]
  WantedBy=multi-user.target
  ```
3. run `sudo systemctl daemon-reload && sudo systemctl enable hfs && sudo systemctl start hfs && sudo systemctl status hfs`

NB: update will be attempted at each restart

#### On Windows

1. [install node.js](https://nodejs.org)
2. run `npm -g i hfs`
3. run `npx qckwinsvc2 install name="HFS" description="HFS" path="%APPDATA%\npm\node_modules\hfs\src\index.js" args="--cwd %HOMEPATH%\.hfs" now`
  
To update 
- run `npx qckwinsvc2 uninstall name="HFS"`
- run `npm -g update hfs`
- run `npx qckwinsvc2 install name="HFS" description="HFS" path="%APPDATA%\npm\node_modules\hfs\src\index.js" args="--cwd %HOMEPATH%\.hfs" now`

## Console commands

If you have full access to HFS' console, you can enter commands. Start with `help` to have a full list.

## Configuration

For configuration please see [file config.md](config.md).

### Where is it stored

Configuration is stored in the file `config.yaml`, exception made for custom HTML which is stored in `custom.html`.

These files are kept in the Current Working Directory (cwd), which is by default the same folder of `hfs.exe`
if you are using this kind of distribution on Windows, or `USER_FOLDER/.hfs` on other systems.
You can decide a different cwd passing `--cwd SOME_FOLDER` parameter at command line.

You can decide also a different file for config by passing `--config SOME_FILE`, or inside an *env* called `HFS_CONFIG`.
Any relative path provided is relative to the *cwd*.

[Check details about config file format](config.md).

## Internationalization

It is possible to show the Front-end in other languages.
Translation for some languages is already provided. If you find an error, consider reporting it
or [editing the source file](https://github.com/rejetto/hfs/tree/main/src/langs). 

In the Languages section of the Admin-panel you can install additional language files.

If your language is missing, please consider [translating yourself](https://github.com/rejetto/hfs/wiki/Translation). 

## Why you should upgrade from HFS 2.x to 3

As you can see from the list of features, we already have some goods that you cannot find in HFS 2.
Other than that, you can also consider: 

- it's more robust: it was designed to be an always-running server, while HFS 1-2 was designed for occasional usage (transfer and quit) 
- passwords are never really stored, just a non-reversible hash is
- faster search (up to 12x)
- more flexible permissions

But you may still want to stay with HFS 2.x (so far) for the following reasons

- smaller
- more tested
- classic window interface (can be easier for some people)

## Security

While this project focuses on ease of use, we care about security.
- HTTPS support
- Passwords are not saved, and user password is safe even logging in without https thanks to [SRP](https://en.wikipedia.org/wiki/Secure_Remote_Password_protocol)
- Automated tests ran on every release, including libraries audit
- No default admin password

Some actions you can take for improved security:
- use https, better if using a proper certificate, even free with [Letsencrypt](https://letsencrypt.org/).
- have a domain (ddns is ok too), start vhosting plugin, configure your domain, enable "Block requests that are not using any of the domains above"
- install rejetto/antidos plugin
- start antibrute plugin (but it's started by default)
- disable "unprotected admin on localhost"

## Hidden features

- Appending `#LOGIN` to address will bring up the login dialog
- Appending ?lang=CODE to address will force a specific language
- right/ctrl/command click on toggle-all checkbox will invert each checkbox state
- Appending `?login=USER:PASSWORD` will automatically log in the browser

## Contribute

There are several ways to contribute

- [Report bugs](https://github.com/rejetto/hfs/issues/new?labels=bug&template=bug_report.md)

  It's very important to report bugs, and if you are not so sure about it, don't worry, we'll discuss it.
  If you find important security problems, please [contact us privately](mailto:a@rejetto.com) so that we can publish a fix before
  the problem is disclosed, for the safety of other users.  

- [Translate to your language](https://github.com/rejetto/hfs/wiki/Translation).

- [Suggest ideas](https://github.com/rejetto/hfs/discussions)

  While the project should not become too complex, yours may be an idea for a plugin.

- Submit your code

  If you'd like to make a change yourself in the code, please first open an "issue" or "discussion" about it,
  so we'll try to cooperate and understand what's the best path for it.

- [Make a plugin](dev-plugins.md)

  A plugin can change the look (a theme), and/or introduce a new functionality.

## More

- [APIs](https://github.com/rejetto/hfs/wiki/APIs)

- [Build yourself](dev.md)

- [License](https://github.com/rejetto/hfs/blob/master/LICENSE.txt)

- [To-do list](todo.md) 