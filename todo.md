# To do
- anti-csrf
- file sorting
- folders before?
- upload
- get config values from command line
- accounts path in config
- search dialog to add to history
- node.comment
- config: max speed (total/per-ip)
- config: max connections (total/per-ip)
- user.ignoreLimits
- user.redirect
- config: bans
- config: min disk space
- https
- frontend: don't depend on cdn
- webdav?
- vfs: ability to remove/hide/rename files deep in a source
- administration interface
- log: ip2name
- apis in separated log file with parameters?
- errors in separated log file
- login without passing clear text password?
  we could use asymmetric encryption, possibly on a hashed password, that means
  we should store a hash2(hash1(password+salt1)), where hash1 is applied on both client
  and server, which grants that even if the encryption is broken only the salt-hashed
  is revealed, which compromises only this server and not others.   
  http://qnimate.com/asymmetric-encryption-using-web-cryptography-api/
