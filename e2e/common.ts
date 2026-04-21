import { Page, test } from '@playwright/test'
import fs from 'fs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'yaml'
import { ADMIN_URI } from '../src/cross-const'

export const username = 'rejetto'
export const password = 'password'
// keep e2e URL aligned with the same config file used by tests/test.ts and server-for-test
const TEST_PORT = Number(yaml.parse(readFileSync(resolve(process.cwd(), 'tests/config.yaml'), 'utf8')).port)
export const FRONTEND_URL = `http://[::1]:${TEST_PORT}/`
export const ADMIN_URL = new URL(ADMIN_URI, FRONTEND_URL).href
export const uploadName = 'uploaded'

const t = Date.UTC(2025, 0, 20, 3, 0, 0, 0) / 1000 // a fixed timestamp, for visual comparison

test.beforeAll(clearUploads)

// dump page DOM on failure to help diagnose flaky tests
test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === 'failed')
        await testInfo.attach('dom', { body: await page.content(), contentType: 'text/html' })
})

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

export async function clickAdminMenu(page: Page, sectionName: string | RegExp) {
    const isPhone = (page as any).isPhone ??= await page.evaluate(() => window.matchMedia('(max-width: 600px)').matches)
    if (isPhone) {
        // On phones, admin navigation links are rendered inside a drawer that must be opened first.
        await page.getByRole('button', { name: 'menu' }).nth(0).click()
    }
    await page.getByRole('link', { name: sectionName }).click()
    // The admin page content updates asynchronously after route changes; this avoids transient flakiness across tests.
    await page.waitForTimeout(100)
}

// only for admin-panel
export function clickIconBtn(title: string | RegExp, page: Page) {
    return page.getByLabel(title).getByRole('button').click()
}

export async function loginAdmin(page: Page) {
    await page.goto(ADMIN_URL)
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('textbox', { name: 'Password' }).press('Enter')
    const isPhone = await page.evaluate(() => window.matchMedia("(max-width: 600px)").matches)
    ;(page as any).isPhone = isPhone
    return isPhone
}
