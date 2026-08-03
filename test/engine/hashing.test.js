import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { hashContent, generateHashedAsset, rewriteAssetUrls } from '../../src/engine/hashing.js'
import { createFixture } from '../helpers/fixture.js'

describe('hashContent', () => {
    test('is deterministic for identical content', () => {
        const a = hashContent(Buffer.from('body { color: red }'))
        const b = hashContent(Buffer.from('body { color: red }'))
        assert.equal(a, b)
    })

    test('differs for different content', () => {
        const a = hashContent(Buffer.from('a'))
        const b = hashContent(Buffer.from('b'))
        assert.notEqual(a, b)
    })

    test('is an 8-character hex string', () => {
        assert.match(hashContent(Buffer.from('x')), /^[0-9a-f]{8}$/)
    })
})

describe('generateHashedAsset', () => {
    test('produces a name.hash.ext filename next to the original', async () => {
        const fixture = await createFixture({ 'styles.css': 'body{}' })
        const filePath = path.join(fixture.dir, 'styles.css')
        const asset = await generateHashedAsset(filePath)

        assert.equal(asset.originalName, 'styles.css')
        assert.match(asset.hashedFileName, /^styles\.[0-9a-f]{8}\.css$/)
        assert.equal(asset.hash.length, 8)
        assert.ok(Buffer.isBuffer(asset.content))
        assert.equal(asset.content.toString('utf-8'), 'body{}')

        await fixture.cleanup()
    })
})

describe('rewriteAssetUrls', () => {
    test('rewrites bare filename references bounded by quotes/slashes', () => {
        const html = '<link href="/styles.css"><script src="app.js"></script>'
        const out = rewriteAssetUrls(html, {
            'styles.css': 'styles.abc12345.css',
            'app.js': 'app.def67890.js',
        })
        assert.equal(out, '<link href="/styles.abc12345.css"><script src="app.def67890.js"></script>')
    })

    test('does not touch unrelated substrings', () => {
        const html = '<p>not-styles.css-related</p><link href="/styles.css">'
        const out = rewriteAssetUrls(html, { 'styles.css': 'styles.hash.css' })
        assert.ok(out.includes('not-styles.css-related'))
        assert.ok(out.includes('/styles.hash.css'))
    })

    test('safely escapes filenames containing regex-special characters', () => {
        const html = '<img src="logo(1).png">'
        const out = rewriteAssetUrls(html, { 'logo(1).png': 'logo(1).hash.png' })
        assert.equal(out, '<img src="logo(1).hash.png">')
    })
})
