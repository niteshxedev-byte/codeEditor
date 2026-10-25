// Enhanced Monaco Editor & File Explorer Logic with Local Storage Auto-Save

let editor = window.editor = null;
let models = window.models = {}; // Store monaco models by file id

// Initial File System State
let fileSystem = window.fileSystem = [
  { id: 'root', type: 'folder', name: 'root', parentId: null }, // Virtual root, not rendered
  { id: '1', type: 'file', name: 'main.js', content: '// Welcome to Personal Code Editor\nconsole.log("Hello Developer!");\n', parentId: 'root' },
  { id: '2', type: 'file', name: 'README.md', content: '# Welcome\n\nWrite your code here.', parentId: 'root' }
];

let activeFileId = window.activeFileId = '1';
let openTabs = window.openTabs = ['1'];
let expandedFolders = new Set(['root']);
let draggedItemId = null;

// Project & Workspace Session State
window.currentProjectId = null;
window.currentProjectName = null;
window.currentProjectUrl = null;

const STORAGE_KEY = 'pce:workspace:current';
let autoSaveTimer = null;

// Utility: Generate Unique ID
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Status indicator updater
function setSaveStatus(status, text) {
  const pill = document.getElementById("save-status-pill");
  if (!pill) return;
  pill.className = "save-status-pill " + status;
  if (status === "saving") {
    pill.innerHTML = `<i class="ri-loader-4-line ide-spin"></i> <span>${text || "saving..."}</span>`;
  } else if (status === "saved") {
    pill.innerHTML = `<i class="ri-check-line"></i> <span>${text || "saved locally"}</span>`;
  } else if (status === "synced") {
    pill.innerHTML = `<i class="ri-cloud-check-line"></i> <span>${text || "saved to DB"}</span>`;
  } else if (status === "offline") {
    pill.innerHTML = `<i class="ri-hard-drive-line"></i> <span>${text || "offline"}</span>`;
  }
}
window.setSaveStatus = setSaveStatus;

// Auto-Save Workspace state to LocalStorage
function saveWorkspaceToLocalStorage() {
  try {
    if (!Array.isArray(fileSystem) || fileSystem.length === 0) return;

    // Sync active editor content to memory model/filesystem item
    if (editor && activeFileId && models[activeFileId]) {
      const activeItem = fileSystem.find(f => f.id === activeFileId && f.type === 'file');
      if (activeItem) {
        activeItem.content = models[activeFileId].getValue();
      }
    }

    const filesToStore = fileSystem.map(item => {
      const entry = {
        id: item.id,
        type: item.type,
        name: item.name,
        parentId: item.parentId,
      };
      if (item.type === 'file') {
        entry.content = (models[item.id] ? models[item.id].getValue() : (item.content || ""));
      }
      return entry;
    });

    const langSelect = document.getElementById("language");
    const stdinEl = document.getElementById("terminal-stdin-input");

    const payload = {
      version: 1,
      projectId: window.currentProjectId || null,
      projectName: window.currentProjectName || null,
      projectUrl: window.currentProjectUrl || null,
      activeFileId: activeFileId,
      openTabs: openTabs,
      selectedLanguageId: langSelect ? langSelect.value : null,
      stdin: stdinEl ? stdinEl.value : "",
      fileSystem: filesToStore,
      updatedAt: Date.now()
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    setSaveStatus("saved");
  } catch (err) {
    console.warn("Auto-save to localStorage failed:", err);
  }
}
window.saveWorkspaceToLocalStorage = saveWorkspaceToLocalStorage;

function triggerAutoSave(debounceMs = 350) {
  setSaveStatus("saving");
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveWorkspaceToLocalStorage();
  }, debounceMs);
}
window.triggerAutoSave = triggerAutoSave;

// Restore workspace from LocalStorage
function restoreWorkspaceFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.fileSystem) || data.fileSystem.length === 0) return false;

    // Dispose old models
    Object.keys(models).forEach(id => {
      if (models[id]) models[id].dispose();
    });
    models = window.models = {};

    fileSystem = window.fileSystem = data.fileSystem.map(item => ({
      id: item.id,
      type: item.type,
      name: item.name,
      parentId: item.parentId,
      content: item.type === 'file' ? (item.content || "") : undefined
    }));

    // Ensure expandedFolders has root and all folders
    expandedFolders = new Set(['root']);
    fileSystem.filter(f => f.type === 'folder').forEach(f => expandedFolders.add(f.id));

    const m = window.monaco || (typeof monaco !== "undefined" ? monaco : null);
    if (m && m.editor) {
      fileSystem.forEach(item => {
        if (item.type === 'file') {
          models[item.id] = m.editor.createModel(
            item.content || "",
            getLanguageFromExtension(item.name)
          );
        }
      });
    }

    openTabs = window.openTabs = Array.isArray(data.openTabs) && data.openTabs.length > 0
      ? data.openTabs.filter(tid => fileSystem.some(f => f.id === tid && f.type === 'file'))
      : [];

    const validActive = fileSystem.find(f => f.id === data.activeFileId && f.type === 'file');
    if (validActive) {
      activeFileId = window.activeFileId = validActive.id;
      if (!openTabs.includes(validActive.id)) openTabs.push(validActive.id);
    } else {
      const firstFile = fileSystem.find(f => f.type === 'file');
      if (firstFile) {
        activeFileId = window.activeFileId = firstFile.id;
        if (!openTabs.includes(firstFile.id)) openTabs.push(firstFile.id);
      }
    }

    window.currentProjectId = data.projectId || null;
    window.currentProjectName = data.projectName || null;
    window.currentProjectUrl = data.projectUrl || null;

    if (window.currentProjectName) {
      const badge = document.querySelector(".workspace-badge");
      if (badge) badge.textContent = window.currentProjectName;
    }

    if (data.stdin !== undefined) {
      const stdinEl = document.getElementById("terminal-stdin-input");
      if (stdinEl) stdinEl.value = data.stdin;
    }

    if (editor && activeFileId && models[activeFileId]) {
      editor.setModel(models[activeFileId]);
      const current = fileSystem.find(f => f.id === activeFileId);
      if (current) syncLanguageDropdown(current.name);
    }

    renderTree();
    updateEditorTab();
    setSaveStatus("saved");
    return true;
  } catch (err) {
    console.warn("Failed to restore workspace from localStorage:", err);
    return false;
  }
}
window.restoreWorkspaceFromLocalStorage = restoreWorkspaceFromLocalStorage;

// Monaco Editor Initialization
window.addEventListener("DOMContentLoaded", () => {
  if (typeof require !== "undefined") {
    require(["vs/editor/editor.main"], async function () {
      const params = new URLSearchParams(window.location.search);
      const projectUrl = params.get("projectUrl");

      if (projectUrl) {
        // Create initial models
        fileSystem.forEach(item => {
          if (item.type === 'file') {
            models[item.id] = monaco.editor.createModel(
              item.content,
              getLanguageFromExtension(item.name)
            );
          }
        });

        editor = monaco.editor.create(document.getElementById("editor"), {
          model: models[activeFileId],
          theme: "vs-dark",
          automaticLayout: true,
          fontSize: 15,
          minimap: { enabled: true },
          fontFamily: "'JetBrains Mono', monospace",
        });
        window.editor = editor;

        await loadSavedProjectFromUrl();
      } else {
        const restored = restoreWorkspaceFromLocalStorage();
        if (!restored) {
          fileSystem.forEach(item => {
            if (item.type === 'file') {
              models[item.id] = monaco.editor.createModel(
                item.content,
                getLanguageFromExtension(item.name)
              );
            }
          });
        }

        editor = monaco.editor.create(document.getElementById("editor"), {
          model: models[activeFileId] || null,
          theme: "vs-dark",
          automaticLayout: true,
          fontSize: 15,
          minimap: { enabled: true },
          fontFamily: "'JetBrains Mono', monospace",
        });
        window.editor = editor;

        if (!restored) {
          saveWorkspaceToLocalStorage();
        } else {
          const current = fileSystem.find(f => f.id === activeFileId);
          if (current) syncLanguageDropdown(current.name);
        }
      }

      // Update file content in state and auto-save when edited
      editor.onDidChangeModelContent(() => {
        const item = fileSystem.find(f => f.id === activeFileId);
        if (item && models[activeFileId]) {
          item.content = models[activeFileId].getValue();
        }
        if (window.hasUnsavedChanges !== undefined) {
          window.hasUnsavedChanges = true;
        }
        triggerAutoSave();
      });

      // Keyboard shortcut Ctrl+S / Cmd+S in Monaco Editor
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (typeof window.saveWorkspaceToMongoDB === "function") {
          window.saveWorkspaceToMongoDB(false);
        }
      });

      renderTree();
      updateEditorTab();
    });
  }

  // Global window keyboard shortcut Ctrl+S / Cmd+S
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (typeof window.saveWorkspaceToMongoDB === "function") {
        window.saveWorkspaceToMongoDB(false);
      }
    }
  });

  // Auto-save on page unload
  window.addEventListener("beforeunload", () => {
    saveWorkspaceToLocalStorage();
  });

  // Auto-save STDIN input changes
  const stdinInput = document.getElementById("terminal-stdin-input");
  if (stdinInput) {
    stdinInput.addEventListener("input", () => triggerAutoSave(500));
  }

  // Setup folder import listener
  const folderInput = document.getElementById("folderInput");
  if (folderInput) {
    folderInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      Object.keys(models).forEach(id => models[id] && models[id].dispose());
      models = window.models = {};
      fileSystem = window.fileSystem = [
        { id: 'root', type: 'folder', name: 'imported', parentId: null }
      ];

      window.currentProjectId = null;
      window.currentProjectName = "imported";
      window.currentProjectUrl = null;
      const badge = document.querySelector(".workspace-badge");
      if (badge) badge.textContent = "imported";

      const folderMap = { '': 'root' };
      let firstFileId = null;

      for (const file of files) {
        const pathParts = (file.webkitRelativePath || file.name).split('/');
        const fileName = pathParts.pop();

        let currentPath = '';
        let parentPath = '';
        for (let i = 0; i < pathParts.length; i++) {
          currentPath = pathParts.slice(0, i + 1).join('/');
          parentPath = pathParts.slice(0, i).join('/');
          if (!folderMap[currentPath]) {
            const folderId = generateId();
            folderMap[currentPath] = folderId;
            const parentId = folderMap[parentPath] || 'root';
            fileSystem.push({ id: folderId, type: 'folder', name: pathParts[i], parentId });
            expandedFolders.add(folderId);
          }
        }

        const parentId = folderMap[pathParts.join('/')] || 'root';
        const ext = fileName.split('.').pop().toLowerCase();
        let content = '';
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(ext)) {
          const reader = new FileReader();
          content = await new Promise((r) => {
            reader.onload = () => r(reader.result);
            reader.readAsDataURL(file);
          });
        } else {
          content = await file.text();
        }
        const fileId = generateId();

        fileSystem.push({ id: fileId, type: 'file', name: fileName, content, parentId });
        models[fileId] = monaco.editor.createModel(content, getLanguageFromExtension(fileName));
        if (!firstFileId) firstFileId = fileId;
      }

      if (firstFileId) {
        activeFileId = window.activeFileId = firstFileId;
        openTabs = window.openTabs = [firstFileId];
        if (editor) editor.setModel(models[firstFileId]);
        const firstFile = fileSystem.find(f => f.id === firstFileId);
        if (firstFile) syncLanguageDropdown(firstFile.name);
        updateEditorTab();
      }
      renderTree();
      saveWorkspaceToLocalStorage();
    });
  }

  // Setup single file import listener (fallback for browsers without File System Access API)
  const fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const ext = file.name.split('.').pop().toLowerCase();
        let content = '';
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(ext)) {
          const reader = new FileReader();
          content = await new Promise((r) => {
            reader.onload = () => r(reader.result);
            reader.readAsDataURL(file);
          });
        } else {
          content = await file.text();
        }
        loadSingleFile(file.name, content, file.name);
        if (window.ideDialog) {
          window.ideDialog.toast(`Opened ${file.name}`, "info");
        }
      } catch (err) {
        console.error("Failed to read file:", err);
        if (window.ideDialog) window.ideDialog.toast("Failed to read selected file", "error");
      }
      fileInput.value = "";
    });
  }
});

