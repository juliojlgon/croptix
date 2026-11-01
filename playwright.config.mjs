import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: './tests/browser',
    timeout: 30000,
    expect: { timeout: 5000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
