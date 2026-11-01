import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../src/utils/crunchyroll.js', import.meta.url), 'utf8')
const origin = 'https://www.crunchyroll.com'
const browse = `${origin}/content/v2/discover/browse?sort_by=popularity&n=1`
const tick = () => new Promise((resolve) => setImmediate(resolve))
const original = { data: [{ id: 'ORIGINAL' }], total: 1 }
const history = { children: [{ type: 'HeroCollection' }, { type: 'OtherCollection' }, { type: 'HistoryCollection' }] }
const idsResponse = (ids = ['FIRST', 'SECOND']) => ({
    data: { first: { media: ids.map((id) => ({ externalLinks: [{ url: `${origin}/series/${id}` }] })) }, second: { media: [] } }
})

function fixture(options = {}) {
    const calls = []
    let now = Date.now()
    const document = new EventTarget()
    class FakeXHR extends EventTarget {
        readyState = 0
        responseType = ''
        body = ''
        sends = 0
        headers = new Headers()
        open(method, url, async = true) {
            this.method = method
            this.url = String(url)
            this.readyState = 1
            this.sent = false
            this.async = async
            this.headers = new Headers()
        }
        setRequestHeader(name, value) {
            if (this.sent) throw new DOMException('sent', 'InvalidStateError')
            this.headers.append(name, value)
        }
        send() {
            if (this.readyState !== 1 || this.sent) throw new DOMException('invalid', 'InvalidStateError')
            this.sent = true
            this.sends++
            const finish = () => {
                if (this.readyState !== 1) return
                this.body = JSON.stringify(this.url.includes('/f/v1/home') ? history : original)
                this.readyState = 4
                this.dispatchEvent(new Event('load'))
            }
            if (this.async) setImmediate(finish)
            else finish()
        }
        abort() {
            this.readyState = 0
            this.dispatchEvent(new Event('abort'))
        }
        get responseText() {
            return this.body
        }
        get response() {
            return this.responseType === 'json' ? JSON.parse(this.body) : this.body
        }
    }
    const w = {
        location: { href: options.page ?? `${origin}/` },
        XMLHttpRequest: FakeXHR,
        fetch: async (input, init = {}) => {
            const url = input instanceof Request ? input.url : /^https?:/.test(String(input)) ? String(input) : new URL(String(input), origin).href
            calls.push({ url, init })
            assert.notEqual(url, 'https://graphql.anilist.co', 'MAIN world must not fetch AniList directly')
            if (url.includes('/cms/objects/')) {
                if (options.catalog) return options.catalog(url, init)
                return Response.json({
                    data: url
                        .split('/objects/')[1]
                        .split('?')[0]
                        .split(',')
                        .map((id) => ({ id }))
                })
            }
            if (options.native) return options.native(url, init)
            return Response.json(url.includes('/f/v1/home') ? history : original)
        }
    }
    const context = vm.createContext({
        window: w,
        document,
        Event,
        CustomEvent,
        Headers,
        Request,
        Response,
        URL,
        DOMException,
        AbortController,
        Date: { now: () => now },
        setTimeout: (fn, ms) => setTimeout(fn, options.fastTimeout && ms === 5000 ? 10 : ms),
        clearTimeout,
        console
    })
    const brokerControllers = new Map()
    document.addEventListener('croptix:anilist-cancel', (event) => brokerControllers.get(event.detail.id)?.abort())
    document.addEventListener('croptix:anilist-request', (event) => {
        const { id, firstPage, secondPage } = event.detail
        const controller = new AbortController()
        brokerControllers.set(id, controller)
        calls.push({ url: 'https://graphql.anilist.co', channel: 'isolated-broker', request: event.detail, init: { signal: controller.signal } })
        void (async () => {
            try {
                const response = options.anilist ? await options.anilist({ signal: controller.signal }, calls) : Response.json(idsResponse())
                const json = await response.json()
                document.dispatchEvent(new CustomEvent('croptix:anilist-response', { detail: { id, ok: response.ok && !json.errors?.length, data: json.data } }))
            } catch {
                document.dispatchEvent(new CustomEvent('croptix:anilist-response', { detail: { id, ok: false } }))
            } finally {
                brokerControllers.delete(id)
            }
        })()
    })
    vm.runInContext(source, context)
    const settings = (enabled) => document.dispatchEvent(new CustomEvent('croptix:settings', { detail: { aniListEnabled: enabled } }))
    return {
        w,
        calls,
        document,
        settings,
        context,
        advance: (ms) => {
            now += ms
        },
        fetch: async (url = browse, init) => (await w.fetch(url, init)).json(),
        aniCalls: () => calls.filter((call) => call.url === 'https://graphql.anilist.co')
    }
}

