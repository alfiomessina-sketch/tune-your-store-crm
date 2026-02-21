const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = 4000;

// ================= CONFIG =================
const AZURA_URL = "https://tuneyourstore.net/api";
const AZURA_API_KEY = "METTI_LA_TUA_API_KEY_QUI";
const OLLAMA_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3";

// ================= MEMORY =================
const memoryPath = path.join(__dirname, "memory.json");

function loadMemory() {
    if (!fs.existsSync(memoryPath)) {
        const base = {
            profile: {
                business_type: null,
                plan: null,
                role: "admin",
                payment: {
                    status: "trial",
                    billing_cycle: null,
                    next_due: null
                }
            }
        };
        fs.writeFileSync(memoryPath, JSON.stringify(base, null, 2));
        return base;
    }
    return JSON.parse(fs.readFileSync(memoryPath));
}

function saveMemory(data) {
    fs.writeFileSync(memoryPath, JSON.stringify(data, null, 2));
}

// ================= OLLAMA CALL =================
async function askOllama(prompt) {
    const res = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            prompt: prompt,
            stream: false
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
    }

    const data = await res.json();
    return data.response;
}

// ================= AI PROFILER =================
app.post("/aiProfile", async (req, res) => {
    try {
        const { description } = req.body;

        const prompt = `
Analizza questa attività commerciale:

"${description}"

Rispondi SOLO in JSON con questo formato:
{
 "business_type": "...",
 "recommended_plan": 29 | 69 | 159,
 "reason": "...",
 "upsell": "..."
}
`;

        const aiResponse = await askOllama(prompt);

        // Estrazione JSON dall'output
        const jsonStart = aiResponse.indexOf("{");
        const jsonEnd = aiResponse.lastIndexOf("}") + 1;
        const cleanJson = aiResponse.substring(jsonStart, jsonEnd);
        const parsed = JSON.parse(cleanJson);

        const memory = loadMemory();
        memory.profile.business_type = parsed.business_type;
        memory.profile.plan = parsed.recommended_plan;
        saveMemory(memory);

        res.json({
            reply: "Profilo generato da AI.",
            ai: parsed
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= STATUS =================
app.get("/status", (req, res) => {
    const memory = loadMemory();
    res.json(memory.profile);
});

// ================= SERVE DASHBOARD =================
app.use(express.static(__dirname));

// ================= START =================
app.listen(PORT, () => {
    console.log(`TYS CRM + AI attivo su http://localhost:${PORT}`);
});