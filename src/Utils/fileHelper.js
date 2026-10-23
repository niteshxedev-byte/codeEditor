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

export default {
    resolveUserId,
    safeDeleteUpload,
};
