import { defineConfig, devices } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'yaml';

// isolated Admin logic regressions need one browser; end-to-end flows, calendars and drag retain all projects
const adminLogicTests = [
  '**/admin-acme.spec.ts',
  '**/admin-accounts.spec.ts',
  '**/admin-config-file.spec.ts',
  '**/admin-custom-html.spec.ts',
  '**/admin-data-table.spec.ts',
  '**/admin-file-field.spec.ts',
  '**/admin-file-form.spec.ts',
  '**/admin-home.spec.ts',
  '**/admin-languages.spec.ts',
  '**/admin-list-reconnect.spec.ts',
]

const snapshotBranch = getSnapshotBranch()
// use the same test port source as tests/test.ts to avoid config drift
const testPort = Number(yaml.parse(readFileSync(resolve(process.cwd(), 'tests/config.yaml'), 'utf8')).port)
const adminViteUrl = 'http://127.0.0.1:3112/'

// fixture tests replace an Admin page module, so they must load from Vite instead of the packaged Admin app
for (const name of [
  'ACME', 'API_LIST', 'DATA_TABLE', 'DATE_TIME', 'DIALOG', 'FILE_FIELD', 'FILE_FORM', 'CSV',
  'PLUGIN_OPTIONS', 'STATE', 'WHO_FIELD', 'VFS_MOVE', 'VFS_TREE',
])
  process.env[`ADMIN_${name}_URL`] ||= adminViteUrl + '#/monitoring'
process.env.ADMIN_ADD_FILES_URL ||= adminViteUrl + '#/shared'
process.env.ADMIN_VFS_PAGE_URL ||= adminViteUrl + '#/shared'
process.env.ADMIN_LANGUAGES_URL ||= adminViteUrl + '#/language'
process.env.ADMIN_LOGS_URL ||= adminViteUrl + '#/logs'
process.env.ADMIN_CATALOG_URL ||= adminViteUrl
process.env.ADMIN_LIST_URL ||= adminViteUrl

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: `{testDir}/{testFilePath}-snapshots-${snapshotBranch}/{arg}-{projectName}-{platform}{ext}`,
  timeout: 30_000,
  fullyParallel: true, // Run tests in files in parallel
  forbidOnly: !!process.env.CI, // Fail the build on CI if you accidentally left test.only in the source code.
  retries: process.env.CI ? 2 : 0, // Retry on CI only
  updateSnapshots: 'missing', // keep new baseline screenshots from failing the run; existing screenshots still compare normally
  //workers: process.env.CI ? 1 : undefined, // Opt out of parallel tests on CI.
  reporter: 'html', // Reporter to use. See https://playwright.dev/docs/test-reporters
  use: { // Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions.
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://127.0.0.1:3000',

    /* Keep the failed attempt and the retry trace together so flake diffs are easier to compare. */
    trace: 'retain-on-failure-and-retries',
    screenshot: 'only-on-failure',
    timezoneId: 'Europe/Rome',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'Android',
      testIgnore: adminLogicTests,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'iPhone 6',
      testIgnore: adminLogicTests,
      use: { ...devices['iPhone 6'] },
    },
    {
      name: 'firefox',
      testIgnore: adminLogicTests,
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          // Firefox can purge localhost-like state during bounce-tracker heuristics in tests.
          firefoxUserPrefs: { 'privacy.bounceTrackingProtection.mode': 0 },
        },
      },
    },
/*
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },*/

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  expect: {
    toHaveScreenshot: {
      stylePath: 'e2e/screenshot.css',
      threshold: 0.5,
    },
  },
  /* Run your local dev server before starting the tests */
   webServer: [{
     command: `mkdir -p tests/work/plugins/test tests/work/cant-overwrite`
     + ` && printf '%s\\n' "exports.apiRequired = 1" "exports.config = {" "    icons: { type: 'array', fields: { iconFile: { type: 'real_path' } } }," "}" > tests/work/plugins/test/plugin.js`
     + ` && npm run server-for-test${process.env.TEST_WITH_UI ? '-dev' : ''}`, // use server-for-test-dev only for "test-with-ui"
     // concurrent frontend tests need the first real list response, not just an open HTTP port
     url: `http://[::1]:${testPort}/~/api/get_file_list`,
     reuseExistingServer: !process.env.CI,
   }, { // launch a second server for tests with an empty/default config
       command: 'rm -rf tests/work2 && node dist/src --cwd tests/work2 --debug --port 8082 --open_browser_at_start false', // the port here is just to avoid getting the "port busy" console warning
       reuseExistingServer: !process.env.CI,
   }, {
       command: 'npm run start --workspace=admin -- --host 127.0.0.1 --port 3112 --strictPort',
       url: adminViteUrl,
       reuseExistingServer: !process.env.CI,
   }]
});

function getSnapshotBranch() {
  // CI often runs in detached HEAD, so allow callers to force the logical branch name.
  const branchName = process.env.PLAYWRIGHT_SNAPSHOT_BRANCH || getGitBranchName() || 'main'
  return branchName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function getGitBranchName() {
  return (gitOutput('git branch --show-current')
      || gitOutput('git for-each-ref --format="%(refname:short)" --contains HEAD refs/heads refs/remotes'))
      ?.split('\n')
      .map(x => x.trim())
      .filter(x => x && !x.endsWith('/HEAD'))
      .map(x => x.replace(/^[^/]+\//, ''))
      .at(0)
}

function gitOutput(command: string) {
  try { return execSync(command, { encoding: 'utf8' }).trim() }
  catch {}
}
