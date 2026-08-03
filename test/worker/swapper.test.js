import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile, atomicWriteBuffer } from '../../src/worker/swapper.js'
import { createFixture } from '../helpers/fixture.js'

describe('atomicWriteFile', () => {
    test('writes the target file with the given content', async () => {
        const fixture = await createFixture({})
        const target = path.join(fixture.dir, 'out', 'index.html')

        await atomicWriteFile(target, '<h1>Hi</h1>')

        assert.equal(await fs.readFile(target, 'utf-8'), '<h1>Hi</h1>')
        await fixture.cleanup()
    })

    test('leaves no .tmp staging file behind after a successful write', async () => {
        const fixture = await createFixture({})
        const target = path.join(fixture.dir, 'index.html')

        await atomicWriteFile(target, 'content')

        const entries = await fs.readdir(fixture.dir)
        assert.deepEqual(entries, ['index.html'])
        await fixture.cleanup()
    })

    test('cleans up the staging file and rethrows when the write fails', async () => {
        const fixture = await createFixture({})
        // Point the "file" at a path that is actually a directory, forcing EISDIR.
        const targetDir = path.join(fixture.dir, 'is-a-dir')
        await fs.mkdir(targetDir)

        await assert.rejects(() => atomicWriteFile(targetDir, 'content'))

        const entries = await fs.readdir(fixture.dir)
        // Only the pre-existing directory should remain - no leftover .tmp.* file.
        assert.deepEqual(entries, ['is-a-dir'])
        await fixture.cleanup()
    })
})

describe('atomicWriteBuffer', () => {
    test('writes binary content correctly', async () => {
        const fixture = await createFixture({})
        const target = path.join(fixture.dir, 'logo.png')
        const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])

        await atomicWriteBuffer(target, buf)

        assert.deepEqual(await fs.readFile(target), buf)
        await fixture.cleanup()
    })

    test('creates parent directories as needed', async () => {
        const fixture = await createFixture({})
        const target = path.join(fixture.dir, 'a', 'b', 'c', 'asset.bin')

        await atomicWriteBuffer(target, Buffer.from('x'))

        assert.equal((await fs.readFile(target)).toString(), 'x')
        await fixture.cleanup()
    })
})
