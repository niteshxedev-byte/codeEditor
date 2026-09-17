import {connect} from "mongoose";




 async function  connectDB(x) {
   try { await connect(x, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log("Connected to MongoDB");
     }
   catch (error) {
       console.error("Error connecting to MongoDB:", error);
     }  
}

export default connectDB;