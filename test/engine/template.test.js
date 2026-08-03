import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { TemplateEngine, escapeHtml } from '../../src/engine/template.js'
import { createFixture } from '../helpers/fixture.js'

describe('escapeHtml', () => {
    test('escapes all XSS-relevant characters', () => {
        assert.equal(
            escapeHtml(`<script>alert('x' + "y")</script> & a=b \``),
            '&lt;script&gt;alert(&#039;x&#039; + &quot;y&quot;)&lt;/script&gt; &amp; a&#61;b &#96;',
        )
    })

    test('null and undefined become empty string', () => {
        assert.equal(escapeHtml(null), '')
        assert.equal(escapeHtml(undefined), '')
    })

    test('non-strings are stringified first', () => {
        assert.equal(escapeHtml(42), '42')
    })
})

async function makeEngine(tree) {
    const fixture = await createFixture(tree)
    const engine = new TemplateEngine({
        rootDir: fixture.dir,
        templatesDir: path.join(fixture.dir, 'src'),
    })
    return { engine, fixture }
}

describe('TemplateEngine variables & escaping', () => {
    test('{{ var }} is HTML-escaped, {{{ var }}} is raw', async () => {
        const { engine, fixture } = await makeEngine({})
        const out = await engine.render(
            '{{ title }} / {{{ title }}}',
            { title: '<b>hi</b>' },
        )
        assert.equal(out, '&lt;b&gt;hi&lt;/b&gt; / <b>hi</b>')
        await fixture.cleanup()
    })

    test('undefined variables render as empty string', async () => {
        const { engine, fixture } = await makeEngine({})
        const out = await engine.render('[{{ missing }}]', {})
        assert.equal(out, '[]')
        await fixture.cleanup()
    })

    test('dotted paths resolve nested properties', async () => {
        const { engine, fixture } = await makeEngine({})
        const out = await engine.render('{{ user.profile.name }}', {
            user: { profile: { name: 'Ada' } },
        })
        assert.equal(out, 'Ada')
        await fixture.cleanup()
    })
})

describe('TemplateEngine conditionals', () => {
    test('renders inner content only when truthy', async () => {
        const { engine, fixture } = await makeEngine({})
        const tpl = '{{#if show}}YES{{/if}}'
        assert.equal(await engine.render(tpl, { show: true }), 'YES')
        assert.equal(await engine.render(tpl, { show: false }), '')
        assert.equal(await engine.render(tpl, {}), '')
        await fixture.cleanup()
    })
})

describe('TemplateEngine loops', () => {
    test('iterates object items with per-item scope', async () => {
        const { engine, fixture } = await makeEngine({})
        const tpl = '{{#each items}}<li>{{ name }}</li>{{/each}}'
        const out = await engine.render(tpl, {
            items: [{ name: 'A' }, { name: 'B' }],
        })
        assert.equal(out, '<li>A</li><li>B</li>')
        await fixture.cleanup()
    })

    test('iterates primitive items via {{ this }}', async () => {
        const { engine, fixture } = await makeEngine({})
        const out = await engine.render('{{#each tags}}[{{ this }}]{{/each}}', {
            tags: ['a', 'b'],
        })
        assert.equal(out, '[a][b]')
        await fixture.cleanup()
    })

    test('non-array or empty array renders nothing', async () => {
        const { engine, fixture } = await makeEngine({})
        assert.equal(await engine.render('{{#each x}}Y{{/each}}', { x: 'not-array' }), '')
        assert.equal(await engine.render('{{#each x}}Y{{/each}}', { x: [] }), '')
        await fixture.cleanup()
    })
})

describe('TemplateEngine layout inheritance', () => {
    test('injects page body into {{ slot }}', async () => {
        const { engine, fixture } = await makeEngine({
            'src/layouts/base.html': '<html><body>{{ slot }}</body></html>',
        })
        const out = await engine.render('{{ layout "layouts/base.html" }}\n<p>Hi</p>')
        assert.equal(out, '<html><body>\n<p>Hi</p></body></html>')
        await fixture.cleanup()
    })

    test('injects page body into {{ body }} when slot is absent', async () => {
        const { engine, fixture } = await makeEngine({
            'src/layouts/base.html': '<main>{{ body }}</main>',
        })
        const out = await engine.render('{{ layout "layouts/base.html" }}X')
        assert.equal(out, '<main>X</main>')
        await fixture.cleanup()
    })

    test('missing layout falls back to the raw page body', async () => {
        const { engine, fixture } = await makeEngine({})
        const out = await engine.render('{{ layout "layouts/missing.html" }}Body only')
        assert.equal(out, 'Body only')
        await fixture.cleanup()
    })

    test('layout path escaping templatesDir is rejected, not read', async () => {
        const { engine, fixture } = await makeEngine({
            'secret.html': 'TOP SECRET',
        })
        const out = await engine.render('{{ layout "../secret.html" }}Body')
        assert.ok(!out.includes('TOP SECRET'))
        assert.equal(out, 'Body')
        await fixture.cleanup()
    })
})

describe('TemplateEngine component includes', () => {
    test('inlines a component and recursively resolves nested components', async () => {
        const { engine, fixture } = await makeEngine({
            'src/components/inner.html': 'INNER',
            'src/components/outer.html': 'OUTER[{{ component "components/inner.html" }}]',
        })
        const out = await engine.render('{{ component "components/outer.html" }}')
        assert.equal(out, 'OUTER[INNER]')
        await fixture.cleanup()
    })

    test('missing component renders an HTML comment placeholder', async () => {
        const { engine, fixture } = await makeEngine({})
        const out = await engine.render('{{ component "components/missing.html" }}')
        assert.match(out, /<!-- Missing component: components\/missing\.html -->/)
        await fixture.cleanup()
    })

    test('component path escaping templatesDir is rejected, not read', async () => {
        const { engine, fixture } = await makeEngine({
            'secret.html': 'TOP SECRET',
        })
        const out = await engine.render('{{ component "../secret.html" }}')
        assert.ok(!out.includes('TOP SECRET'))
        assert.match(out, /Forbidden component/)
        await fixture.cleanup()
    })

    test('self-referential components terminate safely instead of recursing forever', async () => {
        // The depth cap's thrown error is swallowed by the per-level try/catch
        // (the same one that handles a genuinely missing component file), so
        // this resolves rather than rejects - the property under test is that
        // it terminates at all, with no stack overflow / infinite loop.
        const fixture = await createFixture({
            'src/components/loop.html': '{{ component "components/loop.html" }}',
        })
        const engine = new TemplateEngine({
            rootDir: fixture.dir,
            templatesDir: path.join(fixture.dir, 'src'),
        })
        const out = await engine.render('{{ component "components/loop.html" }}')
        assert.match(out, /Missing component: components\/loop\.html/)
        await fixture.cleanup()
    })
})
