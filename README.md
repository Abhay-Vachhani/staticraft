# Staticraft

> **Generate privately. Serve statically. Update continuously.**

[![npm version](https://img.shields.io/npm/v/staticraft?color=6366f1)](https://npmjs.com/package/staticraft)
[![Official Documentation](https://img.shields.io/badge/Docs-Live-10b981)](https://abhay-vachhani.github.io/staticraft/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

📖 **Official Documentation**: [https://abhay-vachhani.github.io/staticraft/](https://abhay-vachhani.github.io/staticraft/)  
📦 **npm Package**: [https://npmjs.com/package/staticraft](https://npmjs.com/package/staticraft)

---

## 🌟 Overview

Unlike traditional SSR frameworks or standard SSGs, Staticraft fully decouples the **rendering lifecycle** from the **serving layer**.

A private background worker fetches data, renders HTML files using atomic file swaps, and continuously refreshes pages on configurable timers - all without exposing any application logic to the public internet.

```
+-----------------------------------------------------------------+
|                         PRIVATE NETWORK                         |
|                                                                 |
|   +-----------------+      +--------------------------------+   |
|   |  Data Sources   | ---> |       Staticraft Worker        |   |
|   | (DB, CMS, APIs) |      | (Isolated Background Process)  |   |
|   +-----------------+      +---------------+----------------+   |
|                                            |                    |
|                                            | Renders &          |
|                                            | Atomic Swaps       |
+--------------------------------------------|--------------------+
                                             v
+-----------------------------------------------------------------+
|                        PUBLIC WORKSPACE                         |
|                                                                 |
|                     +--------------------+                      |
|                     |  .raft/ Directory  |                      |
|                     +---------+----------+                      |
|                               |                                 |
|                               v                                 |
|                    +----------------------+                     |
|                    |  Nginx / Caddy / CDN |                     |
|                    +----------+-----------+                     |
|                               |                                 |
+-------------------------------|---------------------------------+
                                v
                        [ Client Request ]
```

---

## ✨ Key Features

- 🛡️ **No Public Application Port**: The background generator runs without exposing public HTTP ports. Public web traffic is handled strictly by the web server (e.g., Nginx), preventing direct web attacks against the application backend.
- ⚡ **High-Performance Static Delivery**: Web servers serve pre-rendered HTML files directly from disk/cache with zero dynamic template execution overhead.
- 🔄 **Atomic File Swapping**: Pages are written to a temporary staging file before an atomic `rename(2)` swap, preventing half-rendered pages or torn reads.
- 📡 **Continuous Revalidation**: Routes are re-rendered on configurable timers (e.g., every 100s, 600s) via the background `ScheduleManager`. Permanent pages have no timer and are never auto-invalidated.
- 💻 **Zero-Setup Dev Mode**: Built-in dev server on `localhost:4455` (auto port fallback) with live rebuild on file changes - no Nginx/Caddy needed locally.
- 🧩 **Component Architecture**: Reusable layouts, components, partials, slot injection, and automatic asset fingerprinting (e.g. `styles.f4603f46.css`).
- 🚫 **Custom 404 Page**: Drop a `src/app/404.html` to define your own not-found error page - compiled automatically and served on any missing route.
- 🗺️ **Sitemap & Robots**: `sitemap.xml` and `robots.txt` are generated automatically from every known route - on `staticraft build`, and on demand in `staticraft dev`.
- 💰 **Low Cost & High Scalability**: Serve millions of requests with minimal infrastructure overhead.

---

## 🏗️ Architecture & Core Principles

### 1. Template Engine
Create modular HTML templates using layouts, components, slot injection, and dynamic data binding via `{{ }}` expressions.

### 2. Isolated Background Generator
A daemon process running inside a private network. In production (`staticraft start`), it opens **no public HTTP ports** - it only writes files into `.raft/`.

### 3. Data Integration
Routes pull dynamic content from external APIs, databases, CMS, or local data files via the `data()` and `generatePaths()` hooks in each route's colocated `server.js` file.

### 4. Timer-Based Revalidation
Routes with a `revalidate` interval are re-fetched and re-rendered on a background timer by `ScheduleManager`. Routes without `revalidate` are **permanent** - compiled once and never auto-invalidated.

### 5. Safe File Publishing
Pages are written to temporary files and atomically renamed to their final path, ensuring zero downtime or torn reads during updates.

### 6. Static Web Serving (Production & Dev)
- **Production**: Nginx/Caddy/CDN serves `.raft/` directly. Configure `error_page 404 /404.html` for custom 404 handling.
- **Development**: Built-in dev server with live rebuild, custom 404 support, and asset serving.

---

## 🚀 Quick Start & CLI Usage

Staticraft requires **zero external npm dependencies**. Modern Node.js (v18+) standard library handles everything out of the box.

### Execution Options:
```bash
# 1. Global installation
npm install -g staticraft
staticraft dev

# 2. On-demand execution with npx
npx staticraft dev

# 3. Direct execution from source repository
./staticraft dev
```

### Command Reference:
```bash
staticraft init [dir]           # Scaffold a new project interactively (defaults to app/)
staticraft init [dir] -y        # Scaffold non-interactively with default options
staticraft init [dir] --no-src  # Scaffold using app/ structure (default)
staticraft init [dir] --src     # Scaffold using src/app/ structure
staticraft dev                  # Start dev server on http://localhost:4455 (live rebuild)
staticraft dev --port 5000      # Custom port override
staticraft dev --host           # Bind dev server to 0.0.0.0 for local network access
staticraft start                # Run production background worker (NO HTTP server)
staticraft build                # One-shot build: compile all pages to .raft/ and exit
```

### Running the Test Suite
```bash
npm test    # node's built-in test runner - no test framework dependency
```
Tests live under `test/`, mirroring `src/`'s structure, and run entirely against throwaway temp-directory fixtures - they never touch this repo's own `src/`, `.raft/`, or `staticraft.config.js`.

---

## ⚙️ Configuration - `staticraft.config.js`

This file holds only global build settings - no route or data logic lives here:

```js
export default {
    outputDir: '.raft',
    defaultExpiry: '1y',
    siteUrl: 'https://example.com', // Optional - enables sitemap.xml generation
    srcDir: 'app',                  // Optional - defaults to app/ or src/app/
    ignoreHash: ['favicon.png', 'og-image.png'], // Optional - skip asset hashing for specific files/patterns
}
```

| Field | Description |
|-------|--------------|
| `outputDir` | Where compiled pages are written (default `.raft`). |
| `defaultExpiry` | Default CDN cache expiry. |
| `siteUrl` | Absolute origin used to build `sitemap.xml`. Omit to skip sitemap generation entirely. |
| `srcDir` | Application source directory (default auto-detects `app/` or `src/app/`). |
| `ignoreHash` | Array of asset filenames, relative paths, or wildcard patterns to skip hashing for. |

## 🗺️ Routing - file-based, colocated `server.js`

Every route is defined by where its files live under `app/` (or `src/app/` if configured) - Staticraft's own engine (`src/engine`, `src/worker`, `src/dev`, `src/cli.js`) lives outside of it, so a route or asset can never collide with or accidentally expose engine internals:

- **A folder containing `page.html`** is a route. The folder path (relative to `app/`) becomes the URL, and `[param]` segments become dynamic params - e.g. `app/products/[id]/page.html` → `/products/:id`. `app/page.html` itself is the root route, `/`.
- **A sibling `server.js`** in that same folder is optional and supplies `data`, `generatePaths`, and `revalidate`.
- **A bare `name.html`** with no folder is a purely static page (no data/revalidate possible) - e.g. `src/app/about.html` → `/about`.

```js
// src/app/products/[id]/server.js
export default {
    revalidate: 3600, // Re-render every 3600 seconds (omit = permanent, never auto-invalidated)

    // On-demand rendering (dev lazy-compile, production on-demand): fetches
    // just the one requested item. Preferred over generatePaths() whenever
    // both are defined - return null/undefined to signal "not a real page"
    // (renders a 404 instead).
    data: async ({ params }) => {
        const res = await fetch(`https://api.example.com/products/${params.id}`)
        if (!res.ok) return null
        return { product: await res.json() }
    },

    // Full/scheduled builds: enumerates every valid id so all pages can be
    // prebuilt ahead of time. Not used for on-demand requests when data() exists.
    generatePaths: async () => {
        const res = await fetch('https://api.example.com/products?limit=0')
        const { products } = await res.json()
        return products.map(p => ({
            params: { id: String(p.id) },
            data: { product: p }
        }))
    }
}
```

Only need one prebuilt page per request and no full-build step? A dynamic route can define `data()` alone with no `generatePaths()` - every id is accepted and fetched on demand, but `staticraft build`/`start` won't prebuild any pages for it up front.

```js
// src/app/server.js - colocated with src/app/page.html, the root route "/"
export default {
    revalidate: 600,
    data: async () => {
        const res = await fetch('https://api.example.com/featured')
        return await res.json()
    }
}
```

`src/app/about.html` needs no `server.js` at all - it's rendered once, permanently, with no data.

### Route Types

| Symbol | Type | Description |
|--------|------|-------------|
| `○` | Static | Rendered once (or on a timer). No dynamic params. |
| `●` | Dynamic (SSG) | One page generated per item from `generatePaths()`. |

### Cache & Revalidation

- Routes with `revalidate: N` are refreshed every `N` seconds by the background scheduler.
- Routes without `revalidate` are **permanent** - compiled once and left unchanged until next full build.
- Default CDN cache expiry: `max-age=31536000, immutable` (1 Year).

---

## 🗂️ Project Structure

```
my-site/
├── src/
│   └── app/                # All site content lives here
│       ├── page.html       # Home page template ("/")
│       ├── server.js       # Optional data/revalidate for "/"
│       ├── products/
│       │   ├── page.html   # Products listing template ("/products")
│       │   ├── server.js   # Optional data/revalidate for "/products"
│       │   └── [id]/
│       │       ├── page.html   # Dynamic product detail template ("/products/:id")
│       │       └── server.js   # generatePaths (or data) + revalidate
│       ├── about.html      # Flat = purely static page, no server.js needed
│       ├── 404.html        # Custom error page (system template, not a routable URL)
│       ├── layouts/
│       │   └── base.html   # Shared base layout
│       └── components/     # Reusable partials
│           └── navbar.html
├── staticraft.config.js    # Global settings only (outputDir, defaultExpiry)
└── .raft/                  # Compiled static output (served by Nginx/Caddy)
    ├── index.html
    ├── products/
    │   ├── index.html
    │   └── 42/
    │       └── index.html
    └── 404.html            # Compiled from src/app/404.html
```

`src/app/` is the only directory Staticraft ever reads routes/assets from - it never touches anything outside it (its own engine code lives entirely separately), so a route or static file in your project can never collide with or accidentally expose Staticraft's internals.

---

## 🚫 Custom 404 Page

Create `src/app/404.html` using your site layout:

```html
{{ layout "layouts/base.html" }}

<section>
    <h1>Page Not Found</h1>
    <p>The page you requested does not exist.</p>
    <a href="/">Return Home</a>
</section>
```

Staticraft compiles it to `.raft/404.html` - a **system error template**, not a browseable route. Visiting `/404` directly returns a proper HTTP `404` status.

For Nginx production config:
```nginx
error_page 404 /404.html;
```

---

## 🗺️ Sitemap & Robots

`staticraft build` (and `staticraft start`'s initial build) always writes `.raft/robots.txt`, and writes `.raft/sitemap.xml` too if `siteUrl` is set in `staticraft.config.js`. `staticraft dev` generates both lazily on first request, same as any other on-demand page.

- **`sitemap.xml`** lists every page Staticraft knows about - every static route, every enumerated dynamic (`generatePaths()`) page, and every flat static HTML page - excluding `404`. In a full build this comes from the same data as the build manifest, so it can't drift from what's really in `.raft/`.
- **`robots.txt`** is always generated (`Allow: /`), with a `Sitemap:` line added automatically when `siteUrl` is configured.

In dev mode, requesting `/sitemap.xml` still has to enumerate every dynamic route via its `generatePaths()` (there's no way to list every page without it), so the first request can be as slow as a full build - but it doesn't render the individual pages themselves, and the result is cached to disk like any other on-demand route until the next file change.

Without `siteUrl` configured, `sitemap.xml` is skipped (with a console warning) since sitemap URLs must be absolute.

---

## 📊 Build Output

`staticraft build` prints a full summary table:

```
┌──────────────────────────┬──────────────┬──────────────┬──────────┐
│ Route (Staticraft)       │ Revalidate   │ Cache Expiry │    Count │
├──────────────────────────┼──────────────┼──────────────┼──────────┤
│ ○ /                      │ 600s         │ 1 Year       │        1 │
│ ○ /products              │ 300s         │ 1 Year       │        1 │
│ ● /products/:id          │ 3600s        │ 1 Year       │      194 │
│ ○ /about                 │ -            │ -            │        1 │
│ ○ 404                    │ -            │ -            │        1 │
└──────────────────────────┴──────────────┴──────────────┴──────────┘

  ○  (Static)        4 pages
  ●  (SSG Dynamic)   194 pages

  ✦ Total Pages:   198 static pages compiled into .raft/ (2604ms)
  ✦ Default Cache: max-age=31536000, immutable (1 Year CDN/Browser Expiry)
```

- **Revalidate `-`** = permanent page, no background invalidation timer.
- **Cache Expiry `-`** = permanent, no scheduled CDN expiry.
- `404` appears at the bottom as a special system page.

---

## 🔒 Security Principles

1. **Unexposed Application Backend**: The background generator runs with no public HTTP ports, eliminating direct application port attack vectors.
2. **Public Tier Isolation**: Public traffic is handled strictly by Nginx/Caddy reading from `.raft/`.
3. **Strict File Permissions**: The web server process has read-only access to `.raft/`.
4. **Escaped Outputs**: Contextual XSS escaping across all compiled HTML templates.
5. **Atomic Writes**: No partial or torn page states visible to end users during updates.

---

## 🧪 Demo Site - KRAFT

The `src/app/` directory contains **KRAFT**, a demo studio objects catalog used to demonstrate Staticraft's capabilities:

- **Home** (`/`) - Hero section, revalidated every 600s.
- **Collection** (`/products`) - Product listing, revalidated every 300s.
- **Product Detail** (`/products/:id`) - 194 individual product pages from the [DummyJSON API](https://dummyjson.com/docs/products), each revalidated every 3600s.
- **About** (`/about`) - Permanent static page with no revalidation.
- **404** - Custom error page served on any missing route.

> This demo site is illustrative only. Replace the `src/app/` route folders (`page.html` + `server.js`) with your own project content.

---

## 📄 License & Contributions

MIT License. See [LICENSE](LICENSE) for details. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for security and contribution policies.
