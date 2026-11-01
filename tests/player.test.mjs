import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../src/utils/katamari.js', import.meta.url), 'utf8')
function fixture({ chunks = [], enabled = true, delayedSettings = false } = {}) {
    const messages = []
    const document = new EventTarget()
    const window = { webpackChunk_N_E: chunks }
    document.addEventListener('croptix:settings-request', () => {
        if (!delayedSettings) document.dispatchEvent(new CustomEvent('croptix:settings', { detail: { playerEnabled: enabled } }))
    })
    const context = vm.createContext({ window, document, Event, console: { warn: (...args) => messages.push(args[0]), error: (...args) => messages.push(args[0]) } })
    vm.runInContext(source, context)
    return { window, document, context, messages }
}

function supportedFactory(t, i, a) {
    const core = a(1),
        dep2 = a(2),
        dep3 = a(3),
        dep4 = a(4),
        dep5 = a(5)
    const name = '@crunchyroll/katamari-desktop-player'
    async function engines() {
        await a
            .e(10)
            .then(a.bind(a, 11))
            .then(({ ShakaMediaEngine }) => ShakaMediaEngine)
        await a
            .e(20)
            .then(a.bind(a, 21))
            .then(({ BitmovinMediaEngine }) => BitmovinMediaEngine)
    }
    a.d(i, { Player: () => core.OriginalBuilder })
}

function requireFixture() {
    let originalConstructed = 0
    class OriginalBuilder {
        constructor(...args) {
            this.args = args
            originalConstructed++
        }
        setLogLevel(level) {
            this.level = level
        }
        async build(...args) {
            return { native: true, args, constructorArgs: this.args, level: this.level }
        }
    }
    const require = (id) => (id === 1 ? { OriginalBuilder } : {})
    require.d = (exports, definitions) => {
        for (const [name, getter] of Object.entries(definitions)) Object.defineProperty(exports, name, { get: getter, enumerable: true })
    }
    return { require, count: () => originalConstructed }
}

test('webpack hook preserves original queue handler and stable push identity', () => {
    const chunks = []
    let registered = 0
    chunks.push = function (...args) {
        registered += args.length
        return Array.prototype.push.apply(this, args)
    }
    const f = fixture({ chunks })
    const push = f.window.webpackChunk_N_E.push
    assert.equal(push, f.window.webpackChunk_N_E.push)
    const untouched = () => 'unrelated'
    const chunk = [[1], { unrelated: untouched }]
    assert.equal(chunks.push(chunk), 1)
    assert.equal(registered, 1)
    assert.equal(chunk[1].unrelated, untouched)
    vm.runInContext(source, f.context)
    assert.equal(chunks.push, push)
})

test('hook honors webpack replacement push without losing new modules', () => {
    const f = fixture()
    const chunks = f.window.webpackChunk_N_E
    let registrations = 0
    chunks.push = function (...args) {
        registrations += args.length
        return Array.prototype.push.apply(this, args)
    }
    chunks.push([[1], {}])
    chunks.push([[2], {}])
    assert.equal(registrations, 2)
    assert.equal(chunks.length, 2)
})

test('disabled player setting leaves matching modules untouched', () => {
    const chunk = [[1], { player: supportedFactory }]
    const f = fixture({ enabled: false })
    f.window.webpackChunk_N_E.push(chunk)
    assert.equal(chunk[1].player, supportedFactory)
    f.document.dispatchEvent(new CustomEvent('croptix:settings', { detail: { playerEnabled: true } }))
    f.window.webpackChunk_N_E.push(chunk)
    assert.equal(chunk[1].player, supportedFactory, 'player preference changes require reload')
})

test('early chunks stay native until the first preference arrives, then queued modules are rescanned', () => {
    const chunk = [[1], { player: supportedFactory }]
    const f = fixture({ chunks: [chunk], delayedSettings: true })
    assert.equal(chunk[1].player, supportedFactory)
    const next = [[2], { player: supportedFactory }]
    f.window.webpackChunk_N_E.push(next)
    assert.equal(next[1].player, supportedFactory)
    f.document.dispatchEvent(new CustomEvent('croptix:settings', { detail: { playerEnabled: true } }))
    assert.notEqual(chunk[1].player, supportedFactory)
    assert.notEqual(next[1].player, supportedFactory)
})

test('unsupported module shapes, malformed chunks and non-player modules remain usable', () => {
    function unsupported() {
        return '@crunchyroll/katamari-desktop-player'
    }
    const f = fixture()
    const chunk = [[1], { player: unsupported, constant: 42 }]
    assert.doesNotThrow(() => f.window.webpackChunk_N_E.push(null, [], chunk))
    assert.equal(chunk[1].player, unsupported)
    assert.equal(chunk[1].constant, 42)
    assert.ok(f.messages.some((message) => message.includes('static import ids not found')))
})

