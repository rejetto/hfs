import { test } from '@playwright/test'
import { wait } from '../src/cross'
import { clearUploads, password, uploadName, URL, username } from './common'

// this test is separated to run serially, as it will modify folder timestamp for a few seconds, during which other tests may fail

export const fileToUpload = 'dev-plugins.md'

test('upload1', async ({ page, context, browserName }) => {
    if (page.viewportSize()?.width! < 1000 || browserName !== 'chromium') return // test only for desktop, as only chromium has cdpSession, and to disconnect i need only 1 upload at a time
    await page.goto(URL);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('div').filter({ hasText: 'Logged in' }).nth(3).click();

    await page.getByRole('link', { name: 'for-admins, Folder' }).click();
    await page.getByRole('link', { name: 'upload, Folder' }).click();

    await page.getByRole('button', { name: 'Options' }).click();
    const pageAdminPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Admin-panel' }).click();
    const pageAdmin = await pageAdminPromise;
    await pageAdmin.goto(URL + '~/admin/#/monitoring'); // cross-device way of changing page
    await page.locator('div').filter({ hasText: 'xOptionsAdmin-panelSort by:' }).nth(2).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Upload' }).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Pick files' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(fileToUpload);
    // can't do without. I tried using route.continue, but i can't send half-body keeping the full content-length, and i also cannot pass a stream (to throttle)
    const cdpSession = await context.newCDPSession(page)
    await cdpSession.send('Network.emulateNetworkConditions', NETWORK_PRESETS.Regular2G)
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('textbox').fill(uploadName);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(uploadName)).toBeVisible() // rename was effective
    await page.getByRole('button', { name: 'Send 1 file' }).click();
    await wait(1500)
    await pageAdmin.getByRole('cell', { name: uploadName }).click();
    await pageAdmin.getByRole('button', { name: '(Disconnect)' }).click();
    await pageAdmin.getByRole('button', { name: '(Close)' }).click();
    await pageAdmin.close()
    await page.getByText('Copy links').click();
    await page.getByText('Operation successful').click();
    await page.getByRole('button', { name: 'Close' }).click();
    await cdpSession?.send('Network.emulateNetworkConditions', NETWORK_PRESETS.NoThrottle)
    clearUploads()
});

const NETWORK_PRESETS = {
    Offline: {
        offline: true,
        downloadThroughput: 0,
        uploadThroughput: 0,
        latency: 0,
        connectionType: 'none',
    },
    NoThrottle: {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
    },
    Regular2G: {
        offline: false,
        downloadThroughput: (250 * 1024) / 8,
        uploadThroughput: (120 * 1024) / 8,
        latency: 300,
        connectionType: 'cellular2g',
    },
} as const;
