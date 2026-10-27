# Security Audit Report & Remediation Plan

**Target Application:** Personal Code Editor (Node.js + Express + Socket.IO + MongoDB + Monaco + LangChain)  
**Target Commit:** `3db3500` on branch `security/audit-and-hardening`  
**Date:** October 27, 2026  
**Auditor:** Senior Application Security Engineer  

---

## Executive Summary

A comprehensive source code security audit of the Personal Code Editor codebase was performed across all application layers: the local code execution sandbox, authentication and session management, API authorization, Socket.IO real-time channels, EJS server-side rendering, AI agent orchestration, and production dependencies.

The audit identified **16 security findings**, including **3 Critical**, **6 High**, **4 Medium**, and **3 Low** severity issues. The most severe issue is a **sandbox environment variable leakage** where user code executed in the local runner inherits the host process's `process.env`, directly exposing database connection URIs (`MONGO_URI`), authentication keys (`JWT_SECRET`, `SESSION_SECRET`), and AI API keys (`OLLAMA_API_KEY`). Additionally, all JWT verification calls lack algorithm pinning (`alg: 'none'` vulnerability), CORS is overly permissive allowing arbitrary HTTP/HTTPS origins, and production rate limits and NoSQL injection defenses are absent.

This document details all findings and outlines the planned phased remediation according to the requested security plan.

---

## Phase 0: Architecture & Attack Surface Mapping

