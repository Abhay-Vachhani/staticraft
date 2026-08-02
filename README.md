# Staticraft

> **Generate privately. Serve statically. Update continuously.**

**Staticraft (Static + Raft)** is a security-first, event-driven web framework that renders static HTML from templates and data sources in an isolated background process, serving generated pages instantly via high-performance static web servers (e.g., Nginx, Caddy, or CDNs).

---

## 🌟 Overview

Unlike traditional Server-Side Rendering (SSR) frameworks or standard Static Site Generators (SSG), Staticraft decouples the **rendering lifecycle** from the **serving layer**. 

A private background worker renders HTML files using atomic file swaps, allowing continuous content updates without exposing database connections, template engines, or application logic to the public internet.

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
|                     | /public Directory  |                      |
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

- 🛡️ **No Public Application Port**: The background generator runs without exposing public HTTP ports. Public web traffic is handled strictly by the web server (e.g., Nginx), preventing direct web attacks against the application backend runtime.
- ⚡ **High-Performance Static Delivery**: Web servers serve pre-rendered HTML files directly from disk/cache without dynamic template execution overhead.
- 🔄 **Atomic File Swapping**: Pages are written to temporary staging files before an atomic `rename(2)` swap, preventing half-rendered pages or broken reads.
- 📡 **Continuous Event-Driven Updates**: Re-renders pages dynamically when content updates occur.
- 💻 **Zero-Setup Dev Mode**: Built-in development server defaulting to port `4455` on `localhost` (with automatic port detection/fallback and optional `--host` binding), eliminating the need for Nginx/Caddy during local development.
- 🧩 **Component Architecture**: Reusable layouts, components, partials, and dynamic asset hashing.
- 💰 **Low Cost & High Scalability**: Serve millions of requests with minimal infrastructure overhead.

---

## 🏗️ Architecture & Core Principles

### 1. Template Engine
Create modular HTML templates using layouts, components, slot injections, and dynamic data binding.

### 2. Isolated Background Generator
A daemon process running inside a private network segment. In production, it does not open any public HTTP ports.

### 3. Data Integration
Pulls dynamic content from templates, data files, and external APIs.

### 4. Smart Regeneration
Only re-renders affected pages via dependency-graph tracking (e.g., updating article #42 only updates `posts/42.html` and index pages).

### 5. Safe File Publishing
Generates pages into temporary files (`.page.html.tmp`) and atomically renames them to `.html`.

### 6. Static Web Serving (Production & Dev)
- **Production**: Delegates serving of HTML, CSS, JS, and media to production-grade static file servers (Nginx/Caddy/CDN).
- **Development**: Spins up an automatic local server on `http://localhost:4455` (or next free port) for instant previewing.

---

## 🚀 Quick Start & CLI Usage

Staticraft requires zero external npm dependencies. Modern Node.js (v18+) standard library handles everything out of the box:

```bash
./raft dev                # Start dev server on http://localhost:4455 (with HTTP preview)
./raft dev --port 5000    # Custom port override
./raft dev --host         # Bind dev server to 0.0.0.0 for local network access
./raft start              # Run production background worker daemon (NO HTTP server, pushes static updates)
./raft build              # One-shot build: compile static files to /public and exit
```

---

## 🔒 Security Principles

1. **Unexposed Application Backend**: The backend generator runs as an isolated worker with no public HTTP ports open, eliminating direct application port attack vectors.
2. **Public Tier Isolation**: Public ports are handled strictly by the web server (Nginx/Caddy) to serve static files.
3. **Strict File Permissions**: The web server process has read-only access to the `/public` output directory.
4. **Escaped Outputs**: Contextual XSS escaping across all compiled HTML templates.

---

## 📄 License & Contributions

MIT License. See [LICENSE](LICENSE) for details. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for security and contribution policies.
