# Personal Code Editor (PCE)

A full-stack, browser-based web IDE and code execution platform built with **Node.js**, **Express**, **Socket.IO**, **Monaco Editor**, **MongoDB**, and **LangChain**.

---

## Features

- **Monaco Editor Interface**: Full-featured code editor with syntax highlighting, auto-formatting (Prettier), file tree management, and tabbed workspace browsing.
- **Multi-Language Execution Engine**: Run code locally across 15+ languages including JavaScript, TypeScript, Python, C++, C, Java, Rust, Go, C#, PHP, Ruby, Swift, Kotlin, SQL, and Bash.
- **AI Teacher Agent**: Context-aware AI assistant powered by LangChain and Ollama (local models + cloud fallback) capable of answering programming queries and proposing workspace file modifications.
- **Project & PDF Export Management**: Save and organize workspaces, export code documents as PDFs, and download project archives (.zip).
- **Hardened Security Posture**: Production-grade execution sandboxing, strict JWT verification, CSP, rate limiting, and prompt injection guards.

---

## Security Architecture

The codebase has undergone a comprehensive application security audit and hardening process. The key security controls implemented include:

### 1. Process & Sandbox Isolation
- **Explicit Environment Allowlist (`SAFE_ENV`)**: Child processes spawned for code execution do **not** inherit `process.env`. Host secrets, database URIs (`MONGO_URI`), authentication keys (`JWT_SECRET`), and API keys are isolated from the runner environment.
- **Hard Wall-Clock Timeout**: Every code run enforces a strict 5,000ms wall-clock timeout terminated via `SIGKILL`.
- **Cumulative Output Cap**: Processes are killed if combined `stdout` and `stderr` exceed 100 KB to mitigate buffer overflow and resource exhaustion attacks.
- **Execution Concurrency Semaphores**: Limits execution to 1 active process per user and a configurable global concurrency cap (`MAX_CONCURRENT_RUNS`, default 5). Excess requests return HTTP 429.
- **Filesystem Isolation**: Code executions run in unique, isolated temporary directories (`/tmp/ce_<uuid>`) that are automatically unlinked upon completion.

### 2. Authentication & Session Security
- **JWT Algorithm Pinning**: All `jwt.verify()` calls explicitly enforce `algorithms: ['HS256']`, mitigating `alg: "none"` and key confusion attacks.
- **Secret Strength Validation**: Server bootstrap throws a fatal error if `JWT_SECRET` is unset, shorter than 32 characters, or set to known weak default values.
- **Cross-User Authorization (IDOR Defense)**: All workspace and PDF endpoints (`/api/projects/:id`, `/api/pdfs/:id`) verify `resource.userId === req.user.userId` before granting read or write permissions.
- **NoSQL Injection Defense**: Incoming requests are sanitized by recursively stripping `$` and `.` MongoDB operator keys from request bodies, queries, and route parameters.

### 3. Content Security Policy (CSP) & Headers
- Integrated **Helmet** with strict CSP directives allowlisting required CDNs (Monaco Editor, RemixIcon, GSAP, Socket.io, Google Fonts).
- `frame-ancestors: 'none'` strictly blocks clickjacking and framing attacks.
- `app.disable('x-powered-by')` removes software stack disclosure banners.

### 4. Rate Limiting & DoS Prevention
Configured via `express-rate-limit`:
- **Authentication (`/login`, `/api/login`)**: Max 5 attempts per minute per IP.
- **Code Execution (`/run`, `/runCode`)**: Max 10 runs per minute per user/IP.
- **AI Chat (`/ask-ai`)**: Max 20 requests per minute per user/IP.
- **Body Limit**: Enforces a strict 200 KB maximum payload size on JSON and URL-encoded requests.

### 5. AI Agent Security & Prompt Injection Defense
- **Interactive Action Confirmation**: When the AI agent proposes workspace modifications (creating or editing files), the actions are not auto-applied. Users must explicitly click **Apply Changes** in the UI.
- **No Auto-Execution**: AI output is never executed automatically in the sandbox.
- **Daily Request Quota**: Enforces a per-user daily quota (`DAILY_AI_LIMIT`, default 50 requests/day).
- **Payload Validation**: AI prompts are constrained to 4,000 characters and oversized inputs are rejected.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [MongoDB](https://www.mongodb.com/) (local instance or MongoDB Atlas)
- Compilers / runtimes for the languages you want to run (e.g. `python3`, `g++`, `gcc`, etc.)
- Optional: [Ollama](https://ollama.ai/) for local AI inference

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/niteshxedev-byte/codeEditor.git
   cd codeEditor
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and configure:
   - `PORT=3001`
   - `MONGO_URI=mongodb://127.0.0.1:27017/code_editor`
   - `JWT_SECRET=<cryptographically-random-string-at-least-32-chars>`
   - `SESSION_SECRET=<random-session-secret>`
   - `OLLAMA_API_KEY=<optional-cloud-ollama-api-key>`

4. Start the server:
   ```bash
   node index.js
   ```

5. Open your browser and navigate to:
   ```
   http://localhost:3001
   ```

---

## Security Documentation

For detailed findings, audit mapping, and reproduction tests, refer to:
- [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) — Comprehensive vulnerability audit report and phase-by-phase architecture analysis.
- [`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md) — Remediation matrix, concrete test commands, real command outputs, and manual operational requirements.
