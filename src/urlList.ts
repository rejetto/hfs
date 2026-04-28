// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

// utilities to pass a list of files via url

// not easy to find chars that are not allowed in file names both for windows and unix
const URL_LIST_SEPARATOR = '//'
const URL_LIST_SAME_FOLDER = '\0' // nul cannot be a valid file name char, and query encoding carries it as %00 without conflicting with path slashes

export function encodeUrlList(entries: string[]) {
    let previousFolder = ''
    return entries.map(entry => {
        const slash = entry.lastIndexOf('/')
        const folder = slash < 0 ? '' : entry.slice(0, slash + 1)
        const name = slash < 0 ? entry : entry.slice(slash + 1)
        if (folder && folder === previousFolder)
            return URL_LIST_SAME_FOLDER + name
        previousFolder = folder
        return entry
    }).join(URL_LIST_SEPARATOR)
}

export function decodeUrlList(list?: string) {
    let previousFolder = ''
    return list?.split(URL_LIST_SEPARATOR).map(entry => {
        const sameFolder = entry.startsWith(URL_LIST_SAME_FOLDER)
        if (sameFolder && previousFolder)
            entry = previousFolder + entry.slice(URL_LIST_SAME_FOLDER.length)
        const slash = entry.lastIndexOf('/')
        previousFolder = slash < 0 ? '' : entry.slice(0, slash + 1)
        return entry
    })
}
