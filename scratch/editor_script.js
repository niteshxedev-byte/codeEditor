
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

    async function runCode() {
      try {
        if (!window.editor) {
          terminal_screen.innerHTML = `<div class="terminal-line terminal-error">Editor is initializing...</div>`;
          return;
        }

        const code = window.editor.getValue();

        if (!selectedId) {
          terminal_screen.innerHTML = `<div class="terminal-line terminal-error">Please select a language first.</div>`;
          return;
        }

        terminal_screen.innerHTML = `<div class="terminal-line terminal-dim">> Running in Judge0 container...</div>`;

        const res = await fetch("/runCode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, language_id: selectedId.toString() }),
        });

        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const rawText = await res.text();
          terminal_screen.innerHTML = `<div class="terminal-line terminal-error">${escapeHtml(rawText || "Server error")}</div>`;
          return;
        }

        const data = await res.json();
        const output = data.stdout || data.stderr || data.compile_output || data.message || "Executed with no output.";
        const isError = Boolean(data.stderr || data.compile_output);

        terminal_screen.innerHTML = `
          <div class="terminal-line ${isError ? "terminal-error" : "terminal-success"}">${escapeHtml(output)}</div>
          <div class="terminal-line terminal-dim" style="margin-top:6px; font-size:11px;">[Status: ${data.status || "Completed"} | Time: ${data.time || 0}s | Memory: ${data.memory || 0} KB]</div>
        `;
      } catch (error) {
        terminal_screen.innerHTML = `<div class="terminal-line terminal-error">${escapeHtml(error.message || error)}</div>`;
      }
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
        
        // Render user message bubble
        const userBubble = document.createElement("div");
        userBubble.style.cssText = "background: #18181b; border: 1px solid #27272a; padding: 8px 10px; border-radius: 4px; font-size: 12.5px; align-self: flex-end; color: #fff; max-width: 90%;";
        userBubble.textContent = msg;
        consoleOutput.appendChild(userBubble);
        input.value = "";
        consoleOutput.scrollTop = consoleOutput.scrollHeight;

        // Render loading agent bubble
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
            // Streaming via Socket.IO
            window.socket.emit("ask-ai", {
              prompt: msg,
              model: selectedModel,
              fileSystem: currentFs,
              activeFileId: currentActiveId,
              code,
              language: currentLang
            });

            window.socket.on("ai_chunk", (chunk) => {
              responseText += chunk;
              updateBubble();
            });

            window.socket.on("ai_thought", (thought) => {
              responseText += `\n> *(${escapeHtml(thought)})*\n`;
              updateBubble();
            });

            window.socket.on("ai_tool_call", (toolCall) => {
              responseText += `\n> *(Calling tool ${toolCall.name}...)*\n`;
              updateBubble();
            });

            window.socket.on("ai_error", (error) => {
              agentBubble.innerHTML = `<strong>Agent Error:</strong><p style="margin-top:4px; color:#ef4444;">${escapeHtml(error.message)}</p>`;
              window.socket.removeAllListeners("ai_chunk");
              window.socket.removeAllListeners("ai_thought");
              window.socket.removeAllListeners("ai_tool_call");
              window.socket.removeAllListeners("ai_error");
              window.socket.removeAllListeners("ai_complete");
            });

            window.socket.on("ai_complete", (data) => {
              handleActions(data.actions);
              if (!responseText) {
                 responseText = data.response || "Task completed.";
              }
              updateBubble();

              window.socket.removeAllListeners("ai_chunk");
              window.socket.removeAllListeners("ai_thought");
              window.socket.removeAllListeners("ai_tool_call");
              window.socket.removeAllListeners("ai_error");
              window.socket.removeAllListeners("ai_complete");
            });

          } else {
            // Fallback to standard HTTP fetch
            responseBody.innerHTML = `<em>Thinking...</em>`;
            const res = await fetch("/ask-ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: msg,
                model: selectedModel,
                fileSystem: currentFs,
                activeFileId: currentActiveId,
                code,
                language: currentLang
              })
            });

            const data = await res.json();
            if (!res.ok) {
              throw new Error(data.response || `Server returned status ${res.status}`);
            }

            handleActions(data.actions);
            responseText = data.response || "Done.";
            updateBubble();
          }

        } catch (err) {
          agentBubble.innerHTML = `<strong>Agent Error:</strong><p style="margin-top:4px; color:#ef4444;">${escapeHtml(err.message)}</p>`;
        }

        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    window.handleSendPrompt = handleSendPrompt;
    const promptForm = document.getElementById("prompt");
    if (promptForm) {
      promptForm.addEventListener("submit", handleSendPrompt);
    }

    async function refreshModels() {
      const select = document.getElementById("ai-model-select");
      if (!select) return;
      
      const prevVal = select.value;
      const originalHtml = select.innerHTML;
      
      try {
        const res = await fetch("/api/models");
        const data = await res.json();
        if (data.models && Array.isArray(data.models) && data.models.length > 0) {
          select.innerHTML = "";
          data.models.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.id;
            opt.textContent = m.name || m.id;
            if (m.id === prevVal) opt.selected = true;
            select.appendChild(opt);
          });
          if (!select.value && select.options.length > 0) {
            select.selectedIndex = 0;
          }
        }
      } catch (err) {
        console.warn("Failed to refresh models:", err);
      }
    }

    // Auto-fetch fresh model list from local and cloud on load
    window.addEventListener("DOMContentLoaded", () => {
      refreshModels();
    });

    async function saveWorkspaceToMongoDB() {
      if (!window.editor) {
        alert("Editor not ready");
        return;
      }
      const projectName = prompt("Enter workspace name to save:");
      if (!projectName) return;
      const projectDesc = prompt("Enter a brief description:");

      terminal_screen.innerHTML = `<div class="terminal-line terminal-dim">> Saving workspace to MongoDB...</div>`;
      
      const zip = new JSZip();
      // Recursive function to add files to zip based on fileSystem array defined in editor.js
      const addToZip = (parentId, currentFolder) => {
        const items = typeof fileSystem !== 'undefined' ? fileSystem.filter(f => f.parentId === parentId) : [];
        items.forEach(item => {
          if (item.type === 'folder') {
            const newFolder = currentFolder.folder(item.name);
            addToZip(item.id, newFolder);
          } else {
            const content = (typeof models !== 'undefined' && models[item.id]) ? models[item.id].getValue() : item.content;
            currentFolder.file(item.name, content);
          }
        });
      };
      
      if (typeof fileSystem !== 'undefined') {
        addToZip('root', zip);
      } else {
        const code = window.editor.getValue();
        zip.file("main.js", code);
      }
      
      try {
        const content = await zip.generateAsync({ type: "blob" });
        const formData = new FormData();
        formData.append("projectName", projectName);
        formData.append("projectDescription", projectDesc || "Code Editor Workspace");
        formData.append("projectProgrammingLanguage", selectedName);
        formData.append("projectFile", content, projectName + ".zip");

        const res = await fetch("/save-project", {
          method: "POST",
          body: formData
        });
        
        const data = await res.json();
        if (data.success) {
          window.hasUnsavedChanges = false;
          terminal_screen.innerHTML += `<div class="terminal-line terminal-success">Workspace saved successfully! Check Dashboard.</div>`;
        } else {
          terminal_screen.innerHTML += `<div class="terminal-line terminal-error">Error saving: ${escapeHtml(data.error || "Unknown error")}</div>`;
        }
      } catch (err) {
        terminal_screen.innerHTML += `<div class="terminal-line terminal-error">Error: ${escapeHtml(err.message)}</div>`;
      }
    }

    async function exportToPDF() {
      if (!window.editor) return;
      
      const rawPdfName = prompt("Enter PDF document name:");
      if (!rawPdfName) return;
      const pdfName = rawPdfName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50) || "document";

      terminal_screen.innerHTML = `<div class="terminal-line terminal-dim">> Generating PDF and uploading...</div>`;
      
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
          terminal_screen.innerHTML += `<div class="terminal-line terminal-success">PDF saved to Dashboard!</div>`;
          doc.save(pdfName + ".pdf"); 
        } else {
          terminal_screen.innerHTML += `<div class="terminal-line terminal-error">Error saving PDF: ${escapeHtml(data.error || "Unknown error")}</div>`;
        }
      } catch (err) {
        terminal_screen.innerHTML += `<div class="terminal-line terminal-error">Error: ${escapeHtml(err.message)}</div>`;
      }
    }
