import { test as base, expect, chromium } from '@playwright/test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const html = await readFile(path.join(import.meta.dirname, 'fixtures/home.html'), 'utf8')

export const test = base.extend({
    extension: async ({}, use) => {
        const profile = await mkdtemp(path.join(tmpdir(), 'croptix-browser-'))
        const dist = path.join(root, 'dist')
        const context = await chromium.launchPersistentContext(profile, {
            channel: 'chromium',
            headless: true,
            serviceWorkers: 'block',
            args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--disable-background-networking']
        })
        const unexpected = []
        const aniListRequests = []
        const requests = []
        await context.route('**/*', async (route) => {
            const request = route.request()
            const url = new URL(request.url())
            requests.push({ url: url.href, method: request.method(), type: request.resourceType() })
            if (url.protocol === 'chrome-extension:' || url.protocol === 'blob:' || url.protocol === 'data:') return route.continue()
            if (url.origin === 'https://www.crunchyroll.com' && request.isNavigationRequest()) {
                return route.fulfill({ contentType: 'text/html', body: html })
            }
            if (url.origin === 'https://www.crunchyroll.com' && url.pathname === '/content/v2/discover/browse') {
                return route.fulfill({ json: { data: [{ id: 'ORIGINAL' }], total: 1 } })
            }
            if (url.origin === 'https://www.crunchyroll.com' && url.pathname === '/content/v2/cms/objects/TEST1') {
                return route.fulfill({ json: { data: [{ id: 'TEST1' }] } })
            }
            if (url.origin === 'https://www.crunchyroll.com' && url.pathname === '/f/v1/home') {
                return route.fulfill({ json: { children: [{ type: 'HeroCollection' }, { type: 'OtherCollection' }, { type: 'HistoryCollection' }] } })
            }
            if (url.origin === 'https://graphql.anilist.co') {
                if (request.method() === 'OPTIONS')
                    return route.fulfill({
                        status: 204,
                        headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' }
                    })
                aniListRequests.push({ headers: request.headers(), body: request.postDataJSON() })
                return route.fulfill({
                    headers: { 'access-control-allow-origin': '*' },
                    json: { data: { first: { media: [{ externalLinks: [{ url: 'https://www.crunchyroll.com/series/TEST1' }] }] }, second: { media: [] } } }
                })
            }
            unexpected.push(url.href)
            return route.abort('blockedbyclient')
        })
        await context.routeWebSocket('**/*', (socket) => {
            unexpected.push(socket.url())
            socket.close()
        })
        const page = await context.newPage()
        await page.goto('https://www.crunchyroll.com/')
        await page.waitForFunction(() => typeof window.CROPTIX_BASE_URL === 'string')
        const baseUrl = await page.evaluate(() => window.CROPTIX_BASE_URL)
        const popup = await context.newPage()
        await popup.goto(`${baseUrl}popup/popup.html`)
        await expect(popup.locator('#toggleDesign')).toBeEnabled()
        try {
            await use({ context, page, popup, baseUrl, unexpected, aniListRequests, requests })
            expect(unexpected, 'No request may escape the fixture allowlist').toEqual([])
        } finally {
            await context.close()
            await rm(profile, { recursive: true, force: true })
        }
    }
})
export { expect }
