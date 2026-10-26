import mongoose from "mongoose";


const projectSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
    },
    projectName: {
        type: String,
        required: true,
    },
    projectUrl: {
        type: String,
        required: true,
    },
    projectDescription: {
        type: String,
        required: true,
    },
    projectProgrammingLanguage: {
        type: String,
        required: true,
    },
    storagePath: {
        type: String,
    },
    code: {
        type: String,
        default: "",
    },
    activeFileId: {
        type: String,
        default: null,
    },
    files: [
        {
            id: { type: String },
            name: { type: String, required: true },
            type: { type: String, enum: ["file", "folder"], default: "file" },
            parentId: { type: String, default: "root" },
            content: { type: String, default: "" },
        }
    ],
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

const Project = mongoose.models.Project || mongoose.model("Project", projectSchema);

export default Project;