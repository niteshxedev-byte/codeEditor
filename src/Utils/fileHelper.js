import path from "path";
import fs from "fs";
import User from "../Models/userModels/userModels.js";

/**
 * Resolves the persistent userId from a decoded JWT payload.
 *
 * @param {Object} decodedUser - Decoded JWT payload
 * @returns {Promise<string|null>} - Resolved userId string or null
 */
export const resolveUserId = async (decodedUser) => {
    if (!decodedUser) return null;
    if (decodedUser.userId) return decodedUser.userId;
    if (decodedUser.email) {
        const dbUser = await User.findOne({ email: decodedUser.email });
        if (dbUser?.userId) return dbUser.userId;
    }
    return null;
};

/**
 * Safely removes an uploaded file from disk with strict path containment checks.
 *
 * @param {"projects"|"pdfs"} subDir - Allowed subfolder under uploads/
 * @param {string} fileUrl - Stored relative URL (e.g. /uploads/projects/file.zip)
 * @returns {Promise<boolean>} - True if file was deleted, false otherwise
 */
export const safeDeleteUpload = async (subDir, fileUrl) => {
    if (!fileUrl || typeof fileUrl !== "string") return false;

    // Strict whitelist of allowable subdirectories
    const ALLOWED_SUBDIRS = new Set(["projects", "pdfs"]);
    if (!ALLOWED_SUBDIRS.has(subDir)) {
        console.warn(`Unauthorized subfolder access attempt: ${subDir}`);
        return false;
    }

    try {
        const publicDir = path.resolve(process.cwd(), "src/public");
        const allowedDir = path.resolve(publicDir, "uploads", subDir) + path.sep;
        const cleanRelativePath = fileUrl.replace(/^\/+/, "");
        const targetFilePath = path.resolve(publicDir, cleanRelativePath);

        // Path Traversal Security Verification:
        // Ensures targetFilePath cannot escape allowedDir via directory traversal (e.g., ../)
        if (!targetFilePath.startsWith(allowedDir)) {
            console.warn(`Path traversal attempt blocked: ${fileUrl}`);
            return false;
        }

        if (fs.existsSync(targetFilePath)) {
            await fs.promises.unlink(targetFilePath);
            return true;
        }
    } catch (err) {
        console.warn(`Could not remove ${subDir} file from disk:`, err.message);
    }
    return false;
};

/**
 * Safely resolves and creates an isolated storage directory for a specific user and asset type.
 * Ensures strict separation between executable code workspaces and static document files.
 *
 * @param {string} userId - Sanitized user identifier
 * @param {"code"|"files"} type - Type of user asset ("code" for workspaces, "files" for PDFs/docs)
 * @returns {string} - Absolute path to user's isolated storage directory
 */
export const getUserStorageDir = (userId, type) => {
    if (!userId || typeof userId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
        throw new Error("Invalid userId for storage allocation");
    }
    const ALLOWED_TYPES = new Set(["code", "files"]);
    if (!ALLOWED_TYPES.has(type)) {
        throw new Error(`Invalid storage type: ${type}. Must be "code" or "files".`);
    }

    const storageRoot = path.resolve(process.cwd(), "storage/users", userId, type);
    if (!fs.existsSync(storageRoot)) {
        fs.mkdirSync(storageRoot, { recursive: true });
    }
    return storageRoot;
};

/**
 * Resolves an on-disk file path for a user's private asset with strict path containment checks.
 *
 * @param {string} userId - Owner's user identifier
 * @param {"code"|"files"} type - Asset category
 * @param {string} storedPathOrUrl - Stored path, endpoint URL, or filename
 * @returns {string|null} - Verified absolute path on disk, or null
 */
export const resolveUserStoragePath = (userId, type, storedPathOrUrl) => {
    if (!userId || !storedPathOrUrl || typeof storedPathOrUrl !== "string") return null;

    try {
        const userDir = getUserStorageDir(userId, type) + path.sep;
        const filename = path.basename(storedPathOrUrl);
        const resolvedPath = path.resolve(userDir, filename);

        // Path Traversal Security Verification
        if (!resolvedPath.startsWith(userDir)) {
            console.warn(`Path traversal blocked for user ${userId}: ${storedPathOrUrl}`);
            return null;
        }

        if (fs.existsSync(resolvedPath)) {
            return resolvedPath;
        }

        // Backward compatibility: check legacy public uploads location
        const legacySubDir = type === "code" ? "projects" : "pdfs";
        const publicDir = path.resolve(process.cwd(), "src/public/uploads", legacySubDir) + path.sep;
        const legacyPath = path.resolve(publicDir, filename);
        if (legacyPath.startsWith(publicDir) && fs.existsSync(legacyPath)) {
            return legacyPath;
        }
    } catch (err) {
        console.warn("Storage path resolution error:", err.message);
    }
    return null;
};

/**
 * Safely removes a user's code or file asset with path containment and legacy fallback.
 *
 * @param {string} userId - Owner's user identifier
 * @param {"code"|"files"} type - Asset category
 * @param {string} storedPathOrUrl - Stored path or URL
 * @returns {Promise<boolean>}
 */
export const safeDeleteUserStorage = async (userId, type, storedPathOrUrl) => {
    if (!userId || !storedPathOrUrl || typeof storedPathOrUrl !== "string") return false;

    try {
        const filePath = resolveUserStoragePath(userId, type, storedPathOrUrl);
        if (filePath && fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
            return true;
        }
    } catch (err) {
        console.warn(`Failed to delete user ${type} storage:`, err.message);
    }

    // Fallback: try legacy safeDeleteUpload
    const legacySubDir = type === "code" ? "projects" : "pdfs";
    return await safeDeleteUpload(legacySubDir, storedPathOrUrl);
};

export default {
    resolveUserId,
    getUserStorageDir,
    resolveUserStoragePath,
    safeDeleteUserStorage,
    safeDeleteUpload,
};
