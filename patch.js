import fs from "fs";
import path from "path";

export function getMemoryAndSkillsPrompt(memory = [], skills = []) {
  let memoryPrompt = "";
  for (const memFile of memory) {
    try {
      const content = fs.readFileSync(path.resolve(memFile), 'utf8');
      memoryPrompt += `\n\n--- MEMORY: ${memFile} ---\n${content}\n`;
    } catch (e) {
      console.warn(`[Agent] Failed to load memory file ${memFile}:`, e.message);
    }
  }

  let skillsPrompt = "";
  for (const skillPath of skills) {
    try {
      const fullPath = path.resolve(skillPath);
      if (!fs.existsSync(fullPath)) continue;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(fullPath);
        for (const file of files) {
          if (file.endsWith('.md') || file.endsWith('.txt')) {
            const content = fs.readFileSync(path.join(fullPath, file), 'utf8');
            skillsPrompt += `\n\n--- SKILL: ${file} ---\n${content}\n`;
          }
        }
      } else {
        const content = fs.readFileSync(fullPath, 'utf8');
        skillsPrompt += `\n\n--- SKILL: ${path.basename(fullPath)} ---\n${content}\n`;
      }
    } catch (e) {
      console.warn(`[Agent] Failed to load skill path ${skillPath}:`, e.message);
    }
  }
  return memoryPrompt + skillsPrompt;
}
