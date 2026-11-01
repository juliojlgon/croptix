import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../public/popup/popup.js', import.meta.url), 'utf8')

async function popup(settings = {}, { getError = false, setError = false } = {}) {
    const saved = []
    const elements = Object.fromEntries(
        ['toggleDesign', 'togglePlayer', 'toggleAniList', 'settingsStatus'].map((id) => [
            id,
            {
                checked: false,
                disabled: true,
                textContent: '',
                listeners: {},
                addEventListener(type, listener) {
                    this.listeners[type] = listener
                }
            }
        ])
    )
    const chrome = {
        storage: {
            local: {
                async get() {
                    if (getError) throw new Error('Unavailable')
                    return settings
                },
                async set(value) {
                    if (setError) throw new Error('Unavailable')
                    saved.push(value)
                }
            }
        }
    }
    vm.runInNewContext(source, { chrome, document: { getElementById: (id) => elements[id] } })
    await new Promise((resolve) => setImmediate(resolve))
    return { elements, saved }
}

test('fresh or legacy preferences never implicitly opt in to AniList', async () => {
    for (const settings of [{}, { designEnabled: false }, { aniListEnabled: 'true' }, { aniListEnabled: 1 }]) {
        const { elements } = await popup(settings)
        assert.equal(elements.toggleAniList.checked, false)
        assert.equal(elements.togglePlayer.checked, true)
        assert.equal(elements.toggleDesign.checked, settings.designEnabled !== false)
        assert.equal(elements.toggleAniList.disabled, false)
    }
})

test('explicit settings load independently and changes only write the selected preference', async () => {
    const { elements, saved } = await popup({ aniListEnabled: true, playerEnabled: false, designEnabled: true })
    assert.equal(elements.toggleAniList.checked, true)
    assert.equal(elements.togglePlayer.checked, false)
    elements.toggleAniList.checked = false
    await elements.toggleAniList.listeners.change()
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{ aniListEnabled: false }])
    assert.equal(elements.toggleDesign.checked, true)
    assert.equal(elements.toggleAniList.disabled, false)
})

test('failed storage reads keep controls disabled and show a retry message', async () => {
    const { elements } = await popup({}, { getError: true })
    assert.equal(elements.toggleAniList.disabled, true)
    assert.match(elements.settingsStatus.textContent, /could not be loaded/)
})

test('failed writes restore checkbox state and allow retry', async () => {
    const { elements } = await popup({}, { setError: true })
    elements.toggleAniList.checked = true
    await elements.toggleAniList.listeners.change()
    assert.equal(elements.toggleAniList.checked, false)
    assert.equal(elements.toggleAniList.disabled, false)
    assert.match(elements.settingsStatus.textContent, /could not be saved/)
})

test('player changes explain the reload requirement', async () => {
    const { elements } = await popup()
    elements.togglePlayer.checked = false
    await elements.togglePlayer.listeners.change()
    assert.match(elements.settingsStatus.textContent, /Reload Crunchyroll/)
})

