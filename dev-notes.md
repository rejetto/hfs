# To do
- sticky breadcrumbs
- filter list
- search
    try to use server-sent events for the reply
    https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- frontend: dialogs
- vfs: serve an html for a folder?
  - "default" property for vfsNode?
- interruption of long requests if client aborted (searching/listing)
- throttle speed
- frontend
  - don't depend on cdn
- webdav?
- streamable zip archives
  - no compression 
  - resumable?
- vfs: ability to remove/hide/rename files deep in a source
- let user change password
- user should be able to inherit from another a group (another user)
- login without passing clear text password?
  we could use asymmetric encryption, possibly on a hashed password, that means
  we should store a hash2(hash1(password+salt1)), where hash1 is applied on both client
  and server, which grants that even if the encryption is broken only the salt-hashed
  is revealed, which compromises only this server and not others.   
  http://qnimate.com/asymmetric-encryption-using-web-cryptography-api/
