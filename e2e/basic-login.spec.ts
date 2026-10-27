import { test, expect } from '@playwright/test'
import { FRONTEND_URL, username, password } from './common'

test.use({ javaScriptEnabled: false })

for (const userAgent of [
    'Mozilla/5.0 (Windows NT 6.1; rv:30.0) Gecko/20100101 Firefox/30.0',
    'Mozilla/5.0 Chrome/134.0.0.0 Safari/537.36',
]) {
    test.describe(userAgent, () => {
        test.use({ userAgent })

        test('basic form login and repeated logout work without JavaScript or HTTP credentials', async ({ page }, testInfo) => {
            const folder = FRONTEND_URL + 'for-admins/?get=basic'
            for (let attempt = 0; attempt < 2; attempt++) {
                const response = await page.goto(folder)
                expect(response?.status()).toBe(401)
                expect(response?.headers()['www-authenticate']).toBeUndefined()
                await page.getByLabel('Username:', { exact: true }).fill(username)
                await page.getByLabel('Password:', { exact: true }).fill(password)
                await page.getByRole('button', { name: 'Login', exact: true }).click()
                await expect(page).toHaveURL(folder)
                await page.getByRole('button', { name: `Logout (${username})`, exact: true }).click()
                await expect(page).toHaveURL(folder)
                await expect(page.getByLabel('Password:', { exact: true })).toBeVisible()
            }
            await page.goto(folder)
            await expect(page.getByLabel('Password:', { exact: true })).toBeVisible()
            await testInfo.attach('basic-login', { body: await page.screenshot(), contentType: 'image/png' })
        })
    })
}

test('basic form reports wrong credentials and returns to a protected file', async ({ page }) => {
    const file = FRONTEND_URL + 'for-admins/alfa.txt?get=basic'
    await page.goto(file)
    await page.getByLabel('Username:', { exact: true }).fill(username)
    await page.getByLabel('Password:', { exact: true }).fill('wrong-password')
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await expect(page.getByText('Invalid username or password.', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Password:', { exact: true })).toHaveValue('')
    await page.getByLabel('Username:', { exact: true }).fill(username)
    await page.getByLabel('Password:', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await expect(page).toHaveURL(file)
    await expect(page.locator('body')).not.toContainText('Login')
})

test('basic form requires its session token and rejects external return URLs', async ({ page }) => {
    const endpoint = FRONTEND_URL + '?get=login'
    await page.goto(endpoint)
    await page.getByLabel('Username:', { exact: true }).fill(username)
    await page.getByLabel('Password:', { exact: true }).fill(password)
    await page.locator('input[name="csrf"]').evaluate((input: HTMLInputElement) => input.value = 'wrong')
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await expect(page.getByText('Cookies are required. Reload the login page and try again.', { exact: true })).toBeVisible()
    await page.goto(endpoint)
    await page.getByLabel('Username:', { exact: true }).fill(username)
    await page.getByLabel('Password:', { exact: true }).fill(password)
    await page.locator('input[name="returnTo"]').evaluate((input: HTMLInputElement) => input.value = 'https://attacker.test/')
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await expect(page).toHaveURL(FRONTEND_URL + '?get=basic')
    await page.goto(FRONTEND_URL + 'for-admins/?get=basic')
    await page.locator('input[name="csrf"]').evaluate((input: HTMLInputElement) => input.value = 'wrong')
    await page.getByRole('button', { name: `Logout (${username})`, exact: true }).click()
    await expect(page.getByText('Cookies are required. Reload the login page and try again.', { exact: true })).toBeVisible()
    await page.goto(FRONTEND_URL + 'for-admins/?get=basic')
    await expect(page.getByRole('button', { name: `Logout (${username})`, exact: true })).toBeVisible()
})

test('basic form cannot log in without the session cookie', async ({ page }) => {
    const endpoint = FRONTEND_URL + '?get=login'
    await page.goto(endpoint)
    await page.getByLabel('Username:', { exact: true }).fill(username)
    await page.getByLabel('Password:', { exact: true }).fill(password)
    await page.context().clearCookies()
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await expect(page.getByText('Cookies are required. Reload the login page and try again.', { exact: true })).toBeVisible()
    await page.goto(FRONTEND_URL + 'for-admins/?get=basic')
    await expect(page.getByLabel('Password:', { exact: true })).toBeVisible()
})

test('basic logout stays on the public folder even without a Referer header', async ({ page }) => {
    await page.route('**/*', async route => {
        const headers = { ...route.request().headers() }
        delete headers.referer
        await route.continue({ headers })
    })
    await page.goto(FRONTEND_URL + 'for-admins/?get=basic')
    await page.getByLabel('Username:', { exact: true }).fill(username)
    await page.getByLabel('Password:', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    const folder = FRONTEND_URL + 'tests/?get=basic'
    await page.goto(folder)
    await page.getByRole('button', { name: `Logout (${username})`, exact: true }).click()
    await expect(page).toHaveURL(folder)
    await expect(page.getByRole('link', { name: 'Login', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'page/', exact: true })).toBeVisible()
    await page.goto(FRONTEND_URL + 'for-admins/?get=basic')
    await expect(page.getByLabel('Password:', { exact: true })).toBeVisible()
})
