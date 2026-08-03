import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { DevServer } from '../../src/dev/server.js'
import { createFixture } from '../helpers/fixture.js'

function get(port, urlPath) {
    return new Promise((resolve, reject) => {
        http
            .get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
                let body = ''
                res.on('data', (chunk) => (body += chunk))
                res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }))
            })
            .on('error', reject)
    })
}

// For long-lived responses (SSE) - resolve as soon as headers arrive, then tear down.
function getHeadersOnly(port, urlPath) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
            resolve({ statusCode: res.statusCode, headers: res.headers })
            res.destroy()
            req.destroy()
        })
        req.on('error', () => {}) // destroying after resolve triggers a benign socket error
    })
}

let nextPort = 41000 + Math.floor(Math.random() * 5000)
async function startServer(tree) {
    const fixture = await createFixture(tree)
    const port = nextPort++
    const server = new DevServer({ rootDir: fixture.dir, staticDir: fixture.dir, port })
    await server.start(null) // no builder - serve only what's already on disk
    return { server, fixture, port }
}

describe('DevServer', () => {
    test('serves an existing static file with the right content type', async () => {
        const { server, fixture, port } = await startServer({
            'index.html': '<html><body>Hi</body></html>',
        })

        const res = await get(port, '/')
        assert.equal(res.statusCode, 200)
        assert.match(res.headers['content-type'], /text\/html/)
        assert.match(res.body, /Hi/)

        await server.stop()
        await fixture.cleanup()
    })

    test('injects the live-reload script into HTML responses', async () => {
        const { server, fixture, port } = await startServer({
            'index.html': '<html><body>Hi</body></html>',
        })

        const res = await get(port, '/')
        assert.match(res.body, /Staticraft Dev Stream/)
        assert.ok(res.body.indexOf('</script>') < res.body.indexOf('</body>') + '</body>'.length)

        await server.stop()
        await fixture.cleanup()
    })

    test('does not inject the live-reload script into non-HTML responses', async () => {
        const { server, fixture, port } = await startServer({
            'styles.css': 'body{color:red}',
        })

        const res = await get(port, '/styles.css')
        assert.equal(res.body, 'body{color:red}')
        assert.ok(!res.body.includes('Staticraft Dev Stream'))

        await server.stop()
        await fixture.cleanup()
    })

    test('path traversal in the URL cannot escape staticDir', async () => {
        const { server, fixture, port } = await startServer({
            'index.html': '<html><body>Hi</body></html>',
        })

        const res = await get(port, '/../../../../../../etc/passwd')
        assert.equal(res.statusCode, 404)

        await server.stop()
        await fixture.cleanup()
    })

    test('missing route falls back to the custom 404.html when present', async () => {
        const { server, fixture, port } = await startServer({
            '404.html': '<html><body>Custom Not Found</body></html>',
        })

        const res = await get(port, '/nowhere')
        assert.equal(res.statusCode, 404)
        assert.match(res.body, /Custom Not Found/)

        await server.stop()
        await fixture.cleanup()
    })

    test('missing route falls back to the built-in 404 page when no custom one exists', async () => {
        const { server, fixture, port } = await startServer({
            'index.html': '<html><body>Hi</body></html>',
        })

        const res = await get(port, '/nowhere')
        assert.equal(res.statusCode, 404)
        assert.match(res.body, /Page Not Found/)

        await server.stop()
        await fixture.cleanup()
    })

    test('/__staticraft responds with an SSE content-type', async () => {
        const { server, fixture, port } = await startServer({
            'index.html': '<html><body>Hi</body></html>',
        })

        const res = await getHeadersOnly(port, '/__staticraft')
        assert.equal(res.statusCode, 200)
        assert.match(res.headers['content-type'], /text\/event-stream/)

        await server.stop()
        await fixture.cleanup()
    })
})
