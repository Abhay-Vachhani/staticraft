import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runInit } from '../src/init.js'
import { createFixture } from './helpers/fixture.js'

describe('runInit', () => {
    test('scaffolds a complete starter project in non-interactive mode', async () => {
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

        const pageHtml = await fs.readFile(path.join(targetDir, 'src/app/page.html'), 'utf-8')
        assert.match(pageHtml, /<title>\{\{ title \}\}<\/title>/)

        const serverJs = await fs.readFile(path.join(targetDir, 'src/app/server.js'), 'utf-8')
        assert.match(serverJs, /revalidate: 600/)

        await fixture.cleanup()
    })
})
