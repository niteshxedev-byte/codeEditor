import mongoose from "mongoose";

const pdfSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
    },
    pdfName: {
        type: String,
        required: true,
    },
    pdfUrl: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

const Pdf = mongoose.models.Pdf || mongoose.model("Pdf", pdfSchema);

export default Pdf;