test('matched module initialization failure falls back to the original builder', async () => {
    const chunk = [[1], { player: supportedFactory }]
    const f = fixture({ chunks: [chunk] })
    assert.notEqual(chunk[1].player, supportedFactory)
    const deps = requireFixture()
    const module = { exports: {} }
    chunk[1].player(module, module.exports, deps.require)
    const builder = new module.exports.Player('SYNTHETIC')
    builder.setLogLevel('none')
    assert.deepEqual(await builder.build('TEST_MEDIA'), { native: true, args: ['TEST_MEDIA'], constructorArgs: ['SYNTHETIC'], level: 'none' })
    assert.equal(deps.count(), 1)
    assert.ok(f.messages.some((message) => message.includes('failed to initialize')))
    // A failed patch remains disabled for later matching chunks on this page.
    const second = [[2], { player: supportedFactory }]
    f.window.webpackChunk_N_E.push(second)
    assert.equal(second[1].player, supportedFactory)
})

test('active plugin registry excludes bundled Mux and EEC analytics creators', () => {
    const registry = source.match(/let g = \[([^\]]+)\]/)?.[1]
    assert.ok(registry)
    assert.match(registry, /new nW\(o, d\)/)
    assert.match(registry, /new nQ\(d\)/)
    assert.doesNotMatch(registry, /nZ|nq|Heartbeat|Viewership/)
    assert.doesNotMatch(source, /new nZ\(/)
})

// Exercise the exact production wrapper separately from the large third-party player bundle.
const helperStart = source.indexOf('    function createPlayerBuilder(')
const helperEnd = source.indexOf('    function patch_webpack_chunk(', helperStart)
const createPlayerBuilder = vm.runInNewContext(`(${source.slice(helperStart, helperEnd).trim()})`)

function fallbackFixture() {
    const failures = []
    let disabled = false
    const original = {
        setLogLevel(level) {
            this.level = level
        },
        async build(...args) {
            return { native: true, args, level: this.level }
        }
    }
    return {
        original,
        failures,
        fallback: (error, args) => {
            failures.push({ error, args })
            disabled = true
            return original
        },
        isDisabled: () => disabled
    }
}

test('constructor failure immediately returns the native builder with original arguments', () => {
    const f = fallbackFixture()
    class ThrowingBuilder {
        constructor() {
            throw new Error('constructor failure')
        }
    }
    const Safe = createPlayerBuilder(ThrowingBuilder, f.fallback, f.isDisabled)
    assert.equal(new Safe('SYNTHETIC'), f.original)
    assert.equal(f.failures[0].error.message, 'constructor failure')
    assert.deepEqual(Array.from(f.failures[0].args), ['SYNTHETIC'])
})

test('failed build destroys engine and layers before returning native playback', async () => {
    const f = fallbackFixture()
    const cleanup = []
    class ThrowingBuilder {
        setLogLevel(level) {
            this.level = level
        }
        async build() {
            this._croptixBuildContext.mediaEngine = {
                async destroy() {
                    cleanup.push('engine')
                }
            }
            this._croptixBuildContext.layers.push({
                remove() {
                    cleanup.push('layer')
                }
            })
            throw new Error('build failure')
        }
    }
    const Safe = createPlayerBuilder(ThrowingBuilder, f.fallback, f.isDisabled)
    const builder = new Safe('SYNTHETIC')
    builder.setLogLevel('none')
    assert.deepEqual(await builder.build('MEDIA'), { native: true, args: ['MEDIA'], level: 'none' })
    assert.deepEqual(cleanup, ['engine', 'layer'])
    assert.equal(builder._croptixBuildContext, null)
    assert.equal(f.failures.length, 1)
    assert.deepEqual(await builder.build('NEXT'), { native: true, args: ['NEXT'], level: 'none' })
    assert.equal(f.failures.length, 1)
})

test('engine disposal errors cannot prevent layer cleanup and native fallback', async () => {
    const f = fallbackFixture()
    let removed = false
    class ThrowingBuilder {
        async build() {
            this._croptixBuildContext.mediaEngine = {
                async dispose() {
                    throw new Error('cleanup failure')
                }
            }
            this._croptixBuildContext.layers.push({
                remove() {
                    removed = true
                }
            })
            throw new Error('build failure')
        }
    }
    const Safe = createPlayerBuilder(ThrowingBuilder, f.fallback, f.isDisabled)
    assert.equal((await new Safe().build()).native, true)
    assert.equal(removed, true)
})

test('successful builds return enhanced playback and clear temporary build state', async () => {
    const f = fallbackFixture()
    class WorkingBuilder {
        async build() {
            return 'enhanced playback'
        }
    }
    const Safe = createPlayerBuilder(WorkingBuilder, f.fallback, f.isDisabled)
    const builder = new Safe()
    assert.equal(await builder.build(), 'enhanced playback')
    assert.equal(builder._croptixBuildContext, null)
    assert.equal(f.failures.length, 0)
})
