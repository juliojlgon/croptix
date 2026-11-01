;(() => {
    const marker = Symbol.for('croptix.crunchyroll-page-patches')
    if (window[marker]) return
    window[marker] = true

    const nativeFetch = window.fetch
    const supportedOrigin = 'https://www.crunchyroll.com'
    let aniListEnabled = false
    let generation = 0
    const createTrending = () => ({
        ids: [],
        seen: new Set(),
        catalogs: new Map(),
        page: 1,
        done: false,
        expires: 0,
        retryAt: 0,
        loading: null,
        controller: new AbortController(),
        generation: ++generation
    })
    let trending = createTrending()
    const resetTrending = () => {
        trending.controller.abort()
        trending = createTrending()
    }
    const isCurrent = (state) => aniListEnabled && state === trending && !state.controller.signal.aborted
    const assertCurrent = (state) => {
        if (!isCurrent(state)) throw new DOMException('Trending is disabled or expired.', 'AbortError')
    }
    document.addEventListener('croptix:settings', (event) => {
        const enabled = event.detail?.aniListEnabled === true
        if (enabled === aniListEnabled) return
        aniListEnabled = enabled
        resetTrending()
    })
    document.dispatchEvent(new Event('croptix:settings-request'))

    let requestNumber = 0
    const requestRanking = (state, firstPage, secondPage) =>
        new Promise((resolve, reject) => {
            assertCurrent(state)
            const id = `croptix-${state.generation}-${++requestNumber}`
            const cleanup = () => {
                document.removeEventListener('croptix:anilist-response', onResponse)
                state.controller.signal.removeEventListener('abort', onAbort)
            }
            const onAbort = () => {
                cleanup()
                document.dispatchEvent(new CustomEvent('croptix:anilist-cancel', { detail: { id } }))
                reject(new DOMException('Trending request cancelled.', 'AbortError'))
            }
            const onResponse = (event) => {
                if (event.detail?.id !== id) return
                cleanup()
                if (event.detail.ok === true) resolve(event.detail.data)
                else reject(new Error('Trending is unavailable or not enabled.'))
            }
            document.addEventListener('croptix:anilist-response', onResponse)
            state.controller.signal.addEventListener('abort', onAbort, { once: true })
            // Only the isolated content script can authorize networking from actual local storage.
            document.dispatchEvent(new CustomEvent('croptix:anilist-request', { detail: { id, firstPage, secondPage } }))
        })
    const loadTrending = (state) => {
        assertCurrent(state)
        if (state.loading) return state.loading
        if (state.done) return Promise.resolve()
        if (Date.now() < state.retryAt) return Promise.reject(new Error('Trending retry is delayed.'))
        const pages = [state.page, Math.min(state.page + 1, 10)]
        state.loading = Promise.resolve()
            .then(() => {
                assertCurrent(state)
                return requestRanking(state, pages[0], pages[1])
            })
            .then((data) => {
                assertCurrent(state)
                if (!Array.isArray(data?.first?.media) || !Array.isArray(data?.second?.media)) {
                    throw new Error('Trending service returned invalid data.')
                }
                for (const anime of [...data.first.media, ...data.second.media]) {
                    for (const link of anime.externalLinks ?? []) {
                        let url
                        try {
                            url = new URL(link.url)
                        } catch {
                            continue
                        }
                        if (url.protocol !== 'https:' || !['www.crunchyroll.com', 'crunchyroll.com'].includes(url.hostname)) continue
                        const id = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?series\/([a-z0-9]+)(?:\/|$)/i)?.[1]?.toUpperCase()
                        if (!id || state.seen.has(id)) continue
                        state.seen.add(id)
                        state.ids.push(id)
                    }
                }
                state.page = pages[1] + 1
                state.done = state.page > 10
                state.expires = Date.now() + 15 * 60 * 1000
                state.retryAt = 0
            })
            .catch((error) => {
                if (isCurrent(state)) state.retryAt = Date.now() + 60 * 1000
                throw error
            })
            .finally(() => {
                state.loading = null
            })
        return state.loading
    }
    const getRange = (url) => {
        const start = Number.parseInt(url.searchParams.get('start') ?? '0', 10)
        const size = Number.parseInt(url.searchParams.get('n') ?? '36', 10)
        return [start > 0 ? start : 0, size > 0 ? size : 36]
    }
    const getCatalog = (state, url, create = true) => {
        const locale = url.searchParams.get('locale') || 'en-US'
        const audio = url.searchParams.get('preferred_audio_language') || locale
        const ratings = url.searchParams.get('ratings') || 'true'
        const key = `${locale}|${audio}|${ratings}`
        if (!state.catalogs.has(key) && create) {
            state.catalogs.set(key, { locale, audio, ratings, items: [], seen: new Set(), cursor: 0, wanted: 0, done: false, loading: null })
        }
        return state.catalogs.get(key)
    }
    const fillCatalog = async (state, url, requestHeaders) => {
        assertCurrent(state)
        if (!state.ids.length) await loadTrending(state)
        const catalog = getCatalog(state, url)
        const [start, size] = getRange(url)
        catalog.wanted = Math.max(catalog.wanted, start + size)
        if (!catalog.loading) {
            catalog.loading = (async () => {
                while (catalog.items.length < catalog.wanted && !catalog.done) {
                    assertCurrent(state)
                    if (catalog.cursor >= state.ids.length) {
                        if (state.done) {
                            catalog.done = true
                            break
                        }
                        await loadTrending(state)
                        continue
                    }
                    const ids = state.ids.slice(catalog.cursor, catalog.cursor + 50)
                    const api = new URL(`/content/v2/cms/objects/${ids.join(',')}`, supportedOrigin)
                    api.searchParams.set('ratings', catalog.ratings)
                    api.searchParams.set('preferred_audio_language', catalog.audio)
                    api.searchParams.set('locale', catalog.locale)
                    const headers = new Headers(requestHeaders)
                    headers.set('accept', 'application/json')
                    headers.delete('content-length')
                    headers.delete('host')
                    const response = await nativeFetch.call(window, api.href, { credentials: 'same-origin', headers, signal: state.controller.signal })
                    if (!response.ok) throw new Error('Crunchyroll catalog is unavailable.')
                    const data = (await response.json())?.data
                    assertCurrent(state)
                    if (!Array.isArray(data)) throw new Error('Crunchyroll catalog returned invalid data.')
                    const byId = new Map(data.map((item) => [String(item?.id ?? '').toUpperCase(), item]))
                    catalog.cursor += ids.length
                    for (const id of ids) {
                        const item = byId.get(id)
                        if (!item || catalog.seen.has(id)) continue
                        catalog.seen.add(id)
                        catalog.items.push(item)
                    }
                    catalog.done = state.done && catalog.cursor >= state.ids.length
                }
            })().finally(() => {
                catalog.loading = null
            })
        }
        await catalog.loading
        assertCurrent(state)
        if (catalog.items.length < catalog.wanted && !catalog.done) await fillCatalog(state, url, requestHeaders)
    }
    const replaceTrending = (body, patch) => {
        if (!isCurrent(patch.state) || !Array.isArray(body?.data)) return body
        const catalog = getCatalog(patch.state, patch.url, false)
        if (!catalog || !catalog.items.length) return body
        const [start, size] = getRange(patch.url)
        return { ...body, data: catalog.items.slice(start, start + size), total: catalog.done ? catalog.items.length : 500 }
    }
    const moveHistoryToTop = (body) => {
        if (!Array.isArray(body?.children)) return body
        const rows = [...body.children]
        const from = rows.findIndex((row) => row?.type === 'HistoryCollection')
        if (from < 0) return body
        const history = rows.splice(from, 1)[0]
        const afterHero = rows.findIndex((row) => !['HeroMediaCard', 'HeroCollection'].includes(row?.type))
        rows.splice(afterHero < 0 ? rows.length : afterHero, 0, history)
        return { ...body, children: rows }
    }
    const findPatches = (input, headers = new Headers(), method = 'GET') => {
        if (String(method).toUpperCase() !== 'GET') return []
        const url = new URL(String(input), window.location.href)
        if (url.origin !== supportedOrigin || new URL(window.location.href).origin !== supportedOrigin) return []
        if (url.pathname === '/f/v1/home') return [{ url, transform: moveHistoryToTop }]
        if (!aniListEnabled || url.pathname !== '/content/v2/discover/browse' || url.searchParams.get('sort_by') !== 'popularity') return []
        if (trending.expires && trending.expires <= Date.now()) resetTrending()
        return [{ url, headers, state: trending, transform: replaceTrending }]
    }
    const patchJson = (body, patches) => patches.reduce((json, patch) => (patch.failed ? json : patch.transform(json, patch)), body)
    // Preparation never rejects: native errors and responses remain independent of optional rankings.
    const preparePatches = async (patches) => {
        const prepared = patches.filter((patch) => patch.state)
        if (!prepared.length) return
        let timer
        try {
            await Promise.race([
                Promise.all(prepared.map((patch) => fillCatalog(patch.state, patch.url, patch.headers))),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Trending timed out.')), 5000)
                })
            ])
        } catch {
            for (const patch of prepared) patch.failed = true
            if (prepared.some((patch) => isCurrent(patch.state))) {
                resetTrending()
                trending.retryAt = Date.now() + 60 * 1000
            }
        } finally {
            clearTimeout(timer)
        }
    }
    const rewriteResponse = async (response, patches, ready) => {
        if (!response.ok) return response
        await ready
        if (patches.every((patch) => patch.failed || (patch.state && !isCurrent(patch.state)))) return response
        const body = await response.clone().json()
        const headers = new Headers(response.headers)
        headers.delete('content-encoding')
        headers.delete('content-length')
        const patched = new Response(JSON.stringify(patchJson(body, patches)), { status: response.status, statusText: response.statusText, headers })
        for (const property of ['url', 'redirected', 'type']) {
            try {
                Object.defineProperty(patched, property, { value: response[property] })
            } catch {}
        }
        return patched
    }
    if (typeof nativeFetch === 'function') {
        window.fetch = function (...args) {
            let patches
            try {
                const request = args[0]
                const isRequest = typeof Request !== 'undefined' && request instanceof Request
                const headers = new Headers(args[1]?.headers ?? (isRequest ? request.headers : undefined))
                patches = findPatches(isRequest ? request.url : request, headers, args[1]?.method ?? (isRequest ? request.method : 'GET'))
            } catch {
                return nativeFetch.apply(this, args)
            }
            const response = nativeFetch.apply(this, args)
            if (!patches.length) return response
            const ready = preparePatches(patches)
            return response.then(async (result) => {
                try {
                    return await rewriteResponse(result, patches, ready)
                } catch {
                    return result
                }
            })
        }
    }

    const XHR = window.XMLHttpRequest
    if (typeof XHR === 'function') {
        const prototype = XHR.prototype
        const nativeOpen = prototype.open
        const textDescriptor = Object.getOwnPropertyDescriptor(prototype, 'responseText')
        const responseDescriptor = Object.getOwnPropertyDescriptor(prototype, 'response')
        const requests = new WeakMap()
        if (typeof nativeOpen === 'function') {
            prototype.open = function (method, input, ...args) {
                const previous = requests.get(this)
                if (previous) {
                    for (const [name, descriptor] of previous.descriptors) {
                        if (descriptor) Object.defineProperty(this, name, descriptor)
                        else delete this[name]
                    }
                    requests.delete(this)
                }
                const result = nativeOpen.call(this, method, input, ...args)
                try {
                    const headers = new Headers()
                    const patches = findPatches(input, headers, method)
                    if (!patches.length) return result
                    const state = { descriptors: new Map(), ready: false }
                    requests.set(this, state)
                    const override = (name, descriptor) => {
                        state.descriptors.set(name, Object.getOwnPropertyDescriptor(this, name))
                        Object.defineProperty(this, name, { configurable: true, ...descriptor })
                    }
                    // Do not delay native XHR dispatch, abort, timeout or lifecycle events.
                    // An uncached ranking may apply on a later request; native results always remain usable.
                    const nativeSend = this.send
                    const nativeSetHeader = this.setRequestHeader
                    if (patches.some((patch) => patch.state) && args[0] !== false && typeof nativeSend === 'function') {
                        if (typeof nativeSetHeader === 'function')
                            override('setRequestHeader', {
                                value: (name, value) => {
                                    const valueResult = nativeSetHeader.call(this, name, value)
                                    headers.append(String(name), String(value))
                                    return valueResult
                                }
                            })
                        override('send', {
                            value: (...sendArgs) => {
                                const sendResult = nativeSend.apply(this, sendArgs)
                                void preparePatches(patches).then(() => {
                                    state.ready = true
                                })
                                return sendResult
                            }
                        })
                    } else state.ready = !patches.some((patch) => patch.state)
                    const cache = {}
                    const transform = (body) => (state.ready ? patchJson(body, patches) : body)
                    const readText = () => {
                        const text = textDescriptor.get.call(this)
                        if (this.readyState !== 4) return text
                        if ('text' in cache) return cache.text
                        try {
                            cache.text = JSON.stringify(transform(JSON.parse(text)))
                        } catch {
                            cache.text = text
                        }
                        return cache.text
                    }
                    if (typeof textDescriptor?.get === 'function') override('responseText', { enumerable: textDescriptor.enumerable, get: readText })
                    if (typeof responseDescriptor?.get === 'function')
                        override('response', {
                            enumerable: responseDescriptor.enumerable,
                            get: () => {
                                const response = responseDescriptor.get.call(this)
                                if (this.readyState !== 4) return response
                                if (this.responseType === 'json') {
                                    if (!('json' in cache)) cache.json = transform(response)
                                    return cache.json
                                }
                                return this.responseType === '' || this.responseType === 'text' ? readText() : response
                            }
                        })
                } catch {
                    /* Unsupported native descriptors leave the original request usable. */
                }
                return result
            }
        }
    }
})()
