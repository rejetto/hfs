# Directory cache

The directory cache keeps physical directory listings and basic file metadata in RAM to speed up browsing and search. It stores names, entry types, sizes, timestamps and hidden flags. It does not store file contents and is not saved across restarts.

Enable it in **Admin → Options → Others → Directory cache**.

| Setting | Behavior |
| --- | --- |
| Never | Disabled, the default. Listings are read from disk. |
| At start | Scan at startup and keep watching for changes. |
| Every 1 hour | Scan at startup, watch for changes, and refresh every hour. |
| Every 4 hours | Scan at startup, watch for changes, and refresh every 4 hours. |
| Every 24 hours | Scan at startup, watch for changes, and refresh every 24 hours. |

Enabling the cache while HFS is running starts the initial scan immediately. **Refresh now** requests a background refresh without changing the schedule.

## Refresh and filesystem watchers

Recursive watchers update the affected directories when the operating system reports changes. During a refresh, HFS continues using the previous listings and replaces each one when its new contents have been read completely. A failed read does not erase the previous snapshot; HFS uses direct filesystem access for that directory until a scan succeeds. Direct filesystem access is also used for directories that have not been cached yet.

Filesystem notifications can be incomplete, especially on network shares such as SMB and NFS. Changes made by another client may not reach the watcher. A periodic refresh reconciles the cache with the actual contents even when notifications are missed.

When HFS recognizes a network filesystem and periodic refresh is disabled, Admin shows **Periodic refresh is recommended**. Detection uses local drive and mount information and does not probe the network share. It runs when the cache is enabled without periodic refresh and when its configured source paths change.

Detection is best effort: no suggestion does not mean that notifications are reliable. Symlinks, unusual mounts, virtual filesystems and changes to mounts while HFS is running may escape detection. The administrator chooses the refresh interval; HFS does not enable one automatically.

## VFS and permissions

The cache follows physical directories, sharing their snapshots when multiple VFS entries point to the same location. VFS permissions, masks, virtual names and user-specific visibility are applied when each request is handled. They are not stored in the cache.

Downloads, ZIP creation and other file operations access the filesystem. The cache can briefly lag behind external changes, so an entry shown in a listing may have changed or disappeared before it is opened.

Large shared trees require memory for their entries and operating-system resources for recursive watching. Initial scans and scheduled refreshes read the shared directory trees. Choose a periodic interval appropriate to the size and speed of your storage.
