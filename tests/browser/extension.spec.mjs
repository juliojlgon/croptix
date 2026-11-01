import { readFile } from 'node:fs/promises'
import { test, expect } from './harness.mjs'

const browse = '/content/v2/discover/browse?sort_by=popularity&n=1'

test('fresh install defaults preserve Crunchyroll popularity and make no AniList request', async ({ extension }) => {
    const { page, popup, aniListRequests } = extension
    await expect(popup.locator('#toggleDesign')).toBeChecked()
    await expect(popup.locator('#togglePlayer')).toBeChecked()
    await expect(popup.locator('#toggleAniList')).not.toBeChecked()
    const result = await page.evaluate(async (url) => (await fetch(url)).json(), browse)
    expect(result.data[0].id).toBe('ORIGINAL')
    expect(aniListRequests).toHaveLength(0)
    await expect(page.locator('html')).toHaveClass(/croptix/)
})

test('AniList is opt-in, propagates across tabs and disables without reload', async ({ extension }) => {
    const { page, popup, context, aniListRequests } = extension
    await popup.locator('#toggleAniList').check()
    await expect(popup.locator('#settingsStatus')).toHaveText('Saved.')
    await expect.poll(async () => page.evaluate(async (url) => (await (await fetch(url)).json()).data[0].id, browse)).toBe('TEST1')
    expect(aniListRequests.length).toBeGreaterThan(0)
    for (const request of aniListRequests) {
        expect(request.headers.authorization).toBeUndefined()
        expect(request.headers.cookie).toBeUndefined()
        expect(request.headers.referer).toBeUndefined()
        expect(Object.keys(request.body)).toEqual(['query', 'variables'])
    }
    const second = await context.newPage()
    await second.goto('https://www.crunchyroll.com/watch/fixture')
    await second.waitForFunction(() => typeof window.CROPTIX_BASE_URL === 'string')
    await popup.locator('#toggleAniList').uncheck()
    await expect(popup.locator('#settingsStatus')).toHaveText('Saved.')
    for (const tab of [page, second]) {
        await expect.poll(async () => tab.evaluate(async (url) => (await (await fetch(url)).json()).data[0].id, browse)).toBe('ORIGINAL')
    }
    const count = aniListRequests.length
    await page.evaluate(async (url) => (await fetch(url)).json(), browse)
    expect(aniListRequests).toHaveLength(count)
})

test('page scripts cannot forge consent or choose broker request contents', async ({ extension }) => {
    const { page, popup, aniListRequests } = extension
    await page.evaluate(() => {
        document.dispatchEvent(new CustomEvent('croptix:settings', { detail: { aniListEnabled: true, playerEnabled: true } }))
        document.dispatchEvent(new CustomEvent('croptix:anilist-request', { detail: { id: 'forged-off', firstPage: 1, secondPage: 2 } }))
    })
    expect(await page.evaluate(async (url) => (await (await fetch(url)).json()).data[0].id, browse)).toBe('ORIGINAL')
    expect(aniListRequests).toHaveLength(0)
    await popup.locator('#toggleAniList').check()
    await expect(popup.locator('#settingsStatus')).toHaveText('Saved.')
    const rejected = await page.evaluate(async () => {
        const response = new Promise((resolve) => {
            const listener = (event) => {
                if (event.detail.id !== 'invalid-pages') return
                document.removeEventListener('croptix:anilist-response', listener)
                resolve(event.detail)
            }
            document.addEventListener('croptix:anilist-response', listener)
        })
        document.dispatchEvent(
            new CustomEvent('croptix:anilist-request', {
                detail: { id: 'invalid-pages', firstPage: 0, secondPage: '2', url: 'https://forbidden.invalid', headers: { Authorization: 'SYNTHETIC' } }
            })
        )
        return response
    })
    expect(rejected.ok).toBe(false)
    expect(aniListRequests).toHaveLength(0)
})

