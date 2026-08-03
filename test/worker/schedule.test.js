import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ScheduleManager } from '../../src/worker/schedule.js'

function makeFakeBuilder(routes) {
    const calls = []
    return {
        routes,
        calls,
        buildRoute: async (pattern, entry) => {
            calls.push(pattern)
        },
    }
}

// Lets pending microtasks from the (async) timer callback settle before assertions.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ScheduleManager', () => {
    test('fires a timer only for routes with a revalidate interval', async (t) => {
        t.mock.timers.enable({ apis: ['setInterval'] })

        const builder = makeFakeBuilder({
            '/': { dir: '/x', mod: { revalidate: 10 } }, // 10s
            '/about': { dir: '/x', mod: {} }, // permanent
        })
        const schedule = new ScheduleManager(builder)
        schedule.start()

        t.mock.timers.tick(10_000)
        await flush()
        assert.deepEqual(builder.calls, ['/'])

        t.mock.timers.tick(10_000)
        await flush()
        assert.deepEqual(builder.calls, ['/', '/'])

        schedule.stop()
    })

    test('stop() clears timers so no further builds happen', async (t) => {
        t.mock.timers.enable({ apis: ['setInterval'] })

        const builder = makeFakeBuilder({
            '/': { dir: '/x', mod: { revalidate: 5 } },
        })
        const schedule = new ScheduleManager(builder)
        schedule.start()

        t.mock.timers.tick(5_000)
        await flush()
        assert.deepEqual(builder.calls, ['/'])

        schedule.stop()
        t.mock.timers.tick(50_000)
        await flush()
        assert.deepEqual(builder.calls, ['/'])
    })

    test('calling start() twice does not register duplicate timers', async (t) => {
        t.mock.timers.enable({ apis: ['setInterval'] })

        const builder = makeFakeBuilder({
            '/': { dir: '/x', mod: { revalidate: 10 } },
        })
        const schedule = new ScheduleManager(builder)
        schedule.start()
        schedule.start()

        t.mock.timers.tick(10_000)
        await flush()
        assert.deepEqual(builder.calls, ['/'])

        schedule.stop()
    })
})
