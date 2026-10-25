/**
 * editor_actions.js
 * Modular editor toolbar interactions, code execution, Prettier formatting,
 * Teacher Agent streaming, and MongoDB / PDF workspace exports.
 */

(function () {
  "use strict";

  // Clean ?prompt= from address bar so reloads stay on clean /editor
  if (window.location.search && window.location.search.includes("prompt=")) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const select = document.getElementById("language");
  const terminal_screen = document.getElementById("terminal-screen");
  const terminal_actions = document.querySelector("#COADING_LANGUAGE");
  let selectedId = select && select.value ? Number(select.value) : 63;
  let selectedName = select && select.selectedIndex >= 0 && select.options[select.selectedIndex].text ? select.options[select.selectedIndex].text : "JavaScript (Node.js)";

  if (select && terminal_actions && select.selectedIndex >= 0 && select.options[select.selectedIndex].text) {
    terminal_actions.innerHTML = `<i class="ri-terminal-line"></i> ${select.options[select.selectedIndex].text.toUpperCase()}`;
  }

  function getMonacoLanguage(judgeId) {
    const id = Number(judgeId);
    if ([63, 93, 97, 102].includes(id)) return "javascript";
    if ([74, 94, 101].includes(id)) return "typescript";
    if ([70, 71, 92, 100, 109, 113].includes(id)) return "python";
    if ([104, 110, 75, 103, 48, 49, 50].includes(id)) return "c";
    if ([76, 105, 52, 53, 54].includes(id)) return "cpp";
    if ([51].includes(id)) return "csharp";
    if ([91, 62, 96].includes(id)) return "java";
    if ([68, 98].includes(id)) return "php";
    if ([72].includes(id)) return "ruby";
    if ([83].includes(id)) return "swift";
    if ([73, 108].includes(id)) return "rust";
    if ([78, 111].includes(id)) return "kotlin";
    if ([60, 95, 106, 107].includes(id)) return "go";
    if ([82].includes(id)) return "sql";
    if ([46].includes(id)) return "shell";
    return "plaintext";
  }

  if (select) {
    select.addEventListener("change", () => {
      if (!select.value) return;
      selectedId = Number(select.value);
      selectedName = select.options[select.selectedIndex].text;

      if (terminal_actions) {
        terminal_actions.innerHTML = `<i class="ri-terminal-line"></i> ${selectedName.toUpperCase()}`;
      }

      const monacoLang = getMonacoLanguage(selectedId);
      if (window.editor && window.monaco) {
        monaco.editor.setModelLanguage(window.editor.getModel(), monacoLang);
      }
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function runCode() {
    try {
      if (!window.editor) {
        if (terminal_screen) terminal_screen.innerHTML = `<div class="terminal-line terminal-error">Editor is initializing...</div>`;
        return;
      }

      const code = window.editor.getValue();

      if (!selectedId) {
        if (terminal_screen) terminal_screen.innerHTML = `<div class="terminal-line terminal-error">Please select a language first.</div>`;
        return;
      }

      if (terminal_screen) terminal_screen.innerHTML = `<div class="terminal-line terminal-dim">> Running in Judge0 container...</div>`;

      const res = await fetch("/runCode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language_id: selectedId.toString() }),
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const rawText = await res.text();
        if (terminal_screen) terminal_screen.innerHTML = `<div class="terminal-line terminal-error">${escapeHtml(rawText || "Server error")}</div>`;
        return;
      }

      const data = await res.json();
      const output = data.stdout || data.stderr || data.compile_output || data.message || "Executed with no output.";
      const isError = Boolean(data.stderr || data.compile_output);

      if (terminal_screen) {
        terminal_screen.innerHTML = `
          <div class="terminal-line ${isError ? "terminal-error" : "terminal-success"}">${escapeHtml(output)}</div>
          <div class="terminal-line terminal-dim" style="margin-top:6px; font-size:11px;">[Status: ${data.status || "Completed"} | Time: ${data.time || 0}s | Memory: ${data.memory || 0} KB]</div>
        `;
      }
    } catch (error) {
      if (terminal_screen) terminal_screen.innerHTML = `<div class="terminal-line terminal-error">${escapeHtml(error.message || error)}</div>`;
    }
  }

  /* ── Panel Toggles ── */
  const PANEL_IDS = {
    explorer: "file-explorer",
    assistant: "console-wrapper",
    terminal: "vscode-terminal",
  };

  function isPanelOpen(name) {
    const el = document.getElementById(PANEL_IDS[name]);
    return !!el && !el.classList.contains("pce-hidden");
  }

  function setPanel(name, open) {
    const el = document.getElementById(PANEL_IDS[name]);
    if (!el) return;
    el.classList.toggle("pce-hidden", !open);
    try {
      localStorage.setItem("pce:panel:" + name, open ? "1" : "0");
    } catch (_) { }
    if (window.editor) setTimeout(() => window.editor.layout(), 0);
  }

  function togglePanel(name) {
    setPanel(name, !isPanelOpen(name));
  }

  // Restore panel state (default explorer open on first launch for native editor experience)
  Object.keys(PANEL_IDS).forEach((name) => {
    let saved = null;
    try { saved = localStorage.getItem("pce:panel:" + name); } catch (_) { }
    if (saved === "1" || (saved === null && name === "explorer")) setPanel(name, true);
  });

  // Global keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;

    const code = e.code;
    const key = e.key;

    // Run Code: Ctrl+Enter
    if (key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      runCode();
      return;
    }

    // Format Code: Shift+Ctrl+F
    if (e.shiftKey && (code === "KeyF" || key === "F" || key === "f")) {
      e.preventDefault();
      e.stopPropagation();
      formatCode();
      return;
    }

    // Save File / Workspace: Ctrl+S (Save) and Shift+Ctrl+S (Save As)
    if (code === "KeyS" || key === "s" || key === "S") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        if (typeof window.saveWorkspaceToMongoDB === "function") {
          window.saveWorkspaceToMongoDB(true);
        }
      } else {
        const currentItem = window.fileSystem && window.fileSystem.find((f) => f.id === window.activeFileId && f.type === "file");
        if (currentItem && currentItem.fileHandle && typeof window.saveLocalFile === "function") {
          window.saveLocalFile(false);
        } else if (typeof window.saveWorkspaceToMongoDB === "function") {
          window.saveWorkspaceToMongoDB(false);
        }
      }
      return;
    }

    // Open File / Folder: Ctrl+O (File) or Shift+Ctrl+O (Folder)
    if (code === "KeyO" || key === "o" || key === "O") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        if (typeof window.importFolder === "function") window.importFolder();
      } else {
        if (typeof window.openFile === "function") window.openFile();
      }
      return;
    }

    // New File / Folder: Ctrl+N (File) or Shift+Ctrl+N (Folder)
    if (code === "KeyN" || key === "n" || key === "N") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        if (typeof window.addFolder === "function") window.addFolder();
      } else {
        if (typeof window.addFile === "function") window.addFile();
      }
      return;
    }

    let panel = null;
    if (code === "KeyB" || key === "b" || key === "B") panel = "explorer";
    else if (code === "KeyM" || key === "m" || key === "M") panel = "assistant";
    else if (code === "Backquote" || key === "`" || key === "~") panel = "terminal";

    if (panel) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel(panel);
    }
  }, true);

  function formatCode() {
    if (!window.editor || !window.prettier) return;
    const code = window.editor.getValue();
    const lang = window.editor.getModel().getLanguageId();

    let parser = "babel";
    if (lang === "javascript") parser = "babel";
    if (lang === "typescript") parser = "typescript";
    if (lang === "json") parser = "json";
    if (lang === "css") parser = "css";
    if (lang === "html") parser = "html";
    if (lang === "python") parser = "python";

    try {
      const formatted = prettier.format(code, {
        parser,
        plugins: window.prettierPlugins || [],
        tabWidth: 2,
        semi: true,
        singleQuote: true,
      });
      window.editor.setValue(formatted);
    } catch (e) {
      console.warn("Prettier format warning:", e);
    }
  }

  function clearConsole() {
    if (terminal_screen) {
      terminal_screen.innerHTML = `<div class="terminal-line terminal-dim">Console cleared.</div>`;
    }
  }

  function updateFontSize() {
    const sizeInput = document.getElementById("fontSize");
    if (sizeInput && window.editor) {
      window.editor.updateOptions({ fontSize: parseInt(sizeInput.value, 10) });
    }
  }

  window.addEventListener("load", () => {
    const interval = setInterval(() => {
      if (window.editor && window.monaco) {
        clearInterval(interval);
        window.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
          runCode();
        });
        window.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
          formatCode();
        });
        window.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          const currentItem = window.fileSystem && window.fileSystem.find((f) => f.id === window.activeFileId && f.type === "file");
          if (currentItem && currentItem.fileHandle && typeof window.saveLocalFile === "function") {
            window.saveLocalFile(false);
          } else if (typeof window.saveWorkspaceToMongoDB === "function") {
            window.saveWorkspaceToMongoDB(false);
          }
        });
        window.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => {
          if (typeof window.saveWorkspaceToMongoDB === "function") {
            window.saveWorkspaceToMongoDB(true);
          }
        });
        window.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO, () => {
          if (typeof window.openFile === "function") window.openFile();
        });
        window.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO, () => {
          if (typeof window.importFolder === "function") window.importFolder();
        });
        window.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, () => {
          if (typeof window.addFile === "function") window.addFile();
        });
        window.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyN, () => {
          if (typeof window.addFolder === "function") window.addFolder();
        });
        window.editor.onDidChangeModelContent(() => {
          window.hasUnsavedChanges = true;
        });
      }
    }, 100);
  });

  window.addEventListener("beforeunload", (e) => {
    if (window.hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = "You have unsaved changes in your workspace. Are you sure you want to leave without saving to MongoDB?";
    }
  });

  async function handleSendPrompt(e) {
    if (e && e.preventDefault) e.preventDefault();
    const input = document.getElementById("console-input");
    const msg = input.value.trim();
    if (!msg) return;

    const consoleOutput = document.getElementById("console-output");

    const userBubble = document.createElement("div");
    userBubble.style.cssText = "background: #18181b; border: 1px solid #27272a; padding: 8px 10px; border-radius: 4px; font-size: 12.5px; align-self: flex-end; color: #fff; max-width: 90%;";
    userBubble.textContent = msg;
    consoleOutput.appendChild(userBubble);
    input.value = "";
    consoleOutput.scrollTop = consoleOutput.scrollHeight;

    const agentBubble = document.createElement("div");
    agentBubble.className = "chat-bubble-agent";
    agentBubble.innerHTML = `<strong>Agent:</strong><p style="margin-top:4px; color:#a1a1aa;">Thinking...</p>`;
    consoleOutput.appendChild(agentBubble);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;

    try {
      const selectedModel = document.getElementById("ai-model-select") ? document.getElementById("ai-model-select").value : "llama3.2:1b";
      const code = window.editor ? window.editor.getValue() : "";
      const currentFs = typeof fileSystem !== 'undefined' ? fileSystem : [];
      const currentActiveId = typeof activeFileId !== 'undefined' ? activeFileId : null;
      const currentLang = (select && select.selectedIndex >= 0 && select.options[select.selectedIndex].text)
        ? select.options[select.selectedIndex].text
        : selectedName;

      let useSocket = false;
      try {
        if (typeof io !== "undefined") {
          if (!window.socket) {
            window.socket = io();
          }
          useSocket = !!window.socket;
        }
      } catch (e) {
        console.warn("Socket init failed, falling back to HTTP:", e);
      }

      let responseText = "";
      let workspaceBadgeHtml = "";
      const createdFolders = [];
      const createdFiles = [];
      let firstCreatedFileId = null;

      agentBubble.innerHTML = `<strong>Teacher Agent:</strong><div class="agent-response-body" style="margin-top:4px; color:#d4d4d8; font-size:12px; line-height:1.5;"></div>`;
      const responseBody = agentBubble.querySelector('.agent-response-body');

      const updateBubble = () => {
        const formattedReply = escapeHtml(responseText)
          .replace(/```([\s\S]*?)```/g, '<pre style="background:#000; padding:6px; border:1px solid #1F1F1F; border-radius:3px; font-family:monospace; margin-top:4px;"><code>$1</code></pre>')
          .replace(/\n/g, '<br/>');

        responseBody.innerHTML = formattedReply + workspaceBadgeHtml;
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
      };

      const handleActions = (actions) => {
        if (actions && Array.isArray(actions) && actions.length > 0) {
          actions.forEach(action => {
            if (action.type === 'create_folder' && window.agentActions) {
              window.agentActions.createFolder(action.name, action.parentFolder);
              if (!createdFolders.includes(action.name)) createdFolders.push(action.name);
            } else if (action.type === 'create_file' && window.agentActions) {
              const fId = window.agentActions.createFile(action.name, action.content, action.folderName);
              if (!firstCreatedFileId && fId) firstCreatedFileId = fId;
              if (!createdFiles.includes(action.name)) createdFiles.push(action.name);
            } else if (action.type === 'write_code' && window.agentActions) {
              window.agentActions.writeCode(action.name, action.content);
              if (!createdFiles.includes(action.name)) createdFiles.push(action.name);
            }
          });

          if (firstCreatedFileId && typeof switchToFile === 'function') {
            switchToFile(firstCreatedFileId);
          }

          if (createdFolders.length > 0 || createdFiles.length > 0) {
            workspaceBadgeHtml = `
              <div style="margin-top:8px; padding:7px 10px; background:#08080a; border:1px solid #1F1F1F; border-radius:4px; font-family:'JetBrains Mono', monospace; font-size:11px;">
                <div style="color:#2563eb; font-weight:600; display:flex; align-items:center; gap:6px;">
                  <i class="ri-folder-add-line"></i>
                  <span>Workspace Files Created:</span>
                </div>
                <div style="margin-top:3px; color:#9ca3af; font-size:10.5px; line-height:1.4;">
                  ${createdFolders.length > 0 ? `<div>📁 Folder: <span style="color:#e4e4e7;">${createdFolders.join(', ')}</span></div>` : ''}
                  ${createdFiles.length > 0 ? `<div>📄 Files (${createdFiles.length}): <span style="color:#60a5fa;">${createdFiles.join(', ')}</span></div>` : ''}
                </div>
              </div>
            `;
          }
        }
      };

      if (useSocket && window.socket) {
        const TIMEOUT_MS = 180_000;
        let timeoutHandle = null;
        let heartbeatHandle = null;
        const startedAt = Date.now();

        const sendBtn = document.querySelector(".submit-btn");
        const promptInput = document.getElementById("console-input");
        if (sendBtn) sendBtn.disabled = true;
        if (promptInput) promptInput.disabled = true;

        function onChunk(chunk) {
          responseText += chunk;
          updateBubble();
        }
        function onThought(thought) {
          responseText += `\n> *(${escapeHtml(thought)})*\n`;
          updateBubble();
        }
        function onToolCall(toolCall) {
          responseText += `\n> *(Calling tool ${escapeHtml(toolCall.name)}…)*\n`;
          updateBubble();
        }
        function cleanup() {
          clearTimeout(timeoutHandle);
          clearInterval(heartbeatHandle);
          window.socket.off("ai_chunk", onChunk);
          window.socket.off("ai_thought", onThought);
          window.socket.off("ai_tool_call", onToolCall);
          window.socket.off("ai_error", onError);
          window.socket.off("ai_complete", onComplete);
          if (sendBtn) sendBtn.disabled = false;
          if (promptInput) promptInput.disabled = false;
        }
        function onError(error) {
          cleanup();
          agentBubble.innerHTML = `<strong>Agent Error:</strong><p style="margin-top:4px; color:#ef4444;">${escapeHtml(error.message)}</p>`;
        }
        function onComplete(data) {
          cleanup();
          handleActions(data.actions);
          if (!responseText) responseText = data.response || "Task completed.";
          updateBubble();
        }

        window.socket.on("ai_chunk", onChunk);
        window.socket.on("ai_thought", onThought);
        window.socket.on("ai_tool_call", onToolCall);
        window.socket.on("ai_error", onError);
        window.socket.on("ai_complete", onComplete);

        heartbeatHandle = setInterval(() => {
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          const dots = ".".repeat((Math.floor(elapsed / 3) % 3) + 1);
          const statusLine = responseText
            ? ""
            : `<em style="color:#6b7280; font-size:11px;">⏳ Working${dots} (${elapsed}s)</em>`;
          if (statusLine && responseBody) responseBody.innerHTML = statusLine;
        }, 15_000);

        timeoutHandle = setTimeout(() => {
          cleanup();
          const elapsed = Math.round(TIMEOUT_MS / 1000);
          agentBubble.innerHTML = `
              <strong>Teacher Agent:</strong>
              <p style="margin-top:4px; color:#f59e0b;">
                ⏱ No response after ${elapsed}s. The model is too slow for this task.
                ${responseText ? '<br/><br/><em>Partial output:</em><br/>' + escapeHtml(responseText) : ''}
                <br/><br/>Switch to a faster model — e.g. <code>llama3.2:1b</code> or <code>qwen2.5:3b</code>.
              </p>`;
        }, TIMEOUT_MS);

        window.socket.emit("ask-ai", {
          prompt: msg,
          model: selectedModel,
          fileSystem: currentFs,
          activeFileId: currentActiveId,
          code,
          language: currentLang
        });

      } else {
        const sendBtn = document.querySelector(".submit-btn");
        const promptInput = document.getElementById("console-input");
        if (sendBtn) sendBtn.disabled = true;
        if (promptInput) promptInput.disabled = true;

        try {
          responseBody.innerHTML = `<em>Thinking…</em>`;
          const controller = new AbortController();
          const httpTimeout = setTimeout(() => controller.abort(), 90_000);

          const res = await fetch("/ask-ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              prompt: msg,
              model: selectedModel,
              fileSystem: currentFs,
              activeFileId: currentActiveId,
              code,
              language: currentLang
            })
          });
          clearTimeout(httpTimeout);

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.response || `Server returned status ${res.status}`);
          }

          handleActions(data.actions);
          responseText = data.response || "Done.";
          updateBubble();
        } catch (fetchErr) {
          const msg2 = fetchErr.name === "AbortError"
            ? "Request timed out after 90s. Try a smaller model."
            : fetchErr.message;
          agentBubble.innerHTML = `<strong>Agent Error:</strong><p style="margin-top:4px; color:#ef4444;">${escapeHtml(msg2)}</p>`;
        } finally {
          if (sendBtn) sendBtn.disabled = false;
          if (promptInput) promptInput.disabled = false;
        }
      }

    } catch (err) {
      agentBubble.innerHTML = `<strong>Agent Error:</strong><p style="margin-top:4px; color:#ef4444;">${escapeHtml(err.message)}</p>`;
    }

    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  const promptForm = document.getElementById("prompt");
  if (promptForm) {
    promptForm.addEventListener("submit", handleSendPrompt);
  }

  async function refreshModels() {
    const selectEl = document.getElementById("ai-model-select");
    if (!selectEl) return;

    const prevVal = selectEl.value;

    try {
      const res = await fetch("/api/models");
      const data = await res.json();
      if (data.models && Array.isArray(data.models) && data.models.length > 0) {
        selectEl.innerHTML = "";
        data.models.forEach(m => {
          const opt = document.createElement("option");
          opt.value = m.id;
          opt.textContent = m.name || m.id;
          if (m.id === prevVal) opt.selected = true;
          selectEl.appendChild(opt);
        });
        if (!selectEl.value && selectEl.options.length > 0) {
          selectEl.selectedIndex = 0;
        }
      }
    } catch (err) {
      console.warn("Failed to refresh models:", err);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    refreshModels();
  });

  async function saveWorkspaceToMongoDB(saveAs = false) {
    if (!window.editor) {
      if (window.ideDialog) window.ideDialog.toast("Editor is not ready yet.", "warning");
      return;
    }

    const fs = window.fileSystem || (typeof fileSystem !== "undefined" ? fileSystem : []);
    const activeId = window.activeFileId || (typeof activeFileId !== "undefined" ? activeFileId : null);

    // Synchronize active Monaco editor buffer to fileSystem item
    if (window.editor && fs && activeId) {
      const activeItem = fs.find((f) => f.id === activeId && f.type === "file");
      if (activeItem) {
        activeItem.content = window.editor.getValue();
      }
    }

    let projectName = window.currentProjectName || "";
    let projectDesc = "";
    const isNewProject = !window.currentProjectId || saveAs;

    // Prompt for workspace name if saving for the first time or performing Save As
    if (isNewProject) {
      const defaultName = projectName || (document.querySelector(".workspace-badge")?.textContent || "").replace(/^Personal Code Editor\s*[-–—:]\s*/i, "").trim() || "my-workspace";

      const formResult = await window.ideDialog.promptForm({
        title: saveAs ? "Save Workspace As" : "Save Workspace to Database",
        icon: "ri-cloud-upload-line",
        subtitle: "Save your active project files, folders, and code to MongoDB.",
        fields: [
          {
            name: "projectName",
            label: "Workspace Name",
            placeholder: "e.g. react-portfolio, node-api",
            defaultValue: defaultName,
            required: true,
          },
          {
            name: "projectDesc",
            label: "Description",
            placeholder: "Brief description of this project workspace",
          },
        ],
        submitText: saveAs ? "Save As New Workspace" : "Save Workspace",
        validate: (vals) => {
          const trimmed = (vals.projectName || "").trim();
          if (!trimmed) return "Workspace name is required.";
          if (/[\\/:*?"<>|]/.test(trimmed)) return 'Name cannot contain: \\ / : * ? " < > |';
          return null;
        },
      });

      if (!formResult || !formResult.projectName) return;
      projectName = formResult.projectName.trim();
      projectDesc = (formResult.projectDesc || "").trim();
    }

    if (terminal_screen) {
      terminal_screen.innerHTML = `<div class="terminal-line terminal-dim">> Saving workspace "${escapeHtml(projectName)}" to MongoDB...</div>`;
    }

    if (typeof JSZip === "undefined") {
      if (window.ideDialog) window.ideDialog.toast("JSZip library is still loading...", "warning");
      return;
    }

    const zip = new JSZip();
    const addToZip = (parentId, currentFolder) => {
      const items = fs.filter((f) => f.parentId === parentId);
      items.forEach((item) => {
        if (item.type === "folder") {
          const newFolder = currentFolder.folder(item.name);
          addToZip(item.id, newFolder);
        } else {
          let fileContent = "";
          if (window.editor && item.id === (window.activeFileId || activeId)) {
            fileContent = window.editor.getValue();
          } else if (window.models && window.models[item.id]) {
            fileContent = window.models[item.id].getValue();
          } else {
            fileContent = item.content || "";
          }

          // Preserve binary images properly
          if (typeof fileContent === "string" && fileContent.startsWith("data:image/") && fileContent.includes(";base64,")) {
            const base64Data = fileContent.split(",")[1];
            currentFolder.file(item.name, base64Data, { base64: true });
          } else {
            currentFolder.file(item.name, fileContent);
          }
        }
      });
    };

    if (fs && fs.length > 0) {
      addToZip("root", zip);
    } else {
      const code = window.editor.getValue();
      zip.file("main.js", code);
    }

    try {
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const formData = new FormData();
      if (!isNewProject && window.currentProjectId) {
        formData.append("projectId", window.currentProjectId);
      }
      formData.append("projectName", projectName);
      formData.append("projectDescription", projectDesc || "Code Editor Workspace");
      formData.append("projectProgrammingLanguage", selectedName);
      formData.append("projectFile", zipBlob, projectName + ".zip");

      const res = await fetch("/save-project", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.success && data.project) {
        window.currentProjectId = data.project._id;
        window.currentProjectName = data.project.projectName;
        window.currentProjectUrl = `/api/projects/${data.project._id}/archive`;
        window.hasUnsavedChanges = false;

        // Update URL query parameters seamlessly
        const newUrl = `/editor?projectId=${data.project._id}&name=${encodeURIComponent(data.project.projectName)}`;
        window.history.replaceState({ projectId: data.project._id }, document.title, newUrl);

        // Update workspace name badge and document title
        const badge = document.querySelector(".workspace-badge");
        if (badge) badge.textContent = data.project.projectName;
        document.title = `${data.project.projectName} — Personal Code Editor`;

        if (terminal_screen) {
          terminal_screen.innerHTML += `<div class="terminal-line terminal-success">Workspace saved successfully! Check Dashboard.</div>`;
        }
        if (window.ideDialog) {
          window.ideDialog.toast(`Workspace "${projectName}" saved to database!`, "success");
        }
      } else {
        const errMsg = data.error || "Unknown error";
        if (terminal_screen) {
          terminal_screen.innerHTML += `<div class="terminal-line terminal-error">Error saving: ${escapeHtml(errMsg)}</div>`;
        }
        if (window.ideDialog) window.ideDialog.toast(`Failed to save: ${errMsg}`, "error");
      }
    } catch (err) {
      if (terminal_screen) {
        terminal_screen.innerHTML += `<div class="terminal-line terminal-error">Error: ${escapeHtml(err.message)}</div>`;
      }
      if (window.ideDialog) window.ideDialog.toast(`Error: ${err.message}`, "error");
    }
  }

  async function exportToPDF() {
    if (!window.editor) {
      if (window.ideDialog) window.ideDialog.toast("Editor is not ready yet.", "warning");
      return;
    }

    const fs = window.fileSystem || (typeof fileSystem !== "undefined" ? fileSystem : []);
    const activeId = window.activeFileId || (typeof activeFileId !== "undefined" ? activeFileId : null);
    const activeItem = fs.find((f) => f.id === activeId && f.type === "file");
    const defaultPdfName = activeItem
      ? activeItem.name.replace(/\.[^/.]+$/, "")
      : "Document";

    const pdfNameInput = await window.ideDialog.promptInput({
      title: "Export Code as PDF",
      icon: "ri-file-pdf-line",
      subtitle: "Generate and save a formatted PDF document of your current code.",
      label: "Document Name",
      placeholder: "e.g. AlgorithmNotes, CodeDocs",
      defaultValue: defaultPdfName,
      submitText: "Generate PDF",
      validate: (val) => {
        const trimmed = (val || "").trim();
        if (!trimmed) return "Document name is required.";
        return null;
      },
    });

    if (!pdfNameInput) return;
    const pdfName = pdfNameInput.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50) || "document";

    if (terminal_screen) terminal_screen.innerHTML = `<div class="terminal-line terminal-dim">> Generating PDF and uploading...</div>`;

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      doc.setFont("courier");
      doc.setFontSize(10);

      const code = window.editor.getValue();
      const splitText = doc.splitTextToSize(code, 180);
      doc.text(splitText, 10, 10);

      const pdfBlob = doc.output("blob");

      const formData = new FormData();
      formData.append("pdfName", pdfName);
      formData.append("pdfFile", pdfBlob, pdfName + ".pdf");

      const res = await fetch("/save-pdf", {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      if (data.success) {
        if (terminal_screen) terminal_screen.innerHTML += `<div class="terminal-line terminal-success">PDF saved to Dashboard!</div>`;
        if (window.ideDialog) window.ideDialog.toast(`PDF "${pdfName}.pdf" generated and saved!`, "success");
        doc.save(pdfName + ".pdf");
      } else {
        const errMsg = data.error || "Unknown error";
        if (terminal_screen) terminal_screen.innerHTML += `<div class="terminal-line terminal-error">Error saving PDF: ${escapeHtml(errMsg)}</div>`;
        if (window.ideDialog) window.ideDialog.toast(`Failed to save PDF: ${errMsg}`, "error");
      }
    } catch (err) {
      if (terminal_screen) terminal_screen.innerHTML += `<div class="terminal-line terminal-error">Error: ${escapeHtml(err.message)}</div>`;
      if (window.ideDialog) window.ideDialog.toast(`Error generating PDF: ${err.message}`, "error");
    }
  }

  async function openHtmlPreview() {
    const btn = document.getElementById("btn-preview");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ri-loader-4-line"></i> Loading…'; }

    try {
      function findFile(ext) {
        return typeof fileSystem !== "undefined"
          ? fileSystem.find(f => f.type === "file" && f.name.toLowerCase().endsWith(ext))
          : null;
      }

      const activeFile = typeof fileSystem !== "undefined"
        ? fileSystem.find(f => f.id === activeFileId && f.type === "file")
        : null;
      const activeExt = activeFile ? activeFile.name.split(".").pop().toLowerCase() : "";

      let html = "", css = "", js = "";

      if (activeExt === "html" || activeExt === "htm") {
        html = window.editor ? window.editor.getValue() : (activeFile?.content || "");
        const cssFile = findFile(".css");
        const jsFile = findFile(".js");
        if (cssFile) css = cssFile.content || "";
        if (jsFile) js = jsFile.content || "";
      } else if (activeExt === "css") {
        css = window.editor ? window.editor.getValue() : (activeFile?.content || "");
        const htmlFile = findFile(".html") || findFile(".htm");
        const jsFile = findFile(".js");
        if (htmlFile) html = htmlFile.content || "";
        if (jsFile) js = jsFile.content || "";
      } else if (activeExt === "js") {
        js = window.editor ? window.editor.getValue() : (activeFile?.content || "");
        const htmlFile = findFile(".html") || findFile(".htm");
        const cssFile = findFile(".css");
        if (htmlFile) html = htmlFile.content || "";
        if (cssFile) css = cssFile.content || "";
      } else {
        html = `<pre style="font-family:monospace;padding:1rem">${escapeHtml(window.editor ? window.editor.getValue() : "")}</pre>`;
      }

      if (!html && !css && !js) {
        if (window.ideDialog) {
          window.ideDialog.toast("Nothing to preview — open an HTML, CSS, or JS file first.", "warning");
        }
        return;
      }

      // Resolve workspace images (SVG, Data URLs, local assets) in HTML and CSS
      if (typeof fileSystem !== "undefined" && Array.isArray(fileSystem)) {
        fileSystem.forEach((f) => {
          if (f.type !== "file" || !f.name || !f.content) return;
          const ext = f.name.split(".").pop().toLowerCase();
          let dataUri = null;
          if (ext === "svg" && (f.content.includes("<svg") || f.content.includes("<?xml"))) {
            dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.content)}`;
          } else if (typeof f.content === "string" && f.content.startsWith("data:image/")) {
            dataUri = f.content;
          }

          if (dataUri) {
            const escapedName = f.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const srcRegex = new RegExp(`(src=["'])(?:\\.\\/)?${escapedName}(["'])`, "gi");
            html = html.replace(srcRegex, `$1${dataUri}$2`);
            const urlRegex = new RegExp(`(url\\(["']?)(?:\\.\\/)?${escapedName}(["']?\\))`, "gi");
            css = css.replace(urlRegex, `$1${dataUri}$2`);
          }
        });
      }

      const res = await fetch("/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, css, js }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const errMsg = err.error || res.status;
        if (window.ideDialog) {
          window.ideDialog.toast("Preview error: " + errMsg, "error");
        }
        return;
      }

      const { id } = await res.json();
      window.open("/preview/" + id, "_blank", "noopener,noreferrer");
    } catch (err) {
      if (window.ideDialog) {
        window.ideDialog.toast("Preview failed: " + err.message, "error");
      }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ri-eye-line"></i> Preview'; }
    }
  }

  // Export globally for HTML button onclick triggers
  window.runCode = runCode;
  window.formatCode = formatCode;
  window.clearConsole = clearConsole;
  window.updateFontSize = updateFontSize;
  window.togglePanel = togglePanel;
  window.setPanel = setPanel;
  window.handleSendPrompt = handleSendPrompt;
  window.refreshModels = refreshModels;
  window.saveWorkspaceToMongoDB = saveWorkspaceToMongoDB;
  window.exportToPDF = exportToPDF;
  window.openHtmlPreview = openHtmlPreview;
})();
