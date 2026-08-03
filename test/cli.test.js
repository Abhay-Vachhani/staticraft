import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseCliArgs } from '../src/cli.js'

describe('parseCliArgs', () => {
    test('no args defaults to the help command', () => {
        const opts = parseCliArgs([])
        assert.equal(opts.command, 'help')
        assert.equal(opts.port, 4455)
        assert.equal(opts.host, false)
    })

    test('reads the command from the first positional arg', () => {
        assert.equal(parseCliArgs(['dev']).command, 'dev')
        assert.equal(parseCliArgs(['build']).command, 'build')
        assert.equal(parseCliArgs(['start']).command, 'start')
    })

    test('--port / -p override the default port', () => {
        assert.equal(parseCliArgs(['dev', '--port', '3000']).port, 3000)
        assert.equal(parseCliArgs(['dev', '-p', '3000']).port, 3000)
    })

    test('an invalid port falls back to 4455', () => {
        assert.equal(parseCliArgs(['dev', '--port', 'not-a-number']).port, 4455)
    })

    test('--host / -H enable LAN binding', () => {
        assert.equal(parseCliArgs(['dev']).host, false)
        assert.equal(parseCliArgs(['dev', '--host']).host, true)
        assert.equal(parseCliArgs(['dev', '-H']).host, true)
    })

    test('--help / -h force the help command regardless of the given command', () => {
        assert.equal(parseCliArgs(['--help']).command, 'help')
        assert.equal(parseCliArgs(['build', '--help']).command, 'help')
        assert.equal(parseCliArgs(['build', '-h']).command, 'help')
    })

    test('a flag-only first arg does not get treated as a command', () => {
        const opts = parseCliArgs(['--port', '3000'])
        assert.equal(opts.command, 'help')
        assert.equal(opts.port, 3000)
    })
})