test('fresh/upgrade and invalid preferences preserve native popularity without any AniList traffic', async () => {
    const f = fixture()
    assert.deepEqual(await f.fetch(), original)
    for (const value of [undefined, false, 'true', 1]) {
        f.settings(value)
        assert.deepEqual(await f.fetch(), original)
    }
    assert.equal(f.aniCalls().length, 0)
})

test('opt-in ranks results through isolated broker and never sends sensitive data in page events', async () => {
    const f = fixture()
    f.settings(true)
    assert.equal((await f.fetch(browse, { headers: { authorization: 'Bearer SYNTHETIC', 'x-device-id': 'SYNTHETIC_DEVICE' } })).data[0].id, 'FIRST')
    const ani = f.aniCalls()[0]
    assert.equal(ani.channel, 'isolated-broker')
    assert.deepEqual(Object.keys(ani.request).sort(), ['firstPage', 'id', 'secondPage'])
    assert.equal(ani.request.firstPage, 1)
    assert.equal(ani.request.secondPage, 2)
    assert.ok(!JSON.stringify(ani.request).includes('SYNTHETIC'))
    const catalog = f.calls.find((call) => call.url.includes('/cms/objects/'))
    assert.equal(new Headers(catalog.init.headers).get('authorization'), 'Bearer SYNTHETIC')
    assert.equal(new URL(catalog.url).origin, origin)
})

test('turning off clears the cache and requires a fresh public query on next opt-in', async () => {
    const f = fixture()
    f.settings(true)
    await f.fetch()
    f.settings(false)
    assert.deepEqual(await f.fetch(), original)
    assert.equal(f.aniCalls().length, 1)
    f.settings(true)
    await f.fetch()
    assert.equal(f.aniCalls().length, 2)
})

test('disabling aborts outstanding ranking requests and discards late responses', async () => {
    let release
    const f = fixture({
        anilist: () =>
            new Promise((resolve) => {
                release = resolve
            })
    })
    f.settings(true)
    const pending = f.fetch()
    await tick()
    const signal = f.aniCalls()[0].init.signal
    f.settings(false)
    assert.equal(signal.aborted, true)
    release(Response.json(idsResponse()))
    assert.deepEqual(await pending, original)
    assert.equal(
        f.calls.some((call) => call.url.includes('/cms/objects/')),
        false
    )
})

test('old opt-in responses cannot affect a later opt-in session', async () => {
    let release
    let count = 0
    const f = fixture({
        anilist: () =>
            ++count === 1
                ? new Promise((resolve) => {
                      release = resolve
                  })
                : Response.json(idsResponse(['NEW']))
    })
    f.settings(true)
    const pending = f.fetch()
    await tick()
    f.settings(false)
    f.settings(true)
    assert.equal((await f.fetch()).data[0].id, 'NEW')
    release(Response.json(idsResponse(['OLD'])))
    assert.deepEqual(await pending, original)
    assert.equal((await f.fetch()).data[0].id, 'NEW')
})

test('strict HTTPS origin and GET checks preserve foreign, lookalike, and non-GET requests', async () => {
    const f = fixture()
    f.settings(true)
    for (const url of [
        browse.replace(origin, 'https://example.invalid'),
        browse.replace(origin, 'http://www.crunchyroll.com'),
        browse.replace(origin, 'https://www.crunchyroll.com.evil.invalid')
    ]) {
        assert.deepEqual(await f.fetch(url), original)
    }
    assert.deepEqual(await f.fetch(browse, { method: 'POST' }), original)
    assert.equal(f.aniCalls().length, 0)
    const foreignPage = fixture({ page: 'https://example.invalid/' })
    foreignPage.settings(true)
    assert.deepEqual(await foreignPage.fetch(), original)
    assert.equal(foreignPage.aniCalls().length, 0)
})

test('homepage ordering, unrelated data and repeated injection remain stable', async () => {
    const f = fixture()
    assert.deepEqual(
        (await f.fetch(`${origin}/f/v1/home`)).children.map((row) => row.type),
        ['HeroCollection', 'HistoryCollection', 'OtherCollection']
    )
    assert.deepEqual((await f.fetch('https://foreign.invalid/f/v1/home')).children, history.children)
    assert.deepEqual(await f.fetch(`${origin}/unrelated`), original)
    const fetch = f.w.fetch
    const open = f.w.XMLHttpRequest.prototype.open
    vm.runInContext(source, f.context)
    assert.equal(f.w.fetch, fetch)
    assert.equal(f.w.XMLHttpRequest.prototype.open, open)
})

