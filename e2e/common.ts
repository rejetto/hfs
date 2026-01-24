import { Page, test } from '@playwright/test'
import fs from 'fs'

export const username = 'rejetto'
export const password = 'password'
export const URL = 'http://[::1]:81/'
export const uploadName = 'uploaded'

const t = Date.UTC(2025, 0, 20, 3, 0, 0, 0) / 1000 // a fixed timestamp, for visual comparison

test.beforeAll(clearUploads)

export function clearUploads() {
    fs.unlink('tests/' + uploadName, () => {});
    resetTimestamp()
}

export function resetTimestamp() {
    fs.utimesSync('tests', t, t);
    fs.utimesSync('tests/alfa.txt', t, t);
}

export function forwardConsole(page: Page) {
    page.on('console', msg => console.log(msg.type(), msg.text()));
}