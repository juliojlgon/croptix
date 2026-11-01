import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { packageExtension } from '../scripts/package.mjs'

test('unsigned ZIP is deterministic across filesystem timestamps and creation order', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'croptix-package-'))
    try {
        for (const source of ['first', 'second']) {
            await mkdir(path.join(root, source))
            const files = { 'manifest.json': '{"version":"1.2.3"}', 'z.js': 'last', 'a.js': 'first' }
            for (const name of source === 'first' ? Object.keys(files) : Object.keys(files).reverse()) {
                await writeFile(path.join(root, source, name), files[name])
                await utimes(path.join(root, source, name), 0, source === 'first' ? 0 : 123456789)
            }
        }
        const first = await packageExtension(path.join(root, 'first'), path.join(root, 'out-a'))
        const second = await packageExtension(path.join(root, 'second'), path.join(root, 'out-b'))
        assert.deepEqual(await readFile(first), await readFile(second))
        const archive = await readFile(first)
        assert.equal(archive.readUInt32LE(), 0x04034b50)
        assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50)
        assert.equal(archive.readUInt16LE(archive.length - 12), 3)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('packager refuses private signing keys', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'croptix-key-'))
    try {
        await writeFile(path.join(root, 'manifest.json'), '{"version":"1.2.3"}')
        await writeFile(path.join(root, 'key.pem'), 'not-a-real-key')
        await assert.rejects(packageExtension(root, path.join(root, 'out')), /Refusing to package private key/)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
