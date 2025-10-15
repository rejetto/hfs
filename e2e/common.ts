import { Page, test } from '@playwright/test'
import fs from 'fs'

export const username = 'rejetto'
export const password = 'password'
export const URL = 'http://[::1]:8081/'
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

export async function clickAdminMenu(page: Page, sectionName: string | RegExp) {
    const isPhone = await page.evaluate(() => window.matchMedia('(max-width: 600px)').matches)
    if (isPhone) {
        // On phones, admin navigation links are rendered inside a drawer that must be opened first.
        await page.getByRole('button', { name: 'menu' }).nth(0).click()
    }
    await page.getByRole('link', { name: sectionName }).click()
    // The admin page content updates asynchronously after route changes; this avoids transient flakiness across tests.
    await page.waitForTimeout(100)
}
