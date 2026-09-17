import mongoose from "mongoose";



const createPdfs = async (req, res) => {
    try {
        const { userId, pdfName, pdfUrl } = req.body;

        // Create a new PDF document
        const newPdf = new (mongoose.model("Pdf"))({
            userId,
            pdfName,
            pdfUrl,
        });

        await newPdf.save();

        res.status(201).json({ message: "PDF created successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

export default createPdfs;