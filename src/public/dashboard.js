/**
 * dashboard.js
 * Client-side workspace and document management for Personal Code Editor Dashboard.
 * Handles modals, rename actions, delete confirmations, live counter updates, and toasts.
 */

(function () {
    "use strict";

    // DOM Elements
    const renameDialog = document.getElementById("renameDialog");
    const renameForm = document.getElementById("renameForm");
    const renameItemId = document.getElementById("renameItemId");
    const renameItemType = document.getElementById("renameItemType");
    const renameInput = document.getElementById("renameInput");
    const renameDialogTitle = document.getElementById("renameDialogTitle");
    const renameError = document.getElementById("renameError");
    const saveRenameBtn = document.getElementById("saveRenameBtn");

    const deleteDialog = document.getElementById("deleteDialog");
    const deleteDialogTitle = document.getElementById("deleteDialogTitle");
    const deleteItemName = document.getElementById("deleteItemName");
    const deleteError = document.getElementById("deleteError");
    const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

    const toastContainer = document.getElementById("toastContainer");

    let pendingDelete = { type: null, id: null };

    /**
     * Displays an ephemeral, accessible toast notification.
     * @param {string} msg - Notification message text
     */
    function showToast(msg) {
        if (!toastContainer) return;

        const toast = document.createElement("div");
        toast.className =
            "bg-surface border border-edge text-snow font-mono text-xs px-4 py-2.5 rounded-sm shadow-xl flex items-center gap-2 pointer-events-auto transition-all duration-300 opacity-0 translate-y-2";

        const dot = document.createElement("span");
        dot.className = "w-1.5 h-1.5 rounded-full bg-blue flex-shrink-0";

        const text = document.createElement("span");
        text.textContent = msg;

        toast.appendChild(dot);
        toast.appendChild(text);
        toastContainer.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.remove("opacity-0", "translate-y-2");
            toast.classList.add("opacity-100", "translate-y-0");
        });

        setTimeout(() => {
            toast.classList.remove("opacity-100", "translate-y-0");
            toast.classList.add("opacity-0", "translate-y-2");
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }

    /**
     * Opens the rename modal pre-populated with current item details.
     */
    function openRenameModal(type, id, name) {
        if (!renameDialog) return;
        renameItemId.value = id;
        renameItemType.value = type;
        renameInput.value = name;
        renameDialogTitle.textContent = type === "project" ? "Rename Workspace" : "Rename Document";
        renameError.textContent = "";
        renameError.classList.add("hidden");
        saveRenameBtn.disabled = false;
        saveRenameBtn.textContent = "Save Changes";
        renameDialog.showModal();
        renameInput.focus();
        renameInput.select();
    }

    /**
     * Opens the delete confirmation modal.
     */
    function openDeleteModal(type, id, name) {
        if (!deleteDialog) return;
        pendingDelete = { type, id };
        deleteDialogTitle.textContent = type === "project" ? "Delete Workspace" : "Delete Document";
        deleteItemName.textContent = `"${name}"`;
        deleteError.textContent = "";
        deleteError.classList.add("hidden");
        confirmDeleteBtn.disabled = false;
        confirmDeleteBtn.textContent = "Delete Permanently";
        deleteDialog.showModal();
    }

    /**
     * Event delegation for Rename and Delete buttons on cards.
     */
    document.addEventListener("click", (e) => {
        const renameBtn = e.target.closest(".btn-rename");
        if (renameBtn) {
            const id = renameBtn.dataset.id;
            const type = renameBtn.dataset.type;
            const name = renameBtn.dataset.name;
            openRenameModal(type, id, name);
            return;
        }

        const deleteBtn = e.target.closest(".btn-delete");
        if (deleteBtn) {
            const id = deleteBtn.dataset.id;
            const type = deleteBtn.dataset.type;
            const name = deleteBtn.dataset.name;
            openDeleteModal(type, id, name);
            return;
        }
    });

    // Close modals on cancel button click
    document.getElementById("cancelRenameBtn")?.addEventListener("click", () => renameDialog?.close());
    document.getElementById("closeRenameDialogBtn")?.addEventListener("click", () => renameDialog?.close());
    document.getElementById("cancelDeleteBtn")?.addEventListener("click", () => deleteDialog?.close());
    document.getElementById("closeDeleteDialogBtn")?.addEventListener("click", () => deleteDialog?.close());

    // Close on backdrop click
    [renameDialog, deleteDialog].forEach((dlg) => {
        if (!dlg) return;
        dlg.addEventListener("click", (e) => {
            const rect = dlg.getBoundingClientRect();
            const isInDialog =
                rect.top <= e.clientY &&
                e.clientY <= rect.top + rect.height &&
                rect.left <= e.clientX &&
                e.clientX <= rect.left + rect.width;
            if (!isInDialog) {
                dlg.close();
            }
        });
    });

    /**
     * Handles Rename form submission.
     */
    renameForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = renameItemId.value;
        const type = renameItemType.value;
        const newName = renameInput.value.trim();

        if (!newName) {
            renameError.textContent = "Name cannot be empty.";
            renameError.classList.remove("hidden");
            return;
        }

        if (newName.length > 100) {
            renameError.textContent = "Name cannot exceed 100 characters.";
            renameError.classList.remove("hidden");
            return;
        }

        saveRenameBtn.disabled = true;
        saveRenameBtn.textContent = "Saving...";
        renameError.classList.add("hidden");

        try {
            const endpoint =
                type === "project"
                    ? `/api/projects/${encodeURIComponent(id)}`
                    : `/api/pdfs/${encodeURIComponent(id)}`;

            const res = await fetch(endpoint, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newName }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to rename item");
            }

            if (type === "project") {
                const card = document.getElementById(`project-card-${id}`);
                if (card) {
                    const nameEl = card.querySelector(".project-name-text");
                    if (nameEl) nameEl.textContent = data.project.projectName;

                    const openLink = card.querySelector(".project-open-link");
                    if (openLink) {
                        openLink.href = `/editor?projectId=${id}&name=${encodeURIComponent(data.project.projectName)}`;
                    }

                    card.querySelectorAll(".btn-rename, .btn-delete").forEach((btn) => {
                        btn.dataset.name = data.project.projectName;
                    });

                    card.classList.add("border-blue");
                    setTimeout(() => card.classList.remove("border-blue"), 1500);
                }
                showToast("Workspace renamed successfully");
            } else {
                const card = document.getElementById(`pdf-card-${id}`);
                if (card) {
                    const nameEl = card.querySelector(".pdf-name-text");
                    if (nameEl) nameEl.textContent = data.pdf.pdfName;

                    card.querySelectorAll(".btn-rename, .btn-delete").forEach((btn) => {
                        btn.dataset.name = data.pdf.pdfName;
                    });

                    card.classList.add("border-blue");
                    setTimeout(() => card.classList.remove("border-blue"), 1500);
                }
                showToast("Document renamed successfully");
            }

            renameDialog.close();
        } catch (err) {
            renameError.textContent = err.message || "An error occurred";
            renameError.classList.remove("hidden");
        } finally {
            saveRenameBtn.disabled = false;
            saveRenameBtn.textContent = "Save Changes";
        }
    });

    /**
     * Handles confirmed Delete execution.
     */
    confirmDeleteBtn?.addEventListener("click", async () => {
        const { type, id } = pendingDelete;
        if (!type || !id) return;

        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.textContent = "Deleting...";
        deleteError.classList.add("hidden");

        try {
            const endpoint =
                type === "project"
                    ? `/api/projects/${encodeURIComponent(id)}`
                    : `/api/pdfs/${encodeURIComponent(id)}`;

            const res = await fetch(endpoint, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to delete item");
            }

            deleteDialog.close();

            const cardId = type === "project" ? `project-card-${id}` : `pdf-card-${id}`;
            const card = document.getElementById(cardId);
            if (card) {
                card.style.transition = "opacity 0.2s ease, transform 0.2s ease";
                card.style.opacity = "0";
                card.style.transform = "scale(0.95)";
                setTimeout(() => {
                    card.remove();
                    updateCountsAndEmptyState(type);
                }, 200);
            }

            showToast(type === "project" ? "Workspace deleted" : "Document deleted");
        } catch (err) {
            deleteError.textContent = err.message || "An error occurred";
            deleteError.classList.remove("hidden");
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.textContent = "Delete Permanently";
        }
    });

    /**
     * Updates badge counts in headers and injects empty state if all items were removed.
     */
    function updateCountsAndEmptyState(type) {
        if (type === "project") {
            const list = document.getElementById("workspaces-list");
            const remaining = list ? list.querySelectorAll('[data-type="project"]').length : 0;
            const countBadge = document.getElementById("workspaces-count");
            if (countBadge) countBadge.textContent = `(${remaining})`;

            if (remaining === 0 && list) {
                const emptyDiv = document.createElement("div");
                emptyDiv.id = "workspaces-empty-state";
                emptyDiv.className =
                    "border border-dashed border-edge p-6 rounded-sm text-center space-y-2";

                const p = document.createElement("p");
                p.className = "text-xs font-mono text-muted";
                p.textContent = "No workspaces saved yet.";

                const a = document.createElement("a");
                a.href = "/editor";
                a.className = "inline-block font-mono text-xs text-blue hover:underline";
                a.textContent = "+ Create in editor";

                emptyDiv.appendChild(p);
                emptyDiv.appendChild(a);
                list.appendChild(emptyDiv);
            }
        } else {
            const list = document.getElementById("pdfs-list");
            const remaining = list ? list.querySelectorAll('[data-type="pdf"]').length : 0;
            const countBadge = document.getElementById("pdfs-count");
            if (countBadge) countBadge.textContent = `(${remaining})`;

            if (remaining === 0 && list) {
                const emptyDiv = document.createElement("div");
                emptyDiv.id = "pdfs-empty-state";
                emptyDiv.className =
                    "border border-dashed border-edge p-6 rounded-sm text-center space-y-2";

                const p = document.createElement("p");
                p.className = "text-xs font-mono text-muted";
                p.textContent = "No exports generated yet.";

                const span = document.createElement("span");
                span.className = "font-mono text-2xs text-muted/60";
                span.textContent = "Export code to PDF from the editor toolbar.";

                emptyDiv.appendChild(p);
                emptyDiv.appendChild(span);
                list.appendChild(emptyDiv);
            }
        }
    }

    // Application Exit & Logout Handling
    const dashExitBtn = document.getElementById("dashboard-exit-btn");
    if (dashExitBtn) {
        dashExitBtn.addEventListener("click", (e) => {
            e.preventDefault();
            window.location.href = "/logout";
        });
    }

    // Switch User: redirects to login screen
    const btnSwitchUser = document.getElementById("btn-switch-user");
    if (btnSwitchUser) {
        btnSwitchUser.addEventListener("click", (e) => {
            e.preventDefault();
            window.location.href = "/login?force=true";
        });
    }
})();
