import _ from 'lodash'
import type { Release } from './update'

export function updateChangelog(destination: Release, releases: Release[], currentVersion: number) {
    const newer = _.sortBy(_.uniqBy([destination, ...releases], 'tag_name')
        .filter(r => !r.prerelease && r.versionScalar > currentVersion && r.versionScalar <= destination.versionScalar),
        r => -r.versionScalar)
    const level = Math.max(...newer.map(releaseLevel))
    const seen = new Set<string>()
    const sections = newer.filter(r => releaseLevel(r) === level).map(r => {
        let body = r.body.trim()
        if (level === 0) {
            // deduplicate complete entries, preserving continuation lines and nested lists
            body = body.replace(/\r\n/g, '\n').split(/\n{2,}|\n(?=[*+-] )/).filter(entry => {
                const key = entry.trim().replace(/^[*+-] /, '')
                if (!key || seen.has(key)) return false
                seen.add(key)
                return true
            }).join('\n\n')
        }
        return { tag: r.tag_name, body }
    }).filter(r => r.body)
    return sections.map(r => r.tag === destination.tag_name ? r.body : `**${r.tag}**\n\n${r.body}`).join('\n\n') || destination.body

    function releaseLevel(r: Release) {
        return r.versionScalar % 1E6 === 0 ? 2 : r.versionScalar % 1E3 === 0 ? 1 : 0
    }
}
