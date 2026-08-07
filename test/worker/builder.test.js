import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SiteBuilder, formatDuration } from '../../src/worker/builder.js'
import { createFixture } from '../helpers/fixture.js'

const PRODUCTS_SERVER = `
import fs from 'node:fs'
const log = (name) => fs.appendFileSync(new URL('./' + name + '.log', import.meta.url), '1\\n')

export default {
    revalidate: 3600,
    data: async ({ params }) => {
        log('data-calls')
        if (params.id === '1') return { product: { name: 'One' } }
        if (params.id === '2') return { product: { name: 'Two' } }
        return null
    },
    generatePaths: async () => {
        log('generatePaths-calls')
        return [
            { params: { id: '1' }, data: { product: { name: 'One' } } },
            { params: { id: '2' }, data: { product: { name: 'Two' } } },
        ]
    },
}
`

function baseTree() {
    return {
        'staticraft.config.js': `export default { outputDir: '.raft', siteUrl: 'https://example.com' }\n`,
        'src/app/page.html': '{{ title }}',
        'src/app/server.js': `export default { revalidate: 600, data: async () => ({ title: 'Home' }) }\n`,
        'src/app/products/page.html': '{{#each products}}[{{ name }}]{{/each}}',
        'src/app/products/server.js': `export default { revalidate: 300, data: async () => ({ products: [{ name: 'Widget' }] }) }\n`,
        'src/app/products/[id]/page.html': '{{ product.name }}',
        'src/app/products/[id]/server.js': PRODUCTS_SERVER,
        'src/app/about.html': 'About page',
        'src/app/404.html': 'Not Found',
    }
}

async function logCount(fixtureDir, name) {
    try {
        const content = await fs.readFile(
            path.join(fixtureDir, 'src/app/products/[id]', `${name}.log`),
            'utf-8',
        )
        return content.trim().split('\n').filter(Boolean).length
    } catch (_) {
        return 0
    }
}

describe('SiteBuilder.discoverRoutes', () => {
    test('derives route patterns from folder structure', async () => {
        const fixture = await createFixture(baseTree())
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        assert.ok(builder.routes['/'])
        assert.ok(builder.routes['/products'])
        assert.ok(builder.routes['/products/:id'])
        assert.equal(builder.routes['/'].mod.revalidate, 600)
        assert.equal(builder.routes['/products/:id'].mod.revalidate, 3600)

        await fixture.cleanup()
    })

    test('a folder route with no server.js is still discovered (data-less static page)', async () => {
        const fixture = await createFixture({
            'src/app/contact/page.html': 'Contact us',
        })
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        assert.ok(builder.routes['/contact'])
        assert.deepEqual(builder.routes['/contact'].mod, {})

        await fixture.cleanup()
    })
})

describe('SiteBuilder.buildRoute', () => {
    test('renders the root route and reports a human-readable revalidate', async () => {
        const fixture = await createFixture(baseTree())
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        const result = await builder.buildRoute('/', builder.routes['/'])
        assert.equal(result.count, 1)
        assert.equal(result.revalidate, formatDuration(600))
        assert.deepEqual(result.urls, ['/'])

        const html = await fs.readFile(path.join(builder.outputDir, 'index.html'), 'utf-8')
        assert.equal(html, 'Home')

        await fixture.cleanup()
    })

    test('a route with no revalidate reports "Manual"', async () => {
        const fixture = await createFixture({
            'src/app/contact/page.html': 'Contact',
        })
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        const result = await builder.buildRoute('/contact', builder.routes['/contact'])
        assert.equal(result.revalidate, 'Manual')

        await fixture.cleanup()
    })

    test('dynamic route enumerates every generatePaths() item', async () => {
        const fixture = await createFixture(baseTree())
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        const result = await builder.buildRoute('/products/:id', builder.routes['/products/:id'])
        assert.equal(result.count, 2)
        assert.deepEqual(result.urls.sort(), ['/products/1', '/products/2'])

        const one = await fs.readFile(path.join(builder.outputDir, 'products/1/index.html'), 'utf-8')
        assert.equal(one, 'One')

        await fixture.cleanup()
    })

    test('throws security error if generatePaths produces path traversal param', async () => {
        const fixture = await createFixture({
            'src/app/items/[id]/page.html': 'Item page',
            'src/app/items/[id]/server.js': `export default {
                generatePaths: async () => [{ params: { id: '../../malicious' } }]
            }\n`,
        })
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        await assert.rejects(
            () => builder.buildRoute('/items/:id', builder.routes['/items/:id']),
            /Unsafe route path traversal/
        )

        await fixture.cleanup()
    })
})