for (const [name, anilist] of [
    ['HTTP rate limiting', () => new Response('rate limited', { status: 429 })],
    ['malformed JSON', () => new Response('not JSON')],
    ['invalid result shape', () => Response.json({ data: {} })],
    ['GraphQL failure', () => Response.json({ errors: [{ message: 'error' }] })],
    [
        'network failure',
        () => {
            throw new TypeError('network')
        }
    ]
])
    test(`${name} falls back to original results without unhandled rejection`, async () => {
        const f = fixture({ anilist })
        f.settings(true)
        assert.deepEqual(await f.fetch(), original)
    })

test('hung optional requests time out, abort and preserve original results', async () => {
    const f = fixture({ anilist: () => new Promise(() => {}), fastTimeout: true })
    f.settings(true)
    assert.deepEqual(await f.fetch(), original)
    assert.equal(f.aniCalls()[0].init.signal.aborted, true)
})

test('concurrent requests share one ranking fetch and deduplicate catalog items', async () => {
    const f = fixture({ anilist: () => Response.json(idsResponse(['FIRST', 'FIRST', 'SECOND'])) })
    f.settings(true)
    const responses = await Promise.all([f.fetch(), f.fetch(`${browse}&start=1`)])
    assert.deepEqual(
        responses.map((response) => response.data[0].id),
        ['FIRST', 'SECOND']
    )
    assert.equal(f.aniCalls().length, 1)
    assert.equal(f.calls.filter((call) => call.url.includes('/cms/objects/')).length, 1)
})

test('locale, audio and ratings use independent catalog caches; ranking expires', async () => {
    const f = fixture()
    f.settings(true)
    await f.fetch()
    await f.fetch(`${browse}&locale=ja-JP&preferred_audio_language=ja-JP`)
    await f.fetch(`${browse}&ratings=false`)
    assert.equal(f.aniCalls().length, 1)
    assert.equal(f.calls.filter((call) => call.url.includes('/cms/objects/')).length, 3)
    f.advance(15 * 60 * 1000 + 1)
    await f.fetch()
    assert.equal(f.aniCalls().length, 2)
})

test('pagination is bounded and malformed external links cannot select foreign hosts', async () => {
    const f = fixture({
        anilist: () => Response.json({ data: { first: { media: [{ externalLinks: [{ url: 'https://evil.invalid/crunchyroll.com/series/EVIL' }] }] }, second: { media: [] } } })
    })
    f.settings(true)
    assert.deepEqual(await f.fetch(), original)
    assert.equal(f.aniCalls().length, 5)
    assert.equal(
        f.calls.some((call) => call.url.includes('/cms/objects/')),
        false
    )
})

test('native failed and non-JSON fetch responses remain usable', async () => {
    const f = fixture({ native: () => new Response('native error', { status: 500 }) })
    f.settings(true)
    assert.equal(await (await f.w.fetch(browse)).text(), 'native error')
    const json = fixture({ native: () => new Response('plain text') })
    assert.equal(await (await json.w.fetch(`${origin}/f/v1/home`)).text(), 'plain text')
})

test('XHR sends immediately; abort, repeat-send guards and reuse retain native semantics', async () => {
    const f = fixture({ anilist: () => new Promise(() => {}), fastTimeout: true })
    f.settings(true)
    const xhr = new f.w.XMLHttpRequest()
    xhr.open('GET', browse)
    xhr.setRequestHeader('authorization', 'SYNTHETIC')
    xhr.send()
    assert.equal(xhr.sends, 1)
    assert.throws(() => xhr.send(), { name: 'InvalidStateError' })
    assert.throws(() => xhr.setRequestHeader('extra', 'header'), { name: 'InvalidStateError' })
    xhr.abort()
    assert.equal(xhr.readyState, 0)
    xhr.open('GET', `${origin}/unrelated`)
    xhr.send()
    await tick()
    assert.deepEqual(JSON.parse(xhr.responseText), original)
    assert.equal(xhr.sends, 2)
})

test('XHR text/json response transforms reset on open and foreign requests stay untouched', async () => {
    const f = fixture()
    const xhr = new f.w.XMLHttpRequest()
    xhr.open('GET', `${origin}/f/v1/home`)
    xhr.send()
    await tick()
    assert.equal(JSON.parse(xhr.responseText).children[1].type, 'HistoryCollection')
    xhr.open('GET', 'https://foreign.invalid/f/v1/home')
    xhr.responseType = 'json'
    xhr.send()
    await tick()
    assert.deepEqual(xhr.response.children, history.children)
})
