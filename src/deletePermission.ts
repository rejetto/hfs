import fs from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import Koa from 'koa'
import { defaultPerms, isWhoObject, PERM_KEYS, VfsPerms, WhoVfs } from './cross'
import { HTTP_FORBIDDEN } from './const'
import events from './events'
import { grantUploadOwnerDelete } from './uploadOwners'
import {
    applyParentToChild, getChildBySource, getVirtualName, hasPermission, parentMaskApplier, permsFromParent,
    renameUnderPath, statusCodeForMissingPerm, urlToNode, VfsNode, VfsNodeWithPath,
} from './vfs'

// unlike a listing, deletion affects hidden entries and must fail if any directory cannot be read
export async function checkDeletePermission(node: VfsNodeWithPath, ctx: Koa.Context): Promise<boolean> {
    if (statusCodeForMissingPerm(node, 'can_delete', ctx)) return false
    if (!node.source || !(await fs.lstat(node.source)).isDirectory()) return true
    return recur(node, [])

    async function recur(parent: VfsNodeWithPath, scopes: { node: VfsNode, path: string }[]): Promise<boolean> {
        // explicit VFS entries are not deletable, even when their source is several levels below this directory
        for (const child of explicitNodes(parent)) {
            if (!child.source) continue
            const path = relative(resolve(parent.source!), resolve(child.source))
            if (path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) continue
            try { await fs.lstat(child.source) }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
                throw error
            }
            ctx.status = HTTP_FORBIDDEN
            await reportBlocked(child)
            return false
        }

        const inherited = permsFromParent(parent, {}) || {}
        const keys = new Set<keyof VfsPerms>(['can_delete'])
        for (const key of keys) {
            addReferences(parent[key] ?? defaultPerms[key])
            addReferences(inherited[key] ?? defaultPerms[key])
        }
        // skip scanning descendants only when inherited permissions guarantee deletion and no deeper rule or plugin can override them
        if (!scopes.some(scope => hasRules(scope.node, keys)) && !hasRules(parent, keys)
            && !PERM_KEYS.some(key => isWhoObject(inherited[key]))
            && !events.hasOtherListeners('checkVfsPermission', grantUploadOwnerDelete)
            && !statusCodeForMissingPerm(inherited, 'can_delete', ctx, false, false))
            return true

        // only literal path prefixes can be exhausted by inheritMasks; other patterns may match again deeper down
        const persistentMasks = Object.fromEntries(Object.entries(parent.masks || {}).filter(([mask, mods]) =>
            mods && (PERM_KEYS.some(key => mods[key] !== undefined) || hasRules(mods, new Set(PERM_KEYS)))
                && (!mask.includes('/') || /[!*?\[\]{}()|\\]/.test(mask.split('/')[0]!))))
        if (Object.keys(persistentMasks).length)
            scopes = [...scopes, { node: { masks: persistentMasks }, path: '' }]

        for await (const entry of await fs.opendir(parent.source!)) {
            if (ctx.isAborted()) throw Error("Deletion cancelled")
            const source = join(parent.source!, entry.name)
            const name = getVirtualName(entry.name, parent, source)
            const explicit = getChildBySource(parent, source)
            // permission masks use the target type, but deletion must never recurse through the link
            const isFolder = entry.isSymbolicLink()
                ? await fs.stat(source).then(stats => stats.isDirectory(), error => {
                    if (error.code === 'ENOENT') return false
                    throw error
                }) : entry.isDirectory()
            const child: VfsNode = {
                ...explicit, original: explicit, source, isFolder,
                rename: explicit?.rename || renameUnderPath(parent.rename, entry.name),
            }
            const nextScopes = scopes.map(scope => ({ node: scope.node, path: scope.path + name }))
            for (const scope of [...nextScopes].reverse()) {
                parentMaskApplier(scope.node, true)(child, scope.path)
                parentMaskApplier(scope.node)(child, name)
            }
            const evaluated = applyParentToChild(child, parent, name)
            if (statusCodeForMissingPerm(evaluated, 'can_delete', ctx)) {
                await reportBlocked(evaluated)
                return false
            }
            // dirents do not follow symlinks, including dangling links
            if (entry.isDirectory() && !await recur(evaluated, nextScopes.map(scope => ({ ...scope, path: scope.path + '/' }))))
                return false
        }
        return true

        function addReferences(who: WhoVfs) {
            if (isWhoObject(who)) {
                if (who.this !== undefined) addReferences(who.this)
                if (who.children !== undefined) addReferences(who.children)
            }
            else if (typeof who === 'string' && PERM_KEYS.includes(who as keyof VfsPerms))
                keys.add(who as keyof VfsPerms)
        }
    }

    async function reportBlocked(blocked: VfsNodeWithPath) {
        // a deletion error must not disclose names hidden by access permissions
        let visible = blocked
        for (let ancestor: VfsNodeWithPath | undefined = blocked; ancestor && ancestor !== node; ancestor = ancestor.parent)
            if (!hasPermission(ancestor, 'can_see', ctx) || !await urlToNode(ancestor.vfsPath, ctx)
                || ancestor.parent && !hasPermission(ancestor.parent, 'can_list', ctx))
                visible = ancestor.parent || node
        ctx.body = { uri: '/' + visible.vfsPath }
    }

    function* explicitNodes(parent: VfsNodeWithPath): Generator<VfsNodeWithPath> {
        for (const child of parent.children || []) {
            const evaluated = applyParentToChild(child, parent)
            yield evaluated
            yield* explicitNodes(evaluated)
        }
    }
}

function hasRules(node: VfsNode, keys: Set<keyof VfsPerms>): boolean {
    return Boolean(node.children?.length || Object.values(node.masks || {}).some(mods =>
        mods && (Array.from(keys).some(key => mods[key] !== undefined) || hasRules(mods, keys))))
}
