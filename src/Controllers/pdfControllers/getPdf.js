import mongoose from "mongoose";


const getPdf = async (req, res) => {
    try {
        const { userId } = req.params;

        // Find all PDFs for the given userId
        const pdfs = await mongoose.model("Pdf").find({ userId });

        res.status(200).json(pdfs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

export default getPdf;