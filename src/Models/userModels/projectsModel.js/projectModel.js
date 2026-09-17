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
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

const Project = mongoose.models.Project || mongoose.model("Project", projectSchema);

export default Project;