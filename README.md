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
- unicode
- virtual file system
- mobile friendly front-end
- search
- accounts
- resumable downloads
- resumable uploads
- download folders as zip archive
- remote delete
- simple website serving
- plug-ins
- log file
- speed throttler
- admin web interface
- multi-language front-end
- virtual hosting (plug-in)
- anti-brute-force (plug-in)
- [reverse-proxy support](https://github.com/rejetto/hfs/wiki/Reverse-proxy)

## Installation

NB: minimum Windows version required is 8.1 , Windows Server 2012 R2 (because of Node.js 16)

1. go to https://github.com/rejetto/hfs/releases
2. click on `Assets`
3. **download** the right version for your computer
4. launch `hfs` file
5. the browser should automatically open on `localhost` address, so you can configure the rest in the Admin-panel.
   - if a browser cannot be opened on the computer where you are installing HFS, 
     you should enter this command in HFS console: `create-admin <PASSWORD>`

If you access *Admin-panel* via localhost, by default HFS **won't** require you to login.
If you don't like this behavior, disable it in the Admin-panel or enter this console command `config localhost_admin false`.

### Other systems

If your system is not Windows/Linux/Mac or you just don't want to run the binaries, you can try this alternative version:

1. [install node.js](https://nodejs.org)
2. execute at command line `npx hfs@latest`

The `@latest` part is optional, and ensures that you are always up to date.

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

## Internationalization

It is possible to show the Front-end in other languages.
Translation for some languages is already provided. If you find an error, consider reporting it
or [editing the source file](https://github.com/rejetto/hfs/tree/main/src/langs). 

In the Languages section of the Admin-panel you can install additional language files.

If your language is missing, please consider [translating yourself](https://github.com/rejetto/hfs/wiki/Translation). 

## Plug-ins

You can use the Admin-panel to manage your plugins and install new ones.

Under the hood, installing a plugin just means copying its folder inside `plugins` folder. Deleting will uninstall it.

HFS will ignore all plugin folders with `-disabled` at the end of the name.

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

## Console commands

If you have access to HFS' console, you can enter commands. Start with `help` to have a full list. 

## Configuration

Configuration can be done in several ways
- accessing the Admin-panel with your browser
  - it will automatically open when you start HFS. Bookmark it. if your port is 8000 the address will be http://localhost:8000/~/admin 
- after HFS has started you can enter console command in the form `config NAME VALUE`
- passing via command line at start in the form `--NAME VALUE`
- directly editing the `config.yaml` file. As soon as you save it is reloaded and changes are applied

`NAME` stands for the property name that you want to change. See the complete list below.

### Where is it stored

Configuration is stored in the file `config.yaml`, exception made for custom HTML which is stored in `custom.html`.

These files are kept in the Current Working Directory (cwd), which is by default the same folder of `hfs.exe`
if you are using this kind of distribution on Windows, or `USER_FOLDER/.hfs` on other systems.
You can decide a different cwd passing `--cwd SOME_FOLDER` parameter at command line.  

You can decide also a different file for config by passing `--config SOME_FILE`, or inside an *env* called `HFS_CONFIG`.
Any relative path provided is relative to the *cwd*.  

[Check details about config file format](https://github.com/rejetto/hfs/blob/main/config.md). 

## Security

While this project focuses on ease of use, we care about security.
- HTTPS support
- Passwords are not saved, and user password is safe even logging in without https thanks to [SRP](https://en.wikipedia.org/wiki/Secure_Remote_Password_protocol)
- Automated tests ran on every release, including libraries audit
- No default admin password

Some actions you can take for improved security:
- use https, better if using a proper certificate, even free with [Letsencrypt](https://letsencrypt.org/).
- have a domain (ddns is ok too), start vhosting plugin, configure your domain, enable "Block requests that are not using any of the domains above"
- install/start rejetto/antidos plugin. Tweak configuration if necessary.
- start antibrute plugin (it's started by default)
- disable "unprotected admin on localhost"

## Hidden features

- Appending `#LOGIN` to address will bring up the login dialog
- Appending ?lang=CODE to address will force a specific language
- env `SESSION_DURATION` can be set to any number of seconds. Default is 1 day.
- right/ctrl/command click on toggle-all checkbox will invert each checkbox state

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

- [Make a plugin](https://github.com/rejetto/hfs/blob/main/dev-plugins.md)

  A plugin can change the look (a theme), and/or introduce a new functionality.

## More

- [Build yourself](https://github.com/rejetto/hfs/blob/main/dev.md)

- [License](https://github.com/rejetto/hfs/blob/master/LICENSE.txt)

- [To-do list](https://github.com/rejetto/hfs/blob/main/todo.md) 