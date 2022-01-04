# To do
- anti-csrf
- upload
- search and login dialogs should push to history so that mobile can use back button to close them
- node.comment
- config: max speed (total/per-ip)
- config: max connections (total/per-ip)
- user.ignoreLimits
- user.redirect
- config: bans
- config: min disk space
- link to parent folder in the list (as an option of the frontend?)
- archive for search results
- archive only selected files
- https
- frontend: light/dark theme
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