async function loadSavedProjectFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("projectId") || params.get("id");
  const projectUrl = params.get("projectUrl");
  const projectName = params.get("name") || params.get("projectName");

  // Securely resolve archive URL from authenticated API endpoint
  const targetUrl = projectId ? `/api/projects/${encodeURIComponent(projectId)}/archive` : projectUrl;
  if (!targetUrl) return;

  window.currentProjectId = projectId || null;
  window.currentProjectName = projectName || null;
  window.currentProjectUrl = targetUrl;

  try {
    const res = await fetch(targetUrl);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (window.ideDialog) window.ideDialog.toast("Unauthorized: You do not have permission to access this workspace.", "error");
        setTimeout(() => { window.location.href = "/DashboardCodeEditor"; }, 1500);
        return;
      }
      throw new Error(`Failed to fetch project archive (${res.status})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    if (typeof JSZip === "undefined") {
      console.warn("JSZip not ready yet for loading archive");
      return;
    }
    const zip = await JSZip.loadAsync(arrayBuffer);

    Object.keys(models).forEach(id => {
      if (models[id]) models[id].dispose();
    });
    models = window.models = {};

    fileSystem = window.fileSystem = [
      { id: 'root', type: 'folder', name: projectName || 'project', parentId: null }
    ];

    window.currentProjectId = projectId || null;
    window.currentProjectName = projectName || null;
    window.currentProjectUrl = projectUrl || null;

    const folderMap = { '': 'root' };
    const zipEntries = Object.keys(zip.files).sort();

    // Pass 1: Build directory entries
    for (const relativePath of zipEntries) {
      const entry = zip.files[relativePath];
      const parts = relativePath.split('/').filter(Boolean);

      if (entry.dir) {
        let currentPath = '';
        let parentPath = '';
        for (let i = 0; i < parts.length; i++) {
          currentPath = parts.slice(0, i + 1).join('/');
          parentPath = parts.slice(0, i).join('/');

          if (!folderMap[currentPath]) {
            const folderId = generateId();
            folderMap[currentPath] = folderId;
            const parentId = folderMap[parentPath] || 'root';
            fileSystem.push({
              id: folderId,
              type: 'folder',
              name: parts[i],
              parentId: parentId
            });
            expandedFolders.add(folderId);
          }
        }
      }
    }

    // Pass 2: Extract files
    let firstFileId = null;
    for (const relativePath of zipEntries) {
      const entry = zip.files[relativePath];
      if (entry.dir) continue;

      const parts = relativePath.split('/').filter(Boolean);
      const fileName = parts.pop();
      const parentPath = parts.join('/');

      // Ensure intermediate parent folders exist even if zip didn't list explicit dir entries
      let currentPath = '';
      let parentPathFolder = '';
      for (let i = 0; i < parts.length; i++) {
        currentPath = parts.slice(0, i + 1).join('/');
        parentPathFolder = parts.slice(0, i).join('/');
        if (!folderMap[currentPath]) {
          const folderId = generateId();
          folderMap[currentPath] = folderId;
          const pId = folderMap[parentPathFolder] || 'root';
          fileSystem.push({ id: folderId, type: 'folder', name: parts[i], parentId: pId });
          expandedFolders.add(folderId);
        }
      }

      const parentId = folderMap[parentPath] || 'root';
      const ext = fileName.split('.').pop().toLowerCase();
      const isImage = ["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp"].includes(ext);
      let content = "";
      if (isImage) {
        const base64 = await entry.async("base64");
        const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        content = `data:${mime};base64,${base64}`;
      } else {
        content = await entry.async("string");
      }
      const fileId = generateId();

      fileSystem.push({
        id: fileId,
        type: 'file',
        name: fileName,
        content: content,
        parentId: parentId
      });

      models[fileId] = monaco.editor.createModel(content, getLanguageFromExtension(fileName));
      if (!firstFileId) firstFileId = fileId;
    }

    if (firstFileId) {
      activeFileId = window.activeFileId = firstFileId;
      openTabs = window.openTabs = [firstFileId];
      if (editor && models[firstFileId]) editor.setModel(models[firstFileId]);
      const firstFile = fileSystem.find(f => f.id === firstFileId);
      if (firstFile) syncLanguageDropdown(firstFile.name);
      updateEditorTab();
    }

    if (projectName) {
      const badge = document.querySelector(".workspace-badge");
      if (badge) badge.textContent = projectName;
    }

    renderTree();
    saveWorkspaceToLocalStorage();
    setSaveStatus("synced");
  } catch (err) {
    console.error("Error loading project archive:", err);
  }
}

function getLanguageFromExtension(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    'js': 'javascript', 'ts': 'typescript',
    'py': 'python', 'html': 'html', 'css': 'css',
    'json': 'json', 'md': 'markdown', 'c': 'c',
    'cpp': 'cpp', 'java': 'java', 'go': 'go'
  };
  return map[ext] || 'plaintext';
}

// Render File Tree
function renderTree() {
  const container = document.getElementById("file-tree-container");
  if (!container) return;
  container.innerHTML = "";

  const rootItems = fileSystem.filter(item => item.parentId === 'root');
  rootItems.forEach(item => {
    container.appendChild(createTreeElement(item, 0));
  });

  updateEditorTab();
}

function createTreeElement(item, depth) {
  const div = document.createElement("div");
  div.className = `tree-file-item ${item.id === activeFileId ? 'active' : ''}`;
  div.style.paddingLeft = `${depth * 12 + 8}px`;
  div.style.position = 'relative';

  // Drag and drop attributes
  div.draggable = true;
  div.ondragstart = (e) => {
    draggedItemId = item.id;
    e.stopPropagation();
  };
  div.ondragover = (e) => {
    e.preventDefault();
    if (item.type === 'folder' && draggedItemId !== item.id) {
      div.style.backgroundColor = 'rgba(37, 99, 235, 0.2)';
    }
  };
  div.ondragleave = (e) => {
    div.style.backgroundColor = '';
  };
  div.ondrop = (e) => {
    e.preventDefault();
    div.style.backgroundColor = '';
    if (item.type === 'folder' && draggedItemId && draggedItemId !== item.id) {
      moveItem(draggedItemId, item.id);
    }
  };

  const icon = document.createElement("i");
  if (item.type === 'folder') {
    const isExpanded = expandedFolders.has(item.id);
    icon.className = isExpanded ? "ri-folder-open-line" : "ri-folder-line";
    icon.style.color = "#6b7280";
  } else {
    icon.className = "ri-file-code-line";
    icon.style.color = getIconColor(item.name);
  }

  const span = document.createElement("span");
  span.textContent = item.name;
  span.style.flex = "1";
  span.style.overflow = "hidden";
  span.style.textOverflow = "ellipsis";
  span.style.whiteSpace = "nowrap";

  // Actions container (visible on hover)
  const actions = document.createElement("div");
  actions.style.display = "none";
  actions.style.gap = "4px";

  const delBtn = document.createElement("i");
  delBtn.className = "ri-delete-bin-line";
  delBtn.title = "Delete";
  delBtn.onclick = (e) => {
    e.stopPropagation();
    deleteItem(item.id);
  };

  const renameBtn = document.createElement("i");
  renameBtn.className = "ri-edit-line";
  renameBtn.title = "Rename";
  renameBtn.onclick = (e) => {
    e.stopPropagation();
    renameItem(item.id);
  };

  actions.appendChild(renameBtn);
  actions.appendChild(delBtn);

  div.addEventListener("mouseenter", () => actions.style.display = "flex");
  div.addEventListener("mouseleave", () => actions.style.display = "none");

  div.appendChild(icon);
  div.appendChild(span);
  div.appendChild(actions);

  div.onclick = (e) => {
    e.stopPropagation();
    if (item.type === 'folder') {
      if (expandedFolders.has(item.id)) {
        expandedFolders.delete(item.id);
      } else {
        expandedFolders.add(item.id);
      }
      renderTree();
    } else {
      switchToFile(item.id);
    }
  };

  const wrapper = document.createElement("div");
  wrapper.appendChild(div);

  if (item.type === 'folder' && expandedFolders.has(item.id)) {
    const children = fileSystem.filter(f => f.parentId === item.id);
    children.forEach(child => {
      wrapper.appendChild(createTreeElement(child, depth + 1));
    });
  }

  return wrapper;
}

function syncLanguageDropdown(filename) {
  if (!filename) return;
  const select = document.getElementById("language");
  if (!select) return;

  const ext = filename.split('.').pop().toLowerCase();
  const extToLangId = {
    'cpp': '54', 'hpp': '54', 'cc': '54', 'h': '54',
    'c': '50',
    'js': '63', 'mjs': '63', 'cjs': '63',
    'ts': '74',
    'py': '71',
    'java': '62',
    'rs': '73',
    'go': '60'
  };

  const targetId = extToLangId[ext];
  if (targetId && select.value !== targetId) {
    select.value = targetId;
    select.dispatchEvent(new Event('change'));
  }
}

function switchToFile(fileId) {
  const file = fileSystem.find(f => f.id === fileId && f.type === 'file');
  if (!file) return;
  activeFileId = window.activeFileId = file.id;
  if (!openTabs.includes(file.id)) {
    openTabs.push(file.id);
  }
  if (editor && models[file.id]) {
    editor.setModel(models[file.id]);
    editor.layout();
  }
  syncLanguageDropdown(file.name);
  renderTree();
  triggerAutoSave(600);
}

function getIconColor(filename) {
  if (filename.endsWith('.js') || filename.endsWith('.mjs')) return "#eab308";
  if (filename.endsWith('.ts')) return "#3178c6";
  if (filename.endsWith('.html')) return "#e34f26";
  if (filename.endsWith('.css')) return "#1572b6";
  if (filename.endsWith('.json')) return "#a3e635";
  if (filename.endsWith('.md')) return "#60a5fa";
  if (filename.endsWith('.cpp') || filename.endsWith('.hpp') || filename.endsWith('.cc') || filename.endsWith('.h')) return "#00599c";
  if (filename.endsWith('.py')) return "#3572a5";
  if (filename.endsWith('.java')) return "#b07219";
  if (filename.endsWith('.rs')) return "#dea584";
  if (filename.endsWith('.go')) return "#00add8";
  return "#c4cceb";
}

// ── Native IDE Modal Dialog & Notification System ──
const ideDialog = {
  _dialogEl: null,
  _titleEl: null,
  _iconEl: null,
  _subtitleEl: null,
  _fieldsEl: null,
  _errorEl: null,
  _cancelBtn: null,
  _submitBtn: null,
  _formEl: null,
  _resolvePromise: null,
  _currentConfig: null,

  _init() {
    if (this._dialogEl) return;
    this._dialogEl = document.getElementById("ide-modal-dialog");
    this._titleEl = document.getElementById("ide-dialog-title");
    this._iconEl = document.getElementById("ide-dialog-icon");
    this._subtitleEl = document.getElementById("ide-dialog-subtitle");
    this._fieldsEl = document.getElementById("ide-dialog-fields");
    this._errorEl = document.getElementById("ide-dialog-error");
    this._cancelBtn = document.getElementById("ide-dialog-cancel-btn");
    this._submitBtn = document.getElementById("ide-dialog-submit-btn");
    this._formEl = document.getElementById("ide-dialog-form");

    if (!this._dialogEl) return;

    // Prevent clicks inside the dialog card from bubbling to dialog backdrop
    const card = this._dialogEl.querySelector(".ide-dialog-card");
    if (card) {
      card.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    }

    // Cancel button
    if (this._cancelBtn) {
      this._cancelBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.close(null);
      };
    }

    // Close X button
    const closeBtn = document.getElementById("ide-dialog-close-btn");
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.close(null);
      };
    }

    // Submit button explicit click handler
    if (this._submitBtn) {
      this._submitBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._handleSubmit();
      };
    }

    // Only close if user clicked directly on the dialog backdrop
    this._dialogEl.addEventListener("click", (e) => {
      if (e.target === this._dialogEl) {
        this.close(null);
      }
    });

    // Native dialog cancel event (Esc key)
    this._dialogEl.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close(null);
    });

    // Form submit event fallback
    if (this._formEl) {
      this._formEl.onsubmit = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._handleSubmit();
      };
    }
  },

  close(result) {
    if (this._dialogEl && this._dialogEl.open) {
      this._dialogEl.close();
    }
    if (this._resolvePromise) {
      const resolve = this._resolvePromise;
      this._resolvePromise = null;
      resolve(result);
    }
  },

  showError(msg) {
    if (this._errorEl) {
      if (msg) {
        this._errorEl.textContent = msg;
        this._errorEl.classList.remove("pce-hidden");
      } else {
        this._errorEl.textContent = "";
        this._errorEl.classList.add("pce-hidden");
      }
    }
  },

  _handleSubmit() {
    if (!this._currentConfig) return;
    const { fields, validate } = this._currentConfig;
    const values = {};

    for (const f of fields) {
      const input = document.getElementById("ide-field-" + f.name);
      if (input) {
        values[f.name] = input.value.trim();
        if (f.required && !values[f.name]) {
          this.showError((f.label || f.name) + " is required.");
          input.focus();
          return;
        }
      }
    }

    if (validate) {
      const err = validate(values);
      if (err) {
        this.showError(err);
        return;
      }
    }

    this.showError("");
    this.close(values);
  },

  promptForm({
    title,
    icon = "ri-terminal-box-line",
    subtitle = "",
    fields = [],
    submitText = "Confirm",
    isDestructive = false,
    validate,
  }) {
    this._init();
    if (!this._dialogEl) return Promise.resolve(null);

    // Clean up any stale promise before opening
    if (this._resolvePromise) {
      const oldResolve = this._resolvePromise;
      this._resolvePromise = null;
      oldResolve(null);
    }

    this._currentConfig = { fields, validate };
    if (this._titleEl) this._titleEl.textContent = title;
    if (this._iconEl) this._iconEl.className = icon;
    if (this._subtitleEl) this._subtitleEl.textContent = subtitle;
    this.showError("");

    if (this._submitBtn) {
      this._submitBtn.textContent = submitText;
      this._submitBtn.className = isDestructive
        ? "ide-btn ide-btn-danger"
        : "ide-btn ide-btn-primary";
      this._submitBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._handleSubmit();
      };
    }

    if (this._fieldsEl) {
      this._fieldsEl.innerHTML = "";
      fields.forEach((f) => {
        const group = document.createElement("div");
        group.className = "ide-form-group";

        const label = document.createElement("label");
        label.setAttribute("for", "ide-field-" + f.name);
        label.textContent = f.label || f.name;
        group.appendChild(label);

        let input;
        if (f.type === "textarea") {
          input = document.createElement("textarea");
          input.rows = 3;
        } else {
          input = document.createElement("input");
          input.type = f.type || "text";
        }
        input.id = "ide-field-" + f.name;
        input.name = f.name;
        input.placeholder = f.placeholder || "";
        input.value = f.defaultValue || "";
        input.spellcheck = false;
        input.autocomplete = "off";

        input.addEventListener("input", () => this.showError(""));
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            this._handleSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this.close(null);
          }
        });

        group.appendChild(input);
        this._fieldsEl.appendChild(group);
      });
    }

    return new Promise((resolve) => {
      this._resolvePromise = resolve;
      try {
        if (!this._dialogEl.open) {
          this._dialogEl.showModal();
        }
      } catch (err) {
        console.warn("showModal warning:", err);
      }

      setTimeout(() => {
        const firstField = this._fieldsEl?.querySelector("input, textarea");
        if (firstField) {
          firstField.focus();
          if (firstField.value) {
            firstField.select();
          }
        }
      }, 50);
    });
  },

  promptInput({
    title,
    icon,
    subtitle = "",
    label = "Name",
    placeholder = "",
    defaultValue = "",
    submitText = "Create",
    validate,
  }) {
    return this.promptForm({
      title,
      icon,
      subtitle,
      fields: [{ name: "value", label, placeholder, defaultValue, required: true }],
      submitText,
      validate: validate ? (vals) => validate(vals.value) : undefined,
    }).then((res) => (res ? res.value : null));
  },

  confirm({
    title = "Confirm Action",
    icon = "ri-alert-line",
    message = "Are you sure you want to proceed?",
    submitText = "Confirm",
    isDestructive = false,
  }) {
    this._init();
    if (!this._dialogEl) return Promise.resolve(false);

    this.close(null);

    this._currentConfig = { fields: [] };
    if (this._titleEl) this._titleEl.textContent = title;
    if (this._iconEl) this._iconEl.className = icon;
    if (this._subtitleEl) this._subtitleEl.textContent = message;
    this.showError("");

    if (this._submitBtn) {
      this._submitBtn.textContent = submitText;
      this._submitBtn.className = isDestructive
        ? "ide-btn ide-btn-danger"
        : "ide-btn ide-btn-primary";
    }

    if (this._fieldsEl) {
      this._fieldsEl.innerHTML = "";
    }

    return new Promise((resolve) => {
      this._resolvePromise = (res) => resolve(Boolean(res));
      this._dialogEl.showModal();
      setTimeout(() => {
        if (this._submitBtn) this._submitBtn.focus();
      }, 40);
    });
  },

  toast(message, type = "info", duration = 3200) {
    const container = document.getElementById("ide-toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `ide-toast toast-${type}`;

    const icon = document.createElement("i");
    const icons = {
      success: "ri-checkbox-circle-line",
      error: "ri-error-warning-line",
      warning: "ri-alert-line",
      info: "ri-information-line",
    };
    icon.className = `ide-toast-icon ${icons[type] || icons.info}`;

    const msg = document.createElement("span");
    msg.className = "ide-toast-message";
    msg.textContent = message;

    toast.appendChild(icon);
    toast.appendChild(msg);

    const removeToast = () => {
      toast.classList.add("fade-out");
      setTimeout(() => {
        if (toast.parentNode === container) {
          container.removeChild(toast);
        }
      }, 250);
    };

    toast.onclick = removeToast;
    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(removeToast, duration);
    }
  },
};

window.ideDialog = ideDialog;

// Tree Operations (Form Modal Driven)
async function addFile() {
  let parentId = "root";
  let folderName = "root";
  const activeItem = fileSystem.find((f) => f.id === activeFileId);
  if (activeItem && activeItem.type === "folder") {
    parentId = activeItem.id;
    folderName = activeItem.name;
    expandedFolders.add(parentId);
  } else if (activeItem && activeItem.parentId !== "root") {
    parentId = activeItem.parentId;
    const parentFolder = fileSystem.find((f) => f.id === parentId);
    folderName = parentFolder ? parentFolder.name : "root";
    expandedFolders.add(parentId);
  }

  const name = await window.ideDialog.promptInput({
    title: "New File",
    icon: "ri-file-add-line",
    subtitle:
      folderName === "root"
        ? "Create file in project workspace"
        : `Target directory: /${folderName}`,
    label: "File Name",
    placeholder: "e.g. index.js, styles.css, app.py",
    submitText: "Create File",
    validate: (val) => {
      const trimmed = (val || "").trim();
      if (!trimmed) return "File name cannot be empty.";
      if (/[\\/:*?"<>|]/.test(trimmed)) return 'File name cannot contain: \\ / : * ? " < > |';
      const exists = fileSystem.some(
        (f) => f.parentId === parentId && f.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (exists) return `An item named "${trimmed}" already exists in this folder.`;
      return null;
    },
  });

  if (!name) return;
  const fileName = name.trim();
  const newId = generateId();
  fileSystem.push({ id: newId, type: "file", name: fileName, content: "", parentId });

  const m = window.monaco || (typeof monaco !== "undefined" ? monaco : null);
  if (m && m.editor) {
    try {
      models[newId] = m.editor.createModel("", getLanguageFromExtension(fileName));
    } catch (err) {
      console.warn("createModel warning:", err);
    }
  }

  if (typeof window.setPanel === "function") {
    window.setPanel("explorer", true);
  }

  switchToFile(newId);
  renderTree();
  updateEditorTab();
  triggerAutoSave();
  window.ideDialog.toast(`Created file "${fileName}"`, "success");
}

async function addFolder() {
  let parentId = "root";
  let folderName = "root";
  const activeItem = fileSystem.find((f) => f.id === activeFileId);
  if (activeItem && activeItem.type === "folder") {
    parentId = activeItem.id;
    folderName = activeItem.name;
    expandedFolders.add(parentId);
  } else if (activeItem && activeItem.parentId !== "root") {
    parentId = activeItem.parentId;
    const parentFolder = fileSystem.find((f) => f.id === parentId);
    folderName = parentFolder ? parentFolder.name : "root";
    expandedFolders.add(parentId);
  }

  const name = await window.ideDialog.promptInput({
    title: "New Folder",
    icon: "ri-folder-add-line",
    subtitle:
      folderName === "root"
        ? "Create folder in project workspace"
        : `Target directory: /${folderName}`,
    label: "Folder Name",
    placeholder: "e.g. components, utils, styles",
    submitText: "Create Folder",
    validate: (val) => {
      const trimmed = (val || "").trim();
      if (!trimmed) return "Folder name cannot be empty.";
      if (/[\\/:*?"<>|]/.test(trimmed)) return 'Folder name cannot contain: \\ / : * ? " < > |';
      const exists = fileSystem.some(
        (f) => f.parentId === parentId && f.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (exists) return `A folder named "${trimmed}" already exists in this location.`;
      return null;
    },
  });

  if (!name) return;
  const newFolderName = name.trim();
  const newId = generateId();
  fileSystem.push({ id: newId, type: "folder", name: newFolderName, parentId });
  expandedFolders.add(newId);

  if (typeof window.setPanel === "function") {
    window.setPanel("explorer", true);
  }

  renderTree();
  triggerAutoSave();
  window.ideDialog.toast(`Created folder "${newFolderName}"`, "success");
}

async function deleteItem(id) {
  const item = fileSystem.find((f) => f.id === id);
  if (!item) return;

  const ok = await window.ideDialog.confirm({
    title: item.type === "folder" ? "Delete Folder" : "Delete File",
    icon: "ri-delete-bin-line",
    message: `Are you sure you want to permanently delete "${item.name}"${item.type === "folder" ? " and all enclosed files" : ""
      }? This action cannot be undone.`,
    submitText: "Delete",
    isDestructive: true,
  });

  if (!ok) return;

  // Collect all ids to delete (including nested)
  const idsToDelete = new Set([id]);
  const collectChildren = (parentId) => {
    fileSystem
      .filter((f) => f.parentId === parentId)
      .forEach((child) => {
        idsToDelete.add(child.id);
        if (child.type === "folder") collectChildren(child.id);
      });
  };
  collectChildren(id);

  // Clean up models and openTabs
  idsToDelete.forEach((delId) => {
    openTabs = openTabs.filter((tid) => tid !== delId);
    if (models[delId]) {
      models[delId].dispose();
      delete models[delId];
    }
  });

  fileSystem = fileSystem.filter((f) => !idsToDelete.has(f.id));

  // Reset active file if deleted
  if (idsToDelete.has(activeFileId)) {
    const fallback =
      openTabs.length > 0
        ? fileSystem.find((f) => f.id === openTabs[openTabs.length - 1] && f.type === "file")
        : fileSystem.find((f) => f.type === "file");

    if (fallback) {
      activeFileId = window.activeFileId = fallback.id;
      if (!openTabs.includes(fallback.id)) openTabs.push(fallback.id);
      if (editor) editor.setModel(models[fallback.id]);
      syncLanguageDropdown(fallback.name);
    } else {
      activeFileId = window.activeFileId = null;
      if (editor) editor.setModel(null);
    }
  }

  renderTree();
  updateEditorTab();
  triggerAutoSave();
  window.ideDialog.toast(`Deleted "${item.name}"`, "info");
}

async function renameItem(id) {
  const item = fileSystem.find((f) => f.id === id);
  if (!item) return;

  const newName = await window.ideDialog.promptInput({
    title: item.type === "folder" ? "Rename Folder" : "Rename File",
    icon: "ri-edit-line",
    subtitle: `Rename current item "${item.name}"`,
    label: "New Name",
    defaultValue: item.name,
    submitText: "Rename",
    validate: (val) => {
      const trimmed = (val || "").trim();
      if (!trimmed) return "Name cannot be empty.";
      if (/[\\/:*?"<>|]/.test(trimmed)) return 'Name cannot contain: \\ / : * ? " < > |';
      const exists = fileSystem.some(
        (f) =>
          f.parentId === item.parentId &&
          f.id !== id &&
          f.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (exists) return `An item named "${trimmed}" already exists in this location.`;
      return null;
    },
  });

  if (!newName || newName.trim() === item.name) return;
  const trimmedName = newName.trim();
  item.name = trimmedName;
  if (item.type === "file" && models[id]) {
    monaco.editor.setModelLanguage(models[id], getLanguageFromExtension(trimmedName));
    syncLanguageDropdown(trimmedName);
  }
  renderTree();
  updateEditorTab();
  triggerAutoSave();
  window.ideDialog.toast(`Renamed to "${trimmedName}"`, "info");
}

function moveItem(itemId, newParentId) {
  // Prevent moving a folder into itself or its children
  if (itemId === newParentId) return;
  const item = fileSystem.find(f => f.id === itemId);
  if (!item) return;

  if (item.type === 'folder') {
    let current = fileSystem.find(f => f.id === newParentId);
    while (current && current.id !== 'root') {
      if (current.id === itemId) return; // Prevent cyclic move
      current = fileSystem.find(f => f.id === current.parentId);
    }
  }

  item.parentId = newParentId;
  expandedFolders.add(newParentId);
  renderTree();
  triggerAutoSave();
}

function updateEditorTab() {
  const tabContainer = document.querySelector('.editor-tabs-bar');
  if (!tabContainer) return;

  // Filter out any tabs for files that no longer exist
  openTabs = openTabs.filter(id => fileSystem.some(f => f.id === id && f.type === 'file'));

  // Ensure active file is in openTabs if it exists
  const currentActiveFile = fileSystem.find(f => f.id === activeFileId && f.type === 'file');
  if (currentActiveFile && !openTabs.includes(currentActiveFile.id)) {
    openTabs.push(currentActiveFile.id);
  }

  // If no open tabs, open first available file
  if (openTabs.length === 0) {
    const first = fileSystem.find(f => f.type === 'file');
    if (first) {
      openTabs.push(first.id);
      activeFileId = window.activeFileId = first.id;
    }
  }

  // If activeFileId is not among open tabs, select first tab
  if (!openTabs.includes(activeFileId) && openTabs.length > 0) {
    activeFileId = window.activeFileId = openTabs[0];
  }

  const activeItem = fileSystem.find(f => f.id === activeFileId && f.type === 'file');
  if (activeItem && editor && models[activeItem.id] && editor.getModel() !== models[activeItem.id]) {
    editor.setModel(models[activeItem.id]);
    syncLanguageDropdown(activeItem.name);
    editor.layout();
  }

  tabContainer.innerHTML = openTabs.map(id => {
    const file = fileSystem.find(f => f.id === id);
    if (!file) return '';
    const isActive = file.id === activeFileId;
    const safeName = escapeHtml(file.name);
    const safeId = escapeHtml(file.id);
    return `
      <div class="editor-tab ${isActive ? 'active' : ''}" data-tab-id="${safeId}" title="${safeName}">
        <i class="ri-file-code-line" style="color:${getIconColor(file.name)}; font-size:13px;"></i>
        <span>${safeName}</span>
        <i class="ri-close-line tab-close-icon" data-close-id="${safeId}" title="Close Tab"></i>
      </div>
    `;
  }).join('');

  // Attach click listeners to tabs
  tabContainer.querySelectorAll('.editor-tab').forEach(el => {
    el.onclick = (e) => {
      const closeBtn = e.target.closest('.tab-close-icon');
      if (closeBtn) {
        e.stopPropagation();
        const closeId = closeBtn.getAttribute('data-close-id');
        openTabs = openTabs.filter(tid => tid !== closeId);
        if (activeFileId === closeId) {
          activeFileId = window.activeFileId = openTabs.length > 0 ? openTabs[openTabs.length - 1] : null;
          if (activeFileId) {
            const nextFile = fileSystem.find(f => f.id === activeFileId);
            if (nextFile && editor && models[nextFile.id]) {
              editor.setModel(models[nextFile.id]);
              syncLanguageDropdown(nextFile.name);
            }
          }
        }
        renderTree();
        triggerAutoSave();
        return;
      }
      const tabId = el.getAttribute('data-tab-id');
      if (tabId) {
        switchToFile(tabId);
      }
    };
  });

  if (editor) editor.layout();
}

function exportFolder() {
  if (typeof JSZip !== "undefined") {
    const zip = new JSZip();

    const addToZip = (parentId, currentFolder) => {
      const items = fileSystem.filter(f => f.parentId === parentId);
      items.forEach(item => {
        if (item.type === 'folder') {
          const newFolder = currentFolder.folder(item.name);
          addToZip(item.id, newFolder);
        } else {
          const content = models[item.id] ? models[item.id].getValue() : item.content;
          currentFolder.file(item.name, content);
        }
      });
    };

    addToZip('root', zip);

    zip.generateAsync({ type: "blob" }).then(function (content) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(content);
      a.download = "workspace.zip";
      a.click();
    });
  } else {
    if (window.ideDialog) {
      window.ideDialog.toast("JSZip library is still loading...", "warning");
    }
  }
}

// Load directory entries from native OS folder picker or zip
function loadDirectoryEntries(folderName, entries) {
  if (!entries || !entries.length) return;

  // Clear existing monaco models
  Object.keys(models).forEach((id) => models[id] && models[id].dispose());
  models = window.models = {};
  fileSystem = window.fileSystem = [
    { id: "root", type: "folder", name: folderName || "workspace", parentId: null },
  ];

  const folderMap = { "": "root" };
  let firstFileId = null;

  // Pass 1: Build folder hierarchy
  for (const item of entries) {
    if (item.type !== "folder") continue;
    const parts = (item.relativePath || item.name).split(/[\/\\]/).filter(Boolean);
    let currentPath = "";
    let parentPath = "";
    for (let i = 0; i < parts.length; i++) {
      currentPath = parts.slice(0, i + 1).join("/");
      parentPath = parts.slice(0, i).join("/");
      if (!folderMap[currentPath]) {
        const folderId = generateId();
        folderMap[currentPath] = folderId;
        const parentId = folderMap[parentPath] || "root";
        fileSystem.push({ id: folderId, type: "folder", name: parts[i], parentId });
        expandedFolders.add(folderId);
      }
    }
  }

  // Pass 2: Load files
  for (const item of entries) {
    if (item.type !== "file") continue;
    const parts = (item.relativePath || item.name).split(/[\/\\]/).filter(Boolean);
    const fileName = parts.pop();
    const folderParts = parts;

    let currentPath = "";
    let parentPath = "";
    for (let i = 0; i < folderParts.length; i++) {
      currentPath = folderParts.slice(0, i + 1).join("/");
      parentPath = folderParts.slice(0, i).join("/");
      if (!folderMap[currentPath]) {
        const folderId = generateId();
        folderMap[currentPath] = folderId;
        const parentId = folderMap[parentPath] || "root";
        fileSystem.push({ id: folderId, type: "folder", name: folderParts[i], parentId });
        expandedFolders.add(folderId);
      }
    }

    const parentId = folderMap[folderParts.join("/")] || "root";
    const fileId = generateId();
    const content = typeof item.content === "string" ? item.content : "";

    fileSystem.push({
      id: fileId,
      type: "file",
      name: fileName,
      content,
      parentId,
      fsPath: item.path || "",
    });

    models[fileId] = monaco.editor.createModel(content, getLanguageFromExtension(fileName));
    if (!firstFileId) firstFileId = fileId;
  }

  if (firstFileId) {
    activeFileId = window.activeFileId = firstFileId;
    openTabs = window.openTabs = [firstFileId];
    if (editor && models[firstFileId]) {
      editor.setModel(models[firstFileId]);
      syncLanguageDropdown(fileSystem.find((f) => f.id === firstFileId)?.name);
    }
  }

  const badge = document.querySelector(".workspace-badge");
  if (badge && folderName) {
    badge.textContent = folderName;
  }

  renderTree();
  updateEditorTab();
  triggerAutoSave();
}

// Load a single file into the active workspace
function loadSingleFile(fileName, content, filePath) {
  const existing = fileSystem.find((f) => f.name === fileName && f.type === "file");
  if (existing) {
    if (models[existing.id]) {
      models[existing.id].setValue(content || "");
    }
    existing.content = content || "";
    existing.fsPath = filePath || "";
    switchToFile(existing.id);
  } else {
    const fileId = generateId();
    fileSystem.push({
      id: fileId,
      type: "file",
      name: fileName,
      content: content || "",
      parentId: "root",
      fsPath: filePath || "",
    });
    models[fileId] = monaco.editor.createModel(content || "", getLanguageFromExtension(fileName));
    switchToFile(fileId);
  }
  triggerAutoSave();
}

// Open folder: File System Access API with input fallback
async function importFolder() {
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      if (dirHandle) {
        const entries = [];
        async function readDir(handle, currentRel = "") {
          for await (const entry of handle.values()) {
            if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".gemini") {
              continue;
            }
            const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
            if (entry.kind === "directory") {
              entries.push({ name: entry.name, type: "folder", relativePath: rel });
              await readDir(entry, rel);
            } else if (entry.kind === "file") {
              try {
                const f = await entry.getFile();
                let content = "";
                if (f.size < 5 * 1024 * 1024) {
                  const ext = entry.name.split(".").pop().toLowerCase();
                  if (["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp"].includes(ext)) {
                    const reader = new FileReader();
                    content = await new Promise((r) => {
                      reader.onload = () => r(reader.result);
                      reader.readAsDataURL(f);
                    });
                  } else {
                    content = await f.text();
                  }
                }
                entries.push({
                  name: entry.name,
                  type: "file",
                  relativePath: rel,
                  content,
                  handle: entry,
                });
              } catch (_) { }
            }
          }
        }
        await readDir(dirHandle, "");
        if (entries.length > 0) {
          loadDirectoryEntries(dirHandle.name, entries);
          if (window.ideDialog) {
            window.ideDialog.toast(`Imported folder: ${dirHandle.name}`, "success");
          }
          return;
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return; // User cancelled
      console.warn("showDirectoryPicker fallback:", err);
    }
  }
  const input = document.getElementById("folderInput");
  if (input) input.click();
}

// Open file: File System Access API with input fallback
async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Supported Files (Code, Web & Images)",
            accept: {
              "text/*": [".js", ".ts", ".py", ".cpp", ".c", ".java", ".rs", ".go", ".html", ".css", ".json", ".md", ".txt", ".sql", ".sh", ".svg"],
              "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg"],
            },
          },
        ],
      });
      if (handle) {
        const file = await handle.getFile();
        const ext = file.name.split(".").pop().toLowerCase();
        let content = "";
        if (["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp"].includes(ext)) {
          const reader = new FileReader();
          content = await new Promise((r) => {
            reader.onload = () => r(reader.result);
            reader.readAsDataURL(file);
          });
        } else {
          content = await file.text();
        }
        loadSingleFile(file.name, content, file.name, handle);
        if (window.ideDialog) {
          window.ideDialog.toast(`Opened ${file.name}`, "info");
        }
        return;
      }
    } catch (err) {
      if (err.name === "AbortError") return; // User cancelled
      console.warn("showOpenFilePicker fallback:", err);
    }
  }
  const fileInput = document.getElementById("fileInput");
  if (fileInput) fileInput.click();
}

// Global Agent Actions interface to programmatically manipulate files, folders, and code
window.agentActions = {
  createFolder: (folderName, parentFolderName) => {
    if (!folderName) return 'root';
    let parentId = 'root';
    if (parentFolderName && parentFolderName !== 'root') {
      const parent = fileSystem.find(f => f.name === parentFolderName && f.type === 'folder');
      if (parent) parentId = parent.id;
    }
    let existing = fileSystem.find(f => f.name === folderName && f.parentId === parentId && f.type === 'folder');
    let folderId = existing ? existing.id : generateId();
    if (!existing) {
      fileSystem.push({ id: folderId, type: 'folder', name: folderName, parentId });
    }
    expandedFolders.add(folderId);
    renderTree();
    triggerAutoSave();
    return folderId;
  },

  createFile: (filename, content = '', folderName) => {
    if (!filename) return null;
    let parentId = 'root';
    if (folderName && folderName !== 'root') {
      const parent = fileSystem.find(f => f.name === folderName && f.type === 'folder');
      if (parent) {
        parentId = parent.id;
        expandedFolders.add(parent.id);
      } else {
        parentId = window.agentActions.createFolder(folderName, 'root');
      }
    }
    const existing = fileSystem.find(f => f.name === filename && f.parentId === parentId && f.type === 'file');
    if (existing) {
      if (models[existing.id]) {
        models[existing.id].setValue(content || "");
      }
      existing.content = content || "";
      activeFileId = window.activeFileId = existing.id;
      if (!openTabs.includes(existing.id)) openTabs.push(existing.id);
      if (editor && models[existing.id]) {
        editor.setModel(models[existing.id]);
        editor.layout();
      }
      syncLanguageDropdown(existing.name);
      renderTree();
      updateEditorTab();
      triggerAutoSave();
      return existing.id;
    }

    const newId = generateId();
    fileSystem.push({ id: newId, type: 'file', name: filename, content: content || "", parentId });
    models[newId] = monaco.editor.createModel(content || "", getLanguageFromExtension(filename));
    activeFileId = window.activeFileId = newId;
    if (!openTabs.includes(newId)) openTabs.push(newId);
    if (editor && models[newId]) {
      editor.setModel(models[newId]);
      editor.layout();
    }
    syncLanguageDropdown(filename);
    renderTree();
    updateEditorTab();
    triggerAutoSave();
    return newId;
  },

  writeCode: (filename, content) => {
    let targetFile = null;
    if (filename) {
      targetFile = fileSystem.find(f => f.name === filename && f.type === 'file');
    }
    if (!targetFile && activeFileId) {
      targetFile = fileSystem.find(f => f.id === activeFileId && f.type === 'file');
    }
    if (!targetFile) {
      targetFile = fileSystem.find(f => f.type === 'file');
    }

    if (targetFile && models[targetFile.id]) {
      models[targetFile.id].setValue(content || "");
      targetFile.content = content || "";
      activeFileId = window.activeFileId = targetFile.id;
      if (!openTabs.includes(targetFile.id)) openTabs.push(targetFile.id);
      if (editor) {
        editor.setModel(models[targetFile.id]);
        editor.layout();
      }
      syncLanguageDropdown(targetFile.name);
    } else if (editor) {
      editor.setValue(content || "");
    }
    renderTree();
    updateEditorTab();
    triggerAutoSave();
  }
};

// Export editor core functions to global window
window.addFile = addFile;
window.addFolder = addFolder;
window.deleteItem = deleteItem;
window.renameItem = renameItem;
window.moveItem = moveItem;
window.switchToFile = switchToFile;
window.exportFolder = exportFolder;
window.importFolder = importFolder;
window.openFile = openFile;
window.loadDirectoryEntries = loadDirectoryEntries;
window.loadSingleFile = loadSingleFile;

// Desktop Application Integration (Electron)
(function initDesktopApp() {
  if (typeof window === "undefined") return;

  const isElectron = Boolean(window.electronAPI && window.electronAPI.isElectron);

  if (isElectron) {
    document.body.classList.add("desktop-app");

    // Clean exit button behavior: prompt and close desktop window instead of web logout
    const exitBtn = document.getElementById("btn-exit");
    if (exitBtn) {
      exitBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await window.ideDialog.confirm({
          title: "Close Application",
          icon: "ri-logout-box-r-line",
          message: "Are you sure you want to close Personal Code Editor?",
          submitText: "Exit App",
          isDestructive: true,
        });
        if (ok) {
          window.hasUnsavedChanges = false;
          if (window.electronAPI && typeof window.electronAPI.quitApp === "function") {
            window.electronAPI.quitApp();
          } else {
            window.location.href = "/logout";
          }
        }
      });
    }

    // Switch User button behavior
    const switchUserBtn = document.getElementById("btn-switch-user");
    if (switchUserBtn) {
      switchUserBtn.addEventListener("click", async (e) => {
        if (window.hasUnsavedChanges) {
          e.preventDefault();
          e.stopPropagation();
          const ok = await window.ideDialog.confirm({
            title: "Switch User Profile",
            icon: "ri-user-shared-line",
            message: "You have unsaved changes in your workspace. Do you want to discard them and switch user?",
            submitText: "Discard & Switch",
            isDestructive: true,
          });
          if (!ok) return;
        }
        window.hasUnsavedChanges = false;
        window.location.href = "/DashboardCodeEditor?action=switch-user";
      });
    }

    // Connect native application menu bar triggers to web editor actions
    if (typeof window.electronAPI.onMenuAction === "function") {
      window.electronAPI.onMenuAction(async (action, _payload) => {
        switch (action) {
          case "newFile":
            addFile();
            break;
          case "newFolder":
            addFolder();
            break;
          case "openFile":
            openFile();
            break;
          case "openFolder":
            importFolder();
            break;
          case "saveWorkspace":
            if (typeof window.saveWorkspaceToMongoDB === "function") {
              window.saveWorkspaceToMongoDB();
            }
            break;
          case "saveLocalFile": {
            const currentItem = fileSystem.find((f) => f.id === activeFileId && f.type === "file");
            const content = editor ? editor.getValue() : (currentItem ? currentItem.content : "");
            const defaultName = currentItem ? currentItem.name : "script.js";
            if (typeof window.electronAPI.saveFileDialog === "function") {
              await window.electronAPI.saveFileDialog(content, defaultName);
            }
            break;
          }
          case "exportPDF":
            if (typeof window.exportToPDF === "function") {
              window.exportToPDF();
            }
            break;
          case "exportZIP":
            exportFolder();
            break;
          case "formatCode":
            if (typeof window.formatCode === "function") {
              window.formatCode();
            }
            break;
          case "runCode":
            if (typeof window.runCode === "function") {
              window.runCode();
            }
            break;
          case "clearConsole":
            if (typeof window.clearConsole === "function") {
              window.clearConsole();
            }
            break;
          case "openHtmlPreview":
            if (typeof window.openHtmlPreview === "function") {
              window.openHtmlPreview();
            }
            break;
          case "toggleExplorer":
            if (typeof window.togglePanel === "function") {
              window.togglePanel("explorer");
            }
            break;
          case "toggleTerminal":
            if (typeof window.togglePanel === "function") {
              window.togglePanel("terminal");
            }
            break;
          case "toggleAssistant":
            if (typeof window.togglePanel === "function") {
              window.togglePanel("assistant");
            }
            break;
          default:
            console.log("Unhandled menu action:", action);
        }
      });
    }
  }
})();

