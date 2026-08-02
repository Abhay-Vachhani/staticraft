# Staticraft

> **Generate privately. Serve statically. Update continuously.**

**Staticraft (Static + Raft)** is a security-first, event-driven static site engine that renders HTML from templates and live data sources in an isolated background process, then serves pre-built pages via high-performance static file servers (Nginx, Caddy, or CDNs).

---

## 🌟 Overview

Unlike traditional SSR frameworks or standard SSGs, Staticraft fully decouples the **rendering lifecycle** from the **serving layer**.

A private background worker fetches data, renders HTML files using atomic file swaps, and continuously refreshes pages on configurable timers — all without exposing any application logic to the public internet.

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
- 💻 **Zero-Setup Dev Mode**: Built-in dev server on `localhost:4455` (auto port fallback) with live rebuild on file changes — no Nginx/Caddy needed locally.
- 🧩 **Component Architecture**: Reusable layouts, components, partials, slot injection, and automatic asset fingerprinting (e.g. `styles.f4603f46.css`).
- 🚫 **Custom 404 Page**: Drop a `src/404.html` to define your own not-found error page — compiled automatically and served on any missing route.
- 💰 **Low Cost & High Scalability**: Serve millions of requests with minimal infrastructure overhead.

---

## 🏗️ Architecture & Core Principles

### 1. Template Engine
Create modular HTML templates using layouts, components, slot injection, and dynamic data binding via `{{ }}` expressions.

### 2. Isolated Background Generator
A daemon process running inside a private network. In production (`staticraft start`), it opens **no public HTTP ports** — it only writes files into `.raft/`.

### 3. Data Integration
Routes pull dynamic content from external APIs, databases, CMS, or local data files via the `data()` and `generatePaths()` hooks in `staticraft.config.js`.

### 4. Timer-Based Revalidation
Routes with a `revalidate` interval are re-fetched and re-rendered on a background timer by `ScheduleManager`. Routes without `revalidate` are **permanent** — compiled once and never auto-invalidated.

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
staticraft dev                # Start dev server on http://localhost:4455 (live rebuild)
staticraft dev --port 5000    # Custom port override
staticraft dev --host         # Bind dev server to 0.0.0.0 for local network access
staticraft start              # Run production background worker (NO HTTP server)
staticraft build              # One-shot build: compile all pages to .raft/ and exit
```

---

## ⚙️ Configuration — `staticraft.config.js`

Define routes, data fetchers, revalidation timers, and output settings:

```js
export default {
    outputDir: '.raft',

    routes: {
        // Static route with a revalidation timer
        '/': {
            revalidate: 600, // Re-render every 600 seconds
            data: async () => {
                const res = await fetch('https://api.example.com/featured')
                return await res.json()
            }
        },

        // Dynamic SSG route — generates one page per item
        '/products/:id': {
            revalidate: 100,
            generatePaths: async () => {
                const res = await fetch('https://api.example.com/products?limit=0')
                const { products } = await res.json()
                return products.map(p => ({
                    params: { id: String(p.id) },
                    data: p
                }))
            }
        },

        // Permanent static route (no revalidate = never auto-invalidated)
        '/about': {}
    }
}
```

### Route Types

| Symbol | Type | Description |
|--------|------|-------------|
| `○` | Static | Rendered once (or on a timer). No dynamic params. |
| `●` | Dynamic (SSG) | One page generated per item from `generatePaths()`. |

### Cache & Revalidation

- Routes with `revalidate: N` are refreshed every `N` seconds by the background scheduler.
- Routes without `revalidate` are **permanent** — compiled once and left unchanged until next full build.
- Default CDN cache expiry: `max-age=31536000, immutable` (1 Year).

---

## 🗂️ Project Structure

```
my-site/
├── src/
│   ├── index.html          # Home page template
│   ├── products.html       # Products listing template
│   ├── 404.html            # Custom error page (system template, not a routable URL)
│   ├── products/
│   │   └── [id].html       # Dynamic product detail template
│   ├── layouts/
│   │   └── base.html       # Shared base layout
│   └── components/         # Reusable partials
│       └── navbar.html
├── staticraft.config.js    # Route & data configuration
└── .raft/                  # Compiled static output (served by Nginx/Caddy)
    ├── index.html
    ├── products/
    │   ├── index.html
    │   └── 42/
    │       └── index.html
    └── 404.html            # Compiled from src/404.html
```

---

## 🚫 Custom 404 Page

Create `src/404.html` using your site layout:

```html
{{ layout "layouts/base.html" }}

<section>
    <h1>Page Not Found</h1>
    <p>The page you requested does not exist.</p>
    <a href="/">Return Home</a>
</section>
```

Staticraft compiles it to `.raft/404.html` — a **system error template**, not a browseable route. Visiting `/404` directly returns a proper HTTP `404` status.

For Nginx production config:
```nginx
error_page 404 /404.html;
```

---

## 📊 Build Output

`staticraft build` prints a full summary table:

```
┌──────────────────────────┬──────────────┬──────────────┬──────────┐
│ Route (Staticraft)       │ Revalidate   │ Cache Expiry │    Count │
├──────────────────────────┼──────────────┼──────────────┼──────────┤
│ ○ /                      │ 600s         │ 1 Year       │        1 │
│ ○ /products              │ 300s         │ 1 Year       │        1 │
│ ● /products/:id          │ 100s         │ 1 Year       │      194 │
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

## 🧪 Demo Site — KRAFT

The `src/` directory contains **KRAFT**, a demo studio objects catalog used to demonstrate Staticraft's capabilities:

- **Home** (`/`) — Hero section, revalidated every 600s.
- **Collection** (`/products`) — Product listing, revalidated every 300s.
- **Product Detail** (`/products/:id`) — 194 individual product pages from the [DummyJSON API](https://dummyjson.com/docs/products), each revalidated every 100s.
- **About** (`/about`) — Permanent static page with no revalidation.
- **404** — Custom error page served on any missing route.

> This demo site is illustrative only. Replace `src/` templates and `staticraft.config.js` routes with your own project content.

---

## 📄 License & Contributions

MIT License. See [LICENSE](LICENSE) for details. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for security and contribution policies.