test('legacy design preference does not implicitly enable AniList', async ({ extension }) => {
    const { page, popup, aniListRequests } = extension
    await popup.evaluate(() => chrome.storage.local.set({ designEnabled: false }))
    await page.reload()
    await expect(page.locator('html')).not.toHaveClass(/croptix/)
    expect(await page.evaluate(async (url) => (await (await fetch(url)).json()).data[0].id, browse)).toBe('ORIGINAL')
    expect(aniListRequests).toHaveLength(0)
})

test('DOM updates keep the final mutation and preserve input/control focus', async ({ extension }) => {
    const { page, popup } = extension
    await expect(page.locator('html')).toHaveClass(/croptix-player/)
    await page.locator('#search').focus()
    await page.evaluate(() => {
        document.querySelector('.player-container').remove()
        setTimeout(() => {
            const player = document.createElement('div')
            player.className = 'player-container'
            player.innerHTML = '<div></div><div id="replacement">Replacement</div>'
            document.querySelector('#wrapper').append(player)
        }, 20)
    })
    await expect(page.locator('#replacement')).toBeAttached()
    await expect(page.locator('#wrapper')).toHaveClass(/croptix-katamari/)
    await expect(page.locator('#search')).toBeFocused()
    await page.locator('#outside').focus()
    await page.evaluate(() => document.body.append(document.createElement('div')))
    await expect(page.locator('#outside')).toBeFocused()
    await popup.locator('#toggleDesign').uncheck()
    await expect(page.locator('html')).not.toHaveClass(/croptix-player/)
    await expect(page.locator('#wrapper')).not.toHaveClass(/croptix-katamari/)
    await expect(page.locator('#playerFocus')).toHaveCount(0)
    await page.evaluate(() => document.body.append(document.createElement('div')))
    await expect(page.locator('html')).not.toHaveClass(/croptix-player/)
})

test('player setting is independent and applies after reload', async ({ extension }) => {
    const { page, popup } = extension
    await popup.locator('#togglePlayer').uncheck()
    await expect(popup.locator('#settingsStatus')).toContainText('Reload Crunchyroll')
    await expect(page.locator('html')).toHaveClass(/croptix-player/)
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/croptix/)
    await expect(page.locator('html')).not.toHaveClass(/croptix-player/)
    await expect(popup.locator('#toggleAniList')).not.toBeChecked()
})

test('packaged subtitle worker renders using packaged WASM and fallback font, then disposes', async ({ extension }) => {
    const { page, baseUrl } = extension
    const captions = await readFile(new URL('./fixtures/captions.ass', import.meta.url), 'utf8')
    await page.evaluate(
        ({ baseUrl, captions }) => {
            window.subtitleState = { ready: false, error: null }
            const canvas = document.createElement('canvas')
            canvas.width = 640
            canvas.height = 360
            document.body.append(canvas)
            const workerSource = `var Module = { locateFile: function(path) { return ${JSON.stringify(baseUrl + 'subtitle-octopus/')} + path; } }; importScripts(${JSON.stringify(baseUrl + 'subtitle-octopus/subtitles-octopus-worker.js')});`
            window.subtitleWorkerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }))
            window.subtitle = new SubtitlesOctopus({
                canvas,
                subContent: captions,
                workerUrl: window.subtitleWorkerUrl,
                fallbackFont: baseUrl + 'fonts/default.woff2',
                onReady: () => {
                    window.subtitleState.ready = true
                    window.subtitle.setCurrentTime(1)
                },
                onError: (error) => {
                    window.subtitleState.error = String(error)
                }
            })
        },
        { baseUrl, captions }
    )
    await expect.poll(() => page.evaluate(() => window.subtitleState)).toEqual({ ready: true, error: null })
    await expect
        .poll(() =>
            page.evaluate(() => {
                const canvas = window.subtitle.canvas
                const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
                return pixels.some((value, index) => index % 4 === 3 && value > 0)
            })
        )
        .toBe(true)
    expect(
        await page.evaluate(() => {
            window.subtitle.dispose()
            URL.revokeObjectURL(window.subtitleWorkerUrl)
            return window.subtitle.worker === null
        })
    ).toBe(true)
})