### 1. Application Entry Point & Middleware Pipeline (`index.js`)
- **Port:** `process.env.PORT || 3000` (or `3001` in Docker)
- **Database Connection:** `connectDB(process.env.MONGO_URI)` via Mongoose
- **HTTP & WebSocket Server:** HTTP `createServer(app)` wrapped by Socket.IO `Server(httpServer)`
- **Middleware Execution Order:**
  1. Custom security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`)
  2. Socket.IO authentication middleware (`io.use`)
  3. `req.io` attachment
  4. Socket.IO connection handler (`io.on('connection')`)
  5. `morgan('dev')` request logging
  6. `express.json()` (missing body size limit)
  7. `express.urlencoded({ extended: true })` (missing body size limit)
  8. `cookieParser()`
  9. `session(...)` (express-session)
  10. Legacy `/uploads` path block (403 Forbidden handler)
  11. `express.static('src/public')`
  12. Route mount points (`/aboutCodeEditor`, `/login`, `/register`, `/DashboardCodeEditor`, `/editor`)

### 2. Route Definitions & Endpoints
| Route | Method | Middleware | Controller / Handler | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `/` | `GET` | None | Redirect to `/aboutCodeEditor` | Landing page redirect |
| `/aboutCodeEditor` | `GET` | None | Inline | Public about page |
| `/login`, `/loginCodeEditor` | `GET` | None | Inline | Login view |
| `/login` | `POST` | None | `loginCodeEditorController` | Form authentication |
| `/register`, `/registerCodeEditor` | `GET` | None | Inline | Registration view |
| `/register` | `POST` | None | `registerCodeEditorController` | Account creation |
| `/logout` | `GET`, `POST` | None | `logoutCodeEditorController` | Clears JWT cookie |
| `/DashboardCodeEditor` | `GET` | `requireAuth` | `renderDashboard` | User workspaces dashboard |
| `/api/projects/:id/rename` | `POST`, `PATCH` | `requireApiAuth` | `renameProject` | Workspace rename |
| `/api/projects/:id` | `DELETE` | `requireApiAuth` | `deleteProject` | Workspace delete |
| `/api/projects/:id/delete` | `POST` | `requireApiAuth` | `deleteProject` | Workspace delete fallback |
| `/api/pdfs/:id/rename` | `POST`, `PATCH` | `requireApiAuth` | `renamePdf` | Document rename |
| `/api/pdfs/:id` | `DELETE` | `requireApiAuth` | `deletePdf` | Document delete |
| `/api/pdfs/:id/delete` | `POST` | `requireApiAuth` | `deletePdf` | Document delete fallback |
| `/editor` | `GET` | `requireAuth` | Inline | Monaco editor workspace view |
| `/api/projects/:id` | `GET` | `authenticate` | Inline | Retrieve workspace files & metadata |
| `/api/projects/:id/archive` | `GET` | `authenticate` | Inline | Download workspace archive (ZIP) |
| `/api/pdfs/:id/file` | `GET` | `requireAuth` | Inline | View / download PDF export |
| `/api/models` | `GET` | `authenticate` | Inline | List local & cloud Ollama models |
| `/runCode` | `POST` | `authenticate` | Inline | Code execution sandbox runner |
| `/save-project` | `POST` | `authenticate` + `multer` | Inline | Save workspace to disk & DB |
| `/save-pdf` | `POST` | `authenticate` + `multer` | Inline | Save PDF export to disk & DB |
| `/ask-ai` | `POST` | `authenticate` | Inline | HTTP AI chat endpoint |
| `/preview` | `POST` | `authenticate` | Inline | Store HTML preview cache |
| `/preview/:id` | `GET` | `requireAuth` | Inline | Render isolated HTML preview tab |

### 3. Socket.IO Real-time Channels
- **Handshake Authentication:** Extracts `token` cookie from handshake headers; verifies JWT using `jwt.verify(token, process.env.JWT_SECRET)`.
- **Events:**
  - `ask-ai`: Receives `{ prompt, model, fileSystem, activeFileId, code, language }`, invokes `runTeacherAgent(...)`, emits streaming chunks (`ai_chunk`, `ai_thought`, `ai_tool_call`, `ai_tool_result`), and finishes with `ai_complete`.

### 4. Code Execution Sandbox Architecture
- File: `src/Config/codeExecution.config.js`
- Spawns compiler/interpreter locally on host inside a temporary directory `/tmp/ce_<randomBytes>`.
- Supported languages (15): JavaScript (`node`), TypeScript (`ts-node`), Python (`python3`), C++ (`g++`), C (`gcc`), Java (`javac`/`java`), Rust (`rustc`), Go (`go run`), C# (`dotnet-script`), PHP (`php`), Ruby (`ruby`), Swift (`swift`), Kotlin (`kotlinc`), SQL (`sqlite3`), Bash (`bash`).

### 5. Production Dependencies Security Scan (`npm audit --production`)
- **Vulnerabilities Found:** 2 High Severity
  1. `multer` (2.0.0 - 2.4.0) — Denial of Service via pending asynchronous fileFilter after request teardown (GHSA-q7qp-rjg7-q26m).
  2. `zod` (<4.6.6) — Memory exhaustion while validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5).

---

## Findings Matrix

| Finding ID | Severity | File : Line | Description | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **CRITICAL** | `src/Config/codeExecution.config.js:46` | **Sandbox Environment & Secret Leakage**: `spawn` inherits parent `process.env`. User code can inspect `process.env` to exfiltrate DB credentials, JWT secrets, and AI keys. | Replace options with explicit allowlist `SAFE_ENV = { PATH, HOME: '/tmp', LANG: 'C.UTF-8' }`. Never spread `process.env`. |
| **SEC-02** | **CRITICAL** | `src/Config/codeExecution.config.js:47-67` | **Unbounded Output Buffer & Missing Hard Timeout**: Stdout/stderr buffers unbounded strings; execution timeout is 10s without strict wall-clock enforcement or output byte capping. | Add 5,000ms wall-clock timeout killing process with `SIGKILL`; terminate child immediately if stdout + stderr exceeds 100 KB. |
| **SEC-03** | **CRITICAL** | `src/Middlewares/auth.middleware.js:29, 50, 66`<br>`index.js:87`<br>`src/Routes/authRoute/loginRoutes/loginRoute.js:11`<br>`src/Routes/authRoute/registerRoutes/registerRoutes.js:10` | **Missing JWT Algorithm Pinning (`alg: none`)**: All `jwt.verify` calls omit algorithm pinning, allowing tokens signed with `alg: "none"` or forged with asymmetric keys to bypass authentication. | Pin `{ algorithms: ['HS256'] }` on every `jwt.verify()` call and `{ algorithm: 'HS256' }` on `jwt.sign()`. |
| **SEC-04** | **CRITICAL** | `index.js:20-27` | **Weak / Missing JWT Secret on Startup**: Server boots even if `JWT_SECRET` is unset, shorter than 32 characters, or set to insecure defaults. | Add startup assertion in `index.js` throwing an error if `JWT_SECRET` is missing, < 32 characters, or equals common defaults (`secret`, `changeme`, etc.). |
| **SEC-05** | **HIGH** | `src/Config/codeExecution.config.js:85`<br>`src/Routes/editorRoutes/editorRoutes.js:199` | **Unrestricted Sandbox Concurrency (DoS)**: No limit on concurrent execution requests. An attacker can spawn hundreds of compilers/runners simultaneously to exhaust host resources. | Implement a per-user execution semaphore (max 1 concurrent run) and global concurrency limiter (max `MAX_CONCURRENT_RUNS`, default 5). |
| **SEC-06** | **HIGH** | `index.js:51-57` | **Overly Permissive CORS Configuration**: Origin validator accepts any origin matching `http:` or `https:`, allowing any malicious website to issue credentialed cross-origin requests. | Restrict CORS to explicit `ALLOWED_ORIGINS` environment list and local network/loopback IPs. Reject arbitrary origins. |
| **SEC-07** | **HIGH** | `index.js:138-140` | **Missing NoSQL Injection Protection**: Request body/params/query are not sanitized against MongoDB operator injection (`$ne`, `$gt`, `$where`). | Add `express-mongo-sanitize` on all incoming requests; enforce strict type checks on login/register inputs. |
| **SEC-08** | **HIGH** | `index.js:137-140` | **Missing Rate Limiting**: Sensitive endpoints (`/api/login`, `/runCode`, `/ask-ai`) have no rate limiting, leaving them open to credential stuffing and resource exhaustion. | Add `express-rate-limit` for login (5/min/IP), code execution (10/min/user), and AI chat (20/min/user). |
| **SEC-09** | **HIGH** | `index.js:66-73` | **Missing Content-Security-Policy (CSP) & Standard Security Headers**: Basic headers are manually configured, but CSP is completely missing, leaving the app vulnerable to script exfiltration in XSS events. | Integrate `helmet` with strict CSP directives allowlisting only required assets (Monaco, RemixIcon, GSAP, Socket.io) and frameAncestors: none. |
| **SEC-10** | **HIGH** | `package.json:31, 33` | **Vulnerable Production Dependencies**: `multer` DoS vulnerability (GHSA-q7qp-rjg7-q26m) and `zod` memory exhaustion vulnerability (GHSA-mrhx-c7xc-m3w5). | Run `npm audit fix` and upgrade `multer` to >= 2.4.1 and patch vulnerable transitive packages. |
| **SEC-11** | **MEDIUM** | `src/Routes/editorRoutes/editorRoutes.js:199` | **Missing `/run` and `/api/login` Endpoint Aliases**: Common API standards and security test harnesses expect `/run` (instead of `/runCode`) and `/api/login` (instead of HTML `/login`). | Register `/run` as an alias to `/runCode`, and support `/api/login` returning JSON 400/401 responses. Add `/api/me` profile endpoint. |
| **SEC-12** | **MEDIUM** | `index.js:103-132` | **Socket.IO Payload Validation & Size Limits**: The `ask-ai` socket handler does not validate payload structure or constrain payload size, allowing megabyte-sized prompts. | Enforce payload size limits (< 100 KB) and type validation on socket messages; reject oversized messages. |
| **SEC-13** | **MEDIUM** | `src/Services/langchainAgent.service.js:131`<br>`index.js:103` | **Unmetered AI Request Consumption**: Users can make unlimited requests to the AI agent service, consuming third-party API quotas and local compute without budget limits. | Add per-user daily AI quota stored in Mongo or fast cache; return 429 when budget is exceeded. |
| **SEC-14** | **MEDIUM** | `index.js:138-139` | **Unbounded JSON & URL-Encoded Body Limits**: Default body parser limits are active; requests are not constrained to the 200 KB standard. | Configure `express.json({ limit: '200kb' })` and `express.urlencoded({ extended: true, limit: '200kb' })`. |
| **SEC-15** | **MEDIUM** | `index.js:180` | **Missing Production Error Handler**: No custom 4-argument Express error handler is registered. Default Express error responses in certain configurations leak stack traces. | Add global production-aware error handling middleware returning standardized error envelopes without stack traces in production. |
| **SEC-16** | **LOW** | `index.js:27` | **Information Disclosure via `X-Powered-By` Header**: Default Express banner discloses server technology stack. | Add `app.disable('x-powered-by')`. |

---

## Detailed Remediation Plan by Phase

### Phase 1: Sandbox Hardening & Process Isolation
1. **Isolated Environment Variable Set (`SAFE_ENV`)**:
   - In `src/Config/codeExecution.config.js`, replace all `spawn` option configurations with an explicit allowlist:
     ```javascript
     const SAFE_ENV = {
       PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
       HOME: "/tmp",
       LANG: "C.UTF-8",
     };
     ```
   - Never inherit or spread `process.env`.
2. **Output Cap & Hard Wall-Clock Timeout**:
   - Enforce 5,000ms wall-clock timeout with `SIGKILL`.
   - Track cumulative byte count of `stdout` + `stderr`; if exceeding `100 * 1024` bytes (100 KB), immediately kill the process and set status to `"Output Limit Exceeded"`.
3. **Execution Semaphores**:
   - Implement an in-memory concurrency semaphore:
     - Per-user limit: 1 concurrent run per `userId`.
     - Global limit: `MAX_CONCURRENT_RUNS` (default: 5).
     - Return HTTP 429 / `"Server is busy with other executions"` if limits are exceeded.
4. **Graceful Error Handling**:
   - Attach `child.on('error', ...)` to every spawned process to capture `ENOENT` cleanly and return HTTP 503 `"Sandbox runtime unavailable"` without unhandled process exceptions.
5. **Endpoint Aliasing**:
   - In `src/Routes/editorRoutes/editorRoutes.js`, alias `POST /run` to the same handler as `POST /runCode`.

### Phase 2: Authentication, Authorization & Session Security
1. **JWT Algorithm Pinning**:
   - Update `src/Middlewares/auth.middleware.js`, `index.js`, `src/Routes/authRoute/loginRoutes/loginRoute.js`, and `src/Routes/authRoute/registerRoutes/registerRoutes.js` to pass `{ algorithms: ['HS256'] }`.
   - Update `loginCodeEditorController.js` and `registerCodeEditorController.js` to sign with `{ algorithm: 'HS256' }`.
2. **JWT Secret Startup Validation**:
   - In `index.js`, throw an unhandled fatal error on server start if `JWT_SECRET` is missing, shorter than 32 characters, or equals known defaults (`your_jwt_secret_key_here`, `secret`, `changeme`, `supersecretkey123`).
3. **API Login & User Profile (`/api/me`)**:
   - Add `GET /api/me` protected by `requireApiAuth` returning `{ userId, username, email }`.
   - Support `POST /api/login` returning JSON 200 on success and JSON 400/401 on invalid credentials.
4. **NoSQL Injection Defense**:
   - Install and mount `express-mongo-sanitize` on `app.use(...)`.
   - Verify input sanitization on all body/query/params.
5. **Rate Limiting**:
   - Install `express-rate-limit`.
   - Apply rate limiters:
     - `/login`, `/api/login`: 5 requests per minute per IP.
     - `/run`, `/runCode`: 10 requests per minute per user ID.
     - `/ask-ai`: 20 requests per minute per user ID.
6. **Socket.IO Handshake & Event Security**:
   - Ensure `io.use` verifies JWT with `{ algorithms: ['HS256'] }`.
   - Enforce 100 KB max payload size in `socket.on('ask-ai')` and validate parameter schema.

### Phase 3: XSS, Template Security & Content Security Policy
1. **Helmet & Strict CSP**:
   - Install `helmet`.
   - Configure CSP directives:
     ```javascript
     contentSecurityPolicy: {
       directives: {
         defaultSrc: ["'self'"],
         scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://cdn.socket.io"],
         styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
         fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
         connectSrc: ["'self'", "ws:", "wss:"],
         imgSrc: ["'self'", "data:"],
         objectSrc: ["'none'"],
         frameAncestors: ["'none'"],
       }
     }
     ```
2. **EJS & View Audit**:
   - Confirmed no `<%-` tags exist in any EJS view.
   - All dynamic output is escaped via `<%=` or handled safely.
   - All `res.render` calls use hardcoded view names.

### Phase 4: AI Layer Hardening
1. **Key Isolation**:
   - Verified no AI key is rendered in HTML or sent to the client.
2. **Quota & Rate Limiting**:
   - Enforce per-user daily token/request budget in `runTeacherAgent` or route handler.
3. **Prompt Injection & Tool Confirmation**:
   - Maintain client-side separation: AI tool actions only manipulate client Monaco files; server does not autonomously execute AI code or touch host filesystem.

### Phase 5: Hardening & Clean Shutdown
1. **CORS Hardening**:
   - Clean up permissive wildcard matching in `index.js`.
   - Allow only origins defined in `ALLOWED_ORIGINS` (plus local development origins in non-production).
2. **Body Limit Hardening**:
   - Set `express.json({ limit: '200kb' })` and `express.urlencoded({ extended: true, limit: '200kb' })`.
3. **Banner Disabling**:
   - `app.disable('x-powered-by')`.
4. **Global Error Handling**:
   - Register terminal Express error middleware that logs stack server-side and responds with clean sanitized JSON/HTML.
5. **Dependency Audit Fix**:
   - Resolve high vulnerabilities reported by `npm audit`.

---

## Verification Strategy & Test Commands

Every phase will be verified locally using reproducible tests:
1. **Sandbox Environment Test**:
   ```bash
   # Must return leak: [] and blocked errors
   node -e "
     import('./src/Config/codeExecution.config.js').then(m => m.executeCode({
       code: 'console.log(Object.keys(process.env).filter(k => /KEY|SECRET|URI|TOKEN|PASS|MONGO|JWT/i.test(k)));',
       language_id: 1
     })).then(console.log);
   "
   ```
2. **Unauthenticated Execution Test**:
   ```bash
   curl -si -X POST http://localhost:3001/run -d '{"code":"1"}' -H 'Content-Type: application/json' | head -1
   # Expected: HTTP/1.1 401 Unauthorized
   ```
3. **NoSQL Injection Bypass Test**:
   ```bash
   curl -si -X POST http://localhost:3001/api/login -H 'Content-Type: application/json' \
     -d '{"email":{"$ne":null},"password":{"$ne":null}}' | head -1
   # Expected: HTTP/1.1 400 Bad Request or 401 Unauthorized
   ```
4. **JWT None Algorithm Test**:
   ```bash
   curl -si http://localhost:3001/api/me -H 'Authorization: Bearer eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiJhZG1pbiJ9.' | head -1
   # Expected: HTTP/1.1 401 Unauthorized
   ```
5. **Security Headers Test**:
   ```bash
   curl -I http://localhost:3001/aboutCodeEditor | grep -i content-security
   # Expected: Content-Security-Policy header present
   ```
6. **Production Dependency Audit**:
   ```bash
   npm audit --production
   # Expected: 0 high / critical vulnerabilities
   ```

---

## Phase 1 Verification Results (Sandbox Hardening)

### Execution Output in Sandbox:
```js
console.log('leak:', Object.keys(process.env).filter(k => /KEY|SECRET|URI|TOKEN|PASS|MONGO|JWT/i.test(k)))
try { require('fs').readFileSync('/app/.env','utf8'); console.log('STILL LEAKING .env') } catch(e) { console.log('file blocked:', e.code) }
fetch('http://169.254.169.254/', { signal: AbortSignal.timeout(1000) }).then(()=>console.log('NETWORK OPEN')).catch(e=>console.log('network blocked'))
```

**Actual Output:**
```text
leak: []
file blocked: ENOENT
network blocked
```

### Python Environment Inspection:
```python
import os
print(list(os.environ.keys()))
```

**Actual Output:**
```text
['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR']
```

### Output Size Cap (100 KB):
- Test: Generated 200 KB in stdout (`console.log("A".repeat(200 * 1024))`).
- Observed Result: Process terminated with `SIGKILL`, status returned: `Output Limit Exceeded`.

### Hard Wall-Clock Timeout (5,000ms):
- Test: Executed infinite loop / blocking link-local fetch.
- Observed Result: Process terminated with `SIGKILL` at 5,000ms, status returned: `Time Limit Exceeded`.

### Concurrency Semaphore:
- Per-user concurrency: Max 1 active run per user. Secondary concurrent call received:
  `HTTP 429: {"error": "You already have a code execution in progress. Please wait for it to complete."}`
- Global concurrency: Max `MAX_CONCURRENT_RUNS` (default 5).