const contentSource = await readFile(new URL('../src/utils/content.ts', import.meta.url), 'utf8')
const { stripTypeScriptTypes } = await import('node:module')
const contentJs = stripTypeScriptTypes(contentSource).replace(/^import browser from ['"]\.\/browser['"];?\s*/m, '')

async function content(initial = { designEnabled: false, aniListEnabled: false }, { deferResponse = false } = {}) {
    let settings = initial
    let failReads = false
    let changeListener
    const calls = []
    const pending = []
    const document = new EventTarget()
    const element = () => ({ dataset: {}, addEventListener() {}, remove() {}, appendChild() {}, classList: { toggle() {}, remove() {} } })
    Object.assign(document, {
        documentElement: element(),
        head: element(),
        createElement: element,
        querySelectorAll: () => []
    })
    const browser = {
        runtime: { getURL: (path) => `chrome-extension://test/${path}` },
        storage: {
            local: {
                async get() {
                    if (failReads) throw new Error('Unavailable')
                    return settings
                }
            },
            onChanged: {
                addListener: (listener) => {
                    changeListener = listener
                }
            }
        }
    }
    vm.runInNewContext(contentJs, {
        browser,
        document,
        CustomEvent,
        Event,
        AbortController,
        setTimeout,
        clearTimeout,
        navigator: { userAgent: 'Desktop', platform: 'Linux', maxTouchPoints: 0 },
        window: { addEventListener() {} },
        fetch: async (url, init) => {
            calls.push({ url, init })
            if (deferResponse) await new Promise((resolve) => pending.push(resolve))
            return Response.json({ data: { first: { media: [] }, second: { media: [] } } })
        }
    })
    const flush = () => new Promise((resolve) => setImmediate(resolve))
    await flush()
    return {
        document,
        calls,
        release() {
            for (const resolve of pending.splice(0)) resolve()
        },
        async change(next, fail = false) {
            settings = { ...settings, ...next }
            failReads = fail
            changeListener(Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue }])), 'local')
            await flush()
        },
        latestSettings() {
            let detail
            document.addEventListener(
                'croptix:settings',
                (event) => {
                    detail = event.detail
                },
                { once: true }
            )
            document.dispatchEvent(new Event('croptix:settings-request'))
            return detail
        },
        async request(detail) {
            const response = new Promise((resolve) => {
                const listener = (event) => {
                    if (event.detail.id !== detail.id) return
                    document.removeEventListener('croptix:anilist-response', listener)
                    resolve(event.detail)
                }
                document.addEventListener('croptix:anilist-response', listener)
            })
            document.dispatchEvent(new CustomEvent('croptix:anilist-request', { detail }))
            return response
        }
    }
}

test('isolated broker ignores forged page consent and rejects invalid pagination', async () => {
    const app = await content()
    app.document.dispatchEvent(new CustomEvent('croptix:settings', { detail: { aniListEnabled: true, playerEnabled: true } }))
    assert.equal((await app.request({ id: 'forged', firstPage: 1, secondPage: 2 })).ok, false)
    assert.equal(app.calls.length, 0)
    await app.change({ aniListEnabled: true })
    assert.equal((await app.request({ id: 'invalid', firstPage: 0, secondPage: '2' })).ok, false)
    assert.equal(app.calls.length, 0)
})

test('isolated broker uses a fixed anonymous public query rather than caller parameters', async () => {
    const app = await content({ designEnabled: false, aniListEnabled: true })
    assert.equal(
        (await app.request({ id: 'valid', firstPage: 1, secondPage: 2, url: 'https://forbidden.invalid', headers: { Authorization: 'SYNTHETIC' }, query: 'PRIVATE' })).ok,
        true
    )
    assert.equal(app.calls.length, 1)
    assert.equal(app.calls[0].url, 'https://graphql.anilist.co')
    assert.equal(app.calls[0].init.credentials, 'omit')
    assert.equal(app.calls[0].init.referrerPolicy, 'no-referrer')
    assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].init.headers)), { 'content-type': 'application/json' })
    const body = JSON.parse(app.calls[0].init.body)
    assert.match(body.query, /externalLinks/)
    assert.doesNotMatch(body.query, /PRIVATE/)
    assert.deepEqual(body.variables, { firstPage: 1, secondPage: 2 })
})

test('a later storage read failure revokes AniList permission and fails closed', async () => {
    const app = await content({ designEnabled: false, aniListEnabled: true })
    assert.equal(app.latestSettings().aniListEnabled, true)
    await app.change({ designEnabled: false }, true)
    assert.equal(app.latestSettings().aniListEnabled, false)
    assert.equal((await app.request({ id: 'storage-failed', firstPage: 1, secondPage: 2 })).ok, false)
    assert.equal(app.calls.length, 0)
})

test('disabling AniList aborts in-flight broker work and rejects late successful data', async () => {
    const app = await content({ designEnabled: false, aniListEnabled: true }, { deferResponse: true })
    const result = app.request({ id: 'pending', firstPage: 1, secondPage: 2 })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(app.calls.length, 1)
    assert.equal((await app.request({ id: 'concurrent', firstPage: 3, secondPage: 4 })).ok, false)
    await app.change({ aniListEnabled: false })
    assert.equal(app.calls[0].init.signal.aborted, true)
    app.release()
    assert.equal((await result).ok, false)
    assert.equal(app.latestSettings().aniListEnabled, false)
})
