import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const crcTable = Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    return value >>> 0
})
function crc32(bytes) {
    let crc = 0xffffffff
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}
async function entries(directory, prefix = '') {
    const files = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name
        if (entry.isDirectory()) files.push(...(await entries(path.join(directory, entry.name), relative + '/')))
        else if (entry.isFile()) files.push(relative)
        else throw new Error(`Unsupported packaged entry: ${relative}`)
    }
    return files.sort()
}

// Stored ZIP entries avoid platform/zlib differences. Fixed DOS timestamps, UTF-8 paths,
// sorted entries and no filesystem metadata make the complete archive reproducible.
export async function packageExtension(source = 'dist', output = 'build', target = 'chrome') {
    const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'))
    const local = []
    const central = []
    let offset = 0
    const files = await entries(source)
    for (const file of files) {
        if (/\.(?:pem|key)$/i.test(file)) throw new Error(`Refusing to package private key: ${file}`)
        const name = Buffer.from(file)
        const data = await readFile(path.join(source, file))
        const crc = crc32(data)
        const header = Buffer.alloc(30)
        header.writeUInt32LE(0x04034b50)
        header.writeUInt16LE(20, 4)
        header.writeUInt16LE(0x800, 6)
        header.writeUInt16LE(33, 12)
        header.writeUInt32LE(crc, 14)
        header.writeUInt32LE(data.length, 18)
        header.writeUInt32LE(data.length, 22)
        header.writeUInt16LE(name.length, 26)
        local.push(header, name, data)
        const record = Buffer.alloc(46)
        record.writeUInt32LE(0x02014b50)
        record.writeUInt16LE(20, 4)
        record.writeUInt16LE(20, 6)
        record.writeUInt16LE(0x800, 8)
        record.writeUInt16LE(33, 14)
        record.writeUInt32LE(crc, 16)
        record.writeUInt32LE(data.length, 20)
        record.writeUInt32LE(data.length, 24)
        record.writeUInt16LE(name.length, 28)
        record.writeUInt32LE(offset, 42)
        central.push(record, name)
        offset += header.length + name.length + data.length
    }
    const directory = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50)
    end.writeUInt16LE(files.length, 8)
    end.writeUInt16LE(files.length, 10)
    end.writeUInt32LE(directory.length, 12)
    end.writeUInt32LE(offset, 16)
    await mkdir(output, { recursive: true })
    const extension = target === 'firefox-v2' ? 'xpi' : 'zip'
    const artifact = path.join(output, `crunchyroll_enhancer_croptix-${manifest.version}-${target}.${extension}`)
    await writeFile(artifact, Buffer.concat([...local, directory, end]))
    return artifact
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(await packageExtension(process.argv[2], process.argv[3], process.argv[4]))
}
