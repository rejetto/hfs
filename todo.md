NO: provare ad usare il name invece del rename: è complesso invertire, e bisogna comunque impedire di usarlo con le mask. Non vale la pena
OK verificare che walknode/file_list non produca entries con search
OK migliorare codice
aggiornare admin gui
counters: non contare richieste fallite
consider having mime as ext,ext instead of *.ext|*.ext
# To do
- monorepo + share code between apps
- admin/accounts: show icon for accounts with (possibly inherited) admin access
- expose admin at same port of frontend
- admin: improve masks editor
- if specified config is a folder, check for file config.yaml inside
- merge accounts in config
- frontend: ok button to inputDialogs
- admin: in a group, show linked accounts
- admin/monitor: show file currently downloaded
- admin/config: use filepicker for https files
- admin: warn in case of items with same name
- allowed referer
- admin/plugins
- download-counter: expose results on admin
- log rotation
- log filter option
- log filter plugin
- publish to npm (so people can "npm install hfs")
- frontend search supporting masks
- remove seconds from time
- update tests to SRP login
- upload
- upload unzipping (while streaming?)
- plugin to automatic generate letsencrypt cert?
- delete
- updater (stop,unzip,start)
- node.comment
- config: max connections/downloads (total/per-ip)
- config: bans
- config: min disk space
- thumbnails support
- webdav?
- log: ip2name
- apis in separated log file with parameters?