describe('SiteBuilder.renderOnDemand', () => {
    test('rejects URLs containing ".." without writing anything', async () => {
        const fixture = await createFixture(baseTree())
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        await builder.renderOnDemand('/../../etc/passwd')

        await assert.rejects(() => fs.readdir(path.join(builder.outputDir, 'etc')))

        await fixture.cleanup()
    })

    test('regression: prefers data() over generatePaths() for on-demand single-page rendering', async () => {
        const fixture = await createFixture(baseTree())
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        await builder.renderOnDemand('/products/1')

        assert.equal(await logCount(fixture.dir, 'data-calls'), 1)
        assert.equal(await logCount(fixture.dir, 'generatePaths-calls'), 0)

        const html = await fs.readFile(path.join(builder.outputDir, 'products/1/index.html'), 'utf-8')
        assert.equal(html, 'One')

        await fixture.cleanup()
    })

    test('data() returning null does not render a page (404 fallthrough)', async () => {
        const fixture = await createFixture(baseTree())
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        await builder.renderOnDemand('/products/999')

        await assert.rejects(() => fs.readdir(path.join(builder.outputDir, 'products/999')))

        await fixture.cleanup()
    })

    test('generatePaths()-only routes still 404 for ids outside the allowlist', async () => {
        const fixture = await createFixture({
            'src/app/tags/[slug]/page.html': '{{ label }}',
            'src/app/tags/[slug]/server.js': `export default {
                generatePaths: async () => [{ params: { slug: 'red' }, data: { label: 'Red' } }],
            }\n`,
        })
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        await builder.renderOnDemand('/tags/red')
        const red = await fs.readFile(path.join(builder.outputDir, 'tags/red/index.html'), 'utf-8')
        assert.equal(red, 'Red')

        await builder.renderOnDemand('/tags/blue')
        await assert.rejects(() => fs.readdir(path.join(builder.outputDir, 'tags/blue')))

        await fixture.cleanup()
    })

    test('renders a flat static page and the custom 404 template', async () => {
        const fixture = await createFixture(baseTree())
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        await builder.renderOnDemand('/about')
        assert.equal(
            await fs.readFile(path.join(builder.outputDir, 'about/index.html'), 'utf-8'),
            'About page',
        )

        await builder.renderOnDemand('/404')
        assert.equal(await fs.readFile(path.join(builder.outputDir, '404.html'), 'utf-8'), 'Not Found')

        await fixture.cleanup()
    })

    test('serves /robots.txt and /sitemap.xml on demand, without a prior build()', async () => {
        const fixture = await createFixture(baseTree())
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        await builder.renderOnDemand('/robots.txt')
        const robots = await fs.readFile(path.join(builder.outputDir, 'robots.txt'), 'utf-8')
        assert.match(robots, /Sitemap: https:\/\/example\.com\/sitemap\.xml/)

        await builder.renderOnDemand('/sitemap.xml')
        const sitemap = await fs.readFile(path.join(builder.outputDir, 'sitemap.xml'), 'utf-8')
        assert.match(sitemap, /<loc>https:\/\/example\.com\/<\/loc>/)
        assert.match(sitemap, /<loc>https:\/\/example\.com\/products\/1<\/loc>/)
        assert.match(sitemap, /<loc>https:\/\/example\.com\/products\/2<\/loc>/)
        assert.match(sitemap, /<loc>https:\/\/example\.com\/about<\/loc>/)
        assert.ok(!sitemap.includes('404'))

        // No page.html for these two URLs, so nothing else should have been rendered.
        await assert.rejects(() => fs.readdir(path.join(builder.outputDir, 'products/1')))

        await fixture.cleanup()
    })

    test('/sitemap.xml on demand without siteUrl configured skips generation (warns, no file)', async () => {
        const tree = baseTree()
        tree['staticraft.config.js'] = `export default { outputDir: '.raft' }\n`
        const fixture = await createFixture(tree)
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        await builder.renderOnDemand('/sitemap.xml')
        await assert.rejects(() => fs.readFile(path.join(builder.outputDir, 'sitemap.xml')))

        await builder.renderOnDemand('/robots.txt')
        const robots = await fs.readFile(path.join(builder.outputDir, 'robots.txt'), 'utf-8')
        assert.equal(robots, 'User-agent: *\nAllow: /\n')

        await fixture.cleanup()
    })
})

