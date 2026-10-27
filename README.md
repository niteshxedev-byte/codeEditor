# CodeEditor

**Personal Code Editor — Modern Web Code Editor with Monaco and AI Assistance**

A self-hosted, browser-based code editor built with Node.js/Express, Monaco Editor, Socket.IO, LangChain, MongoDB, and Docker. It combines a VS Code-like editing experience with AI assistance and local code execution.

> Repository: https://github.com/niteshxedev-byte/codeEditor

---

## Features

- **Monaco Editor** — the same editor engine used by VS Code, with syntax highlighting and a rich editing experience.
- **AI Assistance** — integrates multiple LLM providers through LangChain:
  - Google Generative AI
  - OpenAI
  - Ollama
- **Local Code Execution** — run code on the server instead of relying only on external execution services.
- **Real-time Communication** — powered by Socket.IO for live updates and streaming responses.
- **Authentication** — JWT-based auth with password hashing via bcryptjs.
- **MongoDB Storage** — Mongoose models for persistence.
- **Modern UI** — EJS templates with GSAP animations.
- **Docker Support** — run the full stack with Docker Compose.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | Monaco Editor, EJS, GSAP |
| Backend | Node.js, Express.js, Socket.IO |
| AI / LLM | LangChain, Google Generative AI, OpenAI, Ollama |
| Database | MongoDB, Mongoose |
| Auth | JWT, bcryptjs |
| DevOps | Docker, Docker Compose |

---

## Architecture

```text
Browser UI
  ├── Monaco Editor
  ├── EJS-rendered pages
  └── GSAP animations
        │
        ▼
Express.js + Socket.IO
  ├── Auth / API routes
  ├── AI service via LangChain
  ├── Local code execution service
  └── MongoDB via Mongoose
        │
        ▼
AI Providers: Google / OpenAI / Ollama
