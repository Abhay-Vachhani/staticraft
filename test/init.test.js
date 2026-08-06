import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runInit } from '../src/init.js'
import { createFixture } from './helpers/fixture.js'

describe('runInit', () => {
    test('scaffolds a complete starter project in non-interactive mode defaulting to app/', async () => {
        const fixture = await createFixture({})
        const targetDir = path.join(fixture.dir, 'my-test-app')

        await runInit({
            targetDir,
            siteUrl: 'https://test.example.com',
            yes: true,
        })

        const pkg = JSON.parse(await fs.readFile(path.join(targetDir, 'package.json'), 'utf-8'))
        assert.equal(pkg.name, 'my-test-app')
        assert.equal(pkg.type, 'module')
        assert.equal(pkg.scripts.dev, 'staticraft dev')

        const config = await fs.readFile(path.join(targetDir, 'staticraft.config.js'), 'utf-8')
        assert.match(config, /siteUrl: 'https:\/\/test\.example\.com'/)
        assert.match(config, /srcDir: 'app'/)

        const pageHtml = await fs.readFile(path.join(targetDir, 'app/page.html'), 'utf-8')
        assert.match(pageHtml, /<title>\{\{ title \}\}<\/title>/)

        const serverJs = await fs.readFile(path.join(targetDir, 'app/server.js'), 'utf-8')
        assert.match(serverJs, /revalidate: 600/)

        const page404Html = await fs.readFile(path.join(targetDir, 'app/404.html'), 'utf-8')
        assert.match(page404Html, /404 Page Not Found/)

        await fixture.cleanup()
    })

    test('scaffolds project under src/app when useSrc is true', async () => {
        const fixture = await createFixture({})
        const targetDir = path.join(fixture.dir, 'my-src-app')

        await runInit({
            targetDir,
            siteUrl: 'https://test.example.com',
            yes: true,
            useSrc: true,
        })

        const config = await fs.readFile(path.join(targetDir, 'staticraft.config.js'), 'utf-8')
        assert.match(config, /srcDir: 'src\/app'/)

        const pageHtml = await fs.readFile(path.join(targetDir, 'src/app/page.html'), 'utf-8')
        assert.match(pageHtml, /<title>\{\{ title \}\}<\/title>/)

        await fixture.cleanup()
    })
})