describe('SiteBuilder.collectAllSiteUrls', () => {
    test('enumerates static, dynamic, and flat-file routes without rendering any pages', async () => {
        const fixture = await createFixture(baseTree())
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        const urls = await builder.collectAllSiteUrls()
        assert.deepEqual(urls.sort(), ['/', '/about', '/products', '/products/1', '/products/2'].sort())

        // Enumerating shouldn't have rendered any pages to disk.
        await assert.rejects(() => fs.readdir(builder.outputDir))

        await fixture.cleanup()
    })

    test('excludes 404 and flat files shadowed by a folder route', async () => {
        const fixture = await createFixture({
            'src/app/about/page.html': 'Folder version',
            'src/app/about.html': 'Flat version (shadowed)',
            'src/app/404.html': 'Not Found',
        })
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()

        const urls = await builder.collectAllSiteUrls()
        assert.deepEqual(urls, ['/about'])

        await fixture.cleanup()
    })
})

describe('SiteBuilder.processAssets', () => {
    test('excludes server.js, page.html, robots.txt and sitemap.xml from the hashed-asset sweep', async () => {
        const fixture = await createFixture({
            ...baseTree(),
            'src/app/styles.css': 'body{color:red}',
            'src/app/robots.txt': 'User-agent: *',
            'src/app/sitemap.xml': '<urlset></urlset>',
        })
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()
        await builder.processAssets()

        const assetBasenames = Object.keys(builder.assetMap)
        assert.ok(assetBasenames.some((k) => k.startsWith('styles.')))
        assert.ok(!('server.js' in builder.assetMap))
        assert.ok(!('page.html' in builder.assetMap))
        assert.ok(!('robots.txt' in builder.assetMap))
        assert.ok(!('sitemap.xml' in builder.assetMap))

        await fixture.cleanup()
    })

    test('skips asset hashing for assets listed in ignoreHash config', async () => {
        const fixture = await createFixture({
            'staticraft.config.js': `export default { outputDir: '.raft', ignoreHash: ['favicon.png', 'og-image.png'] }\n`,
            'src/app/favicon.png': 'icon-content',
            'src/app/og-image.png': 'og-content',
            'src/app/styles.css': 'body{color:blue}',
        })
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.loadConfig()
        await builder.processAssets()

        assert.equal(builder.assetMap['favicon.png'], 'favicon.png')
        assert.equal(builder.assetMap['og-image.png'], 'og-image.png')
        assert.match(builder.assetMap['styles.css'], /^styles\.[0-9a-f]{8}\.css$/)

        const faviconExists = await fs.readFile(path.join(builder.outputDir, 'favicon.png'), 'utf-8')
        assert.equal(faviconExists, 'icon-content')

        await fixture.cleanup()
    })
})

describe('SiteBuilder.build - flat file shadowed by folder route', () => {
    test('a page.html folder route wins over a same-named flat .html file', async () => {
        const fixture = await createFixture({
            'src/app/about/page.html': 'Folder version',
            'src/app/about.html': 'Flat version',
        })
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.build()

        const html = await fs.readFile(path.join(builder.outputDir, 'about/index.html'), 'utf-8')
        assert.equal(html, 'Folder version')

        await fixture.cleanup()
    })
})

describe('SiteBuilder.build - sitemap.xml / robots.txt', () => {
    test('with siteUrl: sitemap lists every rendered page and excludes 404', async () => {
        const fixture = await createFixture(baseTree())
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.build()

        const sitemap = await fs.readFile(path.join(builder.outputDir, 'sitemap.xml'), 'utf-8')
        assert.match(sitemap, /<loc>https:\/\/example\.com\/<\/loc>/)
        assert.match(sitemap, /<loc>https:\/\/example\.com\/products<\/loc>/)
        assert.match(sitemap, /<loc>https:\/\/example\.com\/products\/1<\/loc>/)
        assert.match(sitemap, /<loc>https:\/\/example\.com\/products\/2<\/loc>/)
        assert.match(sitemap, /<loc>https:\/\/example\.com\/about<\/loc>/)
        assert.ok(!sitemap.includes('404'))

        const robots = await fs.readFile(path.join(builder.outputDir, 'robots.txt'), 'utf-8')
        assert.match(robots, /Sitemap: https:\/\/example\.com\/sitemap\.xml/)

        await fixture.cleanup()
    })

    test('without siteUrl: sitemap.xml is skipped but robots.txt still writes', async () => {
        const tree = baseTree()
        tree['staticraft.config.js'] = `export default { outputDir: '.raft' }\n`
        const fixture = await createFixture(tree)
        const builder = new SiteBuilder({ rootDir: fixture.dir })
        await builder.build()

        await assert.rejects(() => fs.readFile(path.join(builder.outputDir, 'sitemap.xml')))

        const robots = await fs.readFile(path.join(builder.outputDir, 'robots.txt'), 'utf-8')
        assert.equal(robots, 'User-agent: *\nAllow: /\n')
        assert.ok(!robots.includes('Sitemap:'))

        await fixture.cleanup()
    })
})
