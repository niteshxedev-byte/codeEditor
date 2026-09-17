import { ChatOllama } from "@langchain/ollama";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentExecutor, createToolCallingAgent } from "@langchain/classic/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import dotenv from "dotenv";

dotenv.config();

/**
 * A dead-simple AI agent with basic tools.
 * Perfect for learning or building custom non-editor tasks.
 */
export async function runSimpleAgent(promptText) {
  // 1. Initialize the model 
  // (Uses your environment variables or defaults to a free cloud model)
  const cloudUrl = (process.env.OLLAMA_URL || "https://ollama.com").replace(/\/$/, "");
  const cloudKey = process.env.OLLAMA_API_KEY || "";
  
  const llm = new ChatOllama({
    model: "gemma4:31b",
    baseUrl: cloudUrl,
    headers: cloudKey ? { Authorization: `Bearer ${cloudKey}` } : {},
    temperature: 0.1,
  });

  // 2. Define simple tools
  const tools = [
    new DynamicStructuredTool({
      name: "get_weather",
      description: "Get the current weather for a specific city.",
      schema: z.object({
        city: z.string().describe("The name of the city"),
      }),
      func: async ({ city }) => {
        if (city.toLowerCase() === "london") return "It is currently rainy and 12°C in London.";
        return `It is sunny and 22°C in ${city}.`;
      }
    }),
    
    new DynamicStructuredTool({
      name: "calculate_math",
      description: "Evaluate a mathematical expression safely.",
      schema: z.object({
        expression: z.string().describe("The math expression, e.g. 5 * 10"),
      }),
      func: async ({ expression }) => {
        try {
          // Note: In production, use a safe math parser instead of eval
          const result = eval(expression);
          return String(result);
          if (!/^[\d\s+\-*/%().]+$/.test(expression)) {
            return "Security Notice: Only basic numeric expressions are allowed.";
          }
          const compute = (expr) => {
            let terms = expr.split("+").map(sub => {
              let subTerms = sub.split("-").map(mul => {
                let factors = mul.split("*").map(div => {
                  let parts = div.split("/").map(Number);
                  return parts.reduce((a, b) => a / b);
                });
                return factors.reduce((a, b) => a * b);
              });
              return subTerms.reduce((a, b) => a - b);
            });
            return terms.reduce((a, b) => a + b);
          };

          let sanitized = expression.replace(/\s+/g, "");
          let iterations = 0;
          while (sanitized.includes("(") && iterations < 10) {
            sanitized = sanitized.replace(/\(([^()]+)\)/g, (_, inside) => compute(inside));
            iterations++;
          }
          return String(compute(sanitized));
        } catch (e) {
          return "Invalid math expression.";
        }
      }
    })
  ];

  // 3. Create the prompt instructions
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful, simple AI assistant. Always use your tools if the user asks for weather or math."],
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  // 4. Build the Agent
  const agent = createToolCallingAgent({ llm, tools, prompt });
  
  const agentExecutor = new AgentExecutor({ 
    agent, 
    tools, 
    maxIterations: 3,
    // Optional: add a callback here if you want to stream to the console
  });

  // 5. Execute
  console.log(`[SimpleAgent] Thinking about: "${promptText}"...`);
  try {
    const result = await agentExecutor.invoke({
      input: promptText
    });
    return result.output;
  } catch (error) {
    console.error("[SimpleAgent] Error:", error.message);
    return "Sorry, I ran into an error connecting to the model.";
  }
}

// Optional: If you run this file directly via `node src/Services/simpleAgent.service.js`
if (process.argv[1] === new URL(import.meta.url).pathname ) {
    runSimpleAgent("What is the weather in London? Also, what is 15 multiplied by 42?")
      .then(reply => console.log("\n[SimpleAgent] Final Answer:\n" + reply));
}
