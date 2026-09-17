// Enhanced Monaco Editor & File Explorer Logic

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

// Utility: Generate Unique ID
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Monaco Editor Initialization
window.addEventListener("DOMContentLoaded", () => {
  if (typeof require !== "undefined") {
    require(["vs/editor/editor.main"], function () {
      
      // Create models for initial files
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

      // Update file content in state when edited
      editor.onDidChangeModelContent(() => {
        const item = fileSystem.find(f => f.id === activeFileId);
        if (item && models[activeFileId]) {
          item.content = models[activeFileId].getValue();
        }
        if (window.hasUnsavedChanges !== undefined) {
          window.hasUnsavedChanges = true; // hook for editor.ejs
        }
      });

      renderTree();

      // Check if opening a saved project URL
      loadSavedProjectFromUrl();
    });
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
        const content = await file.text();
        const fileId = generateId();

        fileSystem.push({ id: fileId, type: 'file', name: fileName, content, parentId });
        models[fileId] = monaco.editor.createModel(content, getLanguageFromExtension(fileName));
        if (!firstFileId) firstFileId = fileId;
      }

      if (firstFileId) {
        activeFileId = window.activeFileId = firstFileId;
        if (editor) editor.setModel(models[firstFileId]);
      }
      renderTree();
    });
  }
});

async function loadSavedProjectFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const projectUrl = params.get("projectUrl");
  const projectName = params.get("name") || params.get("projectName");

  if (!projectUrl) return;

  try {
    const res = await fetch(projectUrl);
    if (!res.ok) throw new Error("Failed to fetch project archive");

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
      const content = await entry.async("string");
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
      if (editor) editor.setModel(models[firstFileId]);
    }

    if (projectName) {
      const badge = document.querySelector(".workspace-badge");
      if (badge) badge.textContent = projectName;
    }

    renderTree();
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

// Tree Operations
function addFile() {
  const name = prompt("Enter file name (e.g. script.js):");
  if (!name) return;
  
  // Decide parent: if a folder is active, put it there, else root
  let parentId = 'root';
  const activeItem = fileSystem.find(f => f.id === activeFileId);
  if (activeItem && activeItem.type === 'folder') {
    parentId = activeItem.id;
    expandedFolders.add(parentId);
  } else if (activeItem && activeItem.parentId !== 'root') {
    parentId = activeItem.parentId;
    expandedFolders.add(parentId);
  }

  const newId = generateId();
  fileSystem.push({ id: newId, type: 'file', name, content: '', parentId });
  models[newId] = monaco.editor.createModel('', getLanguageFromExtension(name));
  switchToFile(newId);
}

function addFolder() {
  const name = prompt("Enter folder name:");
  if (!name) return;
  
  let parentId = 'root';
  const activeItem = fileSystem.find(f => f.id === activeFileId);
  if (activeItem && activeItem.type === 'folder') {
    parentId = activeItem.id;
    expandedFolders.add(parentId);
  } else if (activeItem && activeItem.parentId !== 'root') {
    parentId = activeItem.parentId;
    expandedFolders.add(parentId);
  }

  const newId = generateId();
  fileSystem.push({ id: newId, type: 'folder', name, parentId });
  expandedFolders.add(newId);
  renderTree();
}

function deleteItem(id) {
  if (!confirm("Are you sure you want to delete this item?")) return;
  
  // Collect all ids to delete (including nested)
  const idsToDelete = new Set([id]);
  const collectChildren = (parentId) => {
    fileSystem.filter(f => f.parentId === parentId).forEach(child => {
      idsToDelete.add(child.id);
      if (child.type === 'folder') collectChildren(child.id);
    });
  };
  collectChildren(id);

  // Clean up models and openTabs
  idsToDelete.forEach(delId => {
    openTabs = openTabs.filter(tid => tid !== delId);
    if (models[delId]) {
      models[delId].dispose();
      delete models[delId];
    }
  });

  fileSystem = fileSystem.filter(f => !idsToDelete.has(f.id));

  // Reset active file if deleted
  if (idsToDelete.has(activeFileId)) {
    const fallback = openTabs.length > 0
      ? fileSystem.find(f => f.id === openTabs[openTabs.length - 1] && f.type === 'file')
      : fileSystem.find(f => f.type === 'file');

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
}

function renameItem(id) {
  const item = fileSystem.find(f => f.id === id);
  if (!item) return;
  const newName = prompt("Enter new name:", item.name);
  if (newName && newName !== item.name) {
    item.name = newName;
    if (item.type === 'file' && models[id]) {
      monaco.editor.setModelLanguage(models[id], getLanguageFromExtension(newName));
    }
    renderTree();
  }
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
    return `
      <div class="editor-tab ${isActive ? 'active' : ''}" data-tab-id="${file.id}" title="${file.name}">
        <i class="ri-file-code-line" style="color:${getIconColor(file.name)}; font-size:13px;"></i>
        <span>${file.name}</span>
        <i class="ri-close-line tab-close-icon" data-close-id="${file.id}" title="Close Tab"></i>
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
    alert("JSZip library is still loading...");
  }
}

// Ensure the HTML file input exists in your DOM
function importFolder() {
  const input = document.getElementById("folderInput");
  if (input) input.click();
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
  }
};

