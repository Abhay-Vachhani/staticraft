import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { hashContent, generateHashedAsset, rewriteAssetUrls, rewriteBasePaths } from '../../src/engine/hashing.js'
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

    test('prefixes asset URLs with basePath when specified', () => {
        const html = '<link href="/styles.css">'
        const out = rewriteAssetUrls(html, { 'styles.css': 'styles.abc12345.css' }, '/staticraft')
        assert.equal(out, '<link href="/staticraft/styles.abc12345.css">')
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

    test('prioritizes path-qualified keys over bare basename keys', () => {
        const html = '<img src="images/logo.png">'
        const assetMap = {
            'logo.png': 'logo.11111111.png',
            'images/logo.png': 'images/logo.22222222.png',
        }
        const out = rewriteAssetUrls(html, assetMap)
        assert.equal(out, '<img src="images/logo.22222222.png">')
    })

    test('rewrites absolute asset URLs containing basePath without duplicating basePath', () => {
        const html = '<meta property="og:image" content="https://abhay-vachhani.github.io/staticraft/og-image.png">'
        const assetMap = { 'og-image.png': 'og-image.b8849bf0.png' }
        const out = rewriteAssetUrls(html, assetMap, '/staticraft')
        assert.equal(out, '<meta property="og:image" content="https://abhay-vachhani.github.io/staticraft/og-image.b8849bf0.png">')
    })
})

describe('rewriteBasePaths', () => {
    test('prefixes root-relative href and src attributes with basePath', () => {
        const html = '<a href="/docs">Docs</a><a href="/">Home</a><img src="/img/logo.png">'
        const out = rewriteBasePaths(html, '/staticraft')
        assert.equal(out, '<a href="/staticraft/docs">Docs</a><a href="/staticraft/">Home</a><img src="/staticraft/img/logo.png">')
    })

    test('does not double-prefix URLs that already start with basePath', () => {
        const html = '<a href="/staticraft/docs">Docs</a>'
        const out = rewriteBasePaths(html, '/staticraft')
        assert.equal(out, '<a href="/staticraft/docs">Docs</a>')
    })

    test('prefixes root-relative content attributes (e.g. meta tags) with basePath', () => {
        const html = '<meta property="og:image" content="/og-image.png">'
        const out = rewriteBasePaths(html, '/staticraft')
        assert.equal(out, '<meta property="og:image" content="/staticraft/og-image.png">')
    })

    test('leaves absolute, relative, or hash URLs untouched', () => {
        const html = '<a href="https://github.com">GH</a><a href="#section">Sec</a>'
        const out = rewriteBasePaths(html, '/staticraft')
        assert.equal(out, '<a href="https://github.com">GH</a><a href="#section">Sec</a>')
    })
})

