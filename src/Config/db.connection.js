import mongoose from "mongoose";

let connectionPromise = null;

async function connectDB(uri) {
  const mongoUri = uri || process.env.MONGO_URI;

  if (!mongoUri || typeof mongoUri !== "string" || !mongoUri.trim()) {
    console.error("==========================================================================");
    console.error("CRITICAL ERROR: MONGO_URI is not defined in environment variables!");
    console.error("MongoDB will not connect. Authentication and workspace storage will fail.");
    console.error("Please add MONGO_URI to your .env file or Docker/Coolify environment.");
    console.error("==========================================================================");
    return false;
  }

  if (mongoose.connection.readyState === 1) {
    return true; // Already connected
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      // Setup event listeners once
      if (mongoose.connection.listenerCount("error") === 0) {
        mongoose.connection.on("error", (err) => {
          console.error("[MongoDB Error]:", err.message);
        });
        mongoose.connection.on("disconnected", () => {
          console.warn("[MongoDB Warning]: Connection disconnected. Retrying...");
        });
        mongoose.connection.on("reconnected", () => {
          console.log("[MongoDB Info]: Reconnected successfully.");
        });
      }

      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 8000, // Timeout after 8 seconds instead of hanging 30s
        autoIndex: true,
      });

      console.log("[MongoDB]: Connected successfully to database.");
      return true;
    } catch (error) {
      console.error("==========================================================================");
      console.error("[MongoDB Connection Failed]:", error.message);
      if (error.name === "MongooseServerSelectionError") {
        console.error("CAUSE: Could not reach MongoDB Atlas cluster.");
        console.error("TROUBLESHOOTING CHECKLIST:");
        console.error("  1. Check MongoDB Atlas -> Network Access -> IP Access List.");
        console.error("  2. Add your server's IP or allow 0.0.0.0/0 (Allow access from anywhere).");
        console.error("  3. Verify your database username and password in MONGO_URI.");
        console.error("==========================================================================");
      }
      return false;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

export default connectDB;
