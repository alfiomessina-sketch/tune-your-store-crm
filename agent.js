const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = 4000;

// ================= CONFIG =================
const ORCH_URL = "http://localhost:3000";
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
                client_id: null,
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

// ================= HTTP HELPER =================
async function httpPost(url, body) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
    }

    return await res.json();
}

async function httpGet(url) {
    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
    }
    return await res.json();
}

// ================= AI =================
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

    const data = await res.json();
    return data.response;
}

// ================= ROUTES =================

// AI PROFILE
app.post("/aiProfile", async (req, res) => {
    try {
        const { description } = req.body;

        const prompt = `
Analizza questa attività:
"${description}"

Rispondi SOLO in JSON:
{
 "business_type": "...",
 "recommended_plan": 29 | 69 | 159,
 "reason": "...",
 "upsell": "..."
}
`;

        const aiResponse = await askOllama(prompt);

        const jsonStart = aiResponse.indexOf("{");
        const jsonEnd = aiResponse.lastIndexOf("}") + 1;
        const parsed = JSON.parse(aiResponse.substring(jsonStart, jsonEnd));

        const memory = loadMemory();
        memory.profile.business_type = parsed.business_type;
        memory.profile.plan = parsed.recommended_plan;
        saveMemory(memory);

        res.json({ reply: "AI Profilo aggiornato", ai: parsed });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE CLIENT SU ORCHESTRATOR
app.post("/createClient", async (req, res) => {
    try {
        const memory = loadMemory();

        if (!memory.profile.business_type || !memory.profile.plan) {
            return res.json({ reply: "Profilo non configurato" });
        }

        const clientData = {
            name: memory.profile.business_type,
            email: null,
            plan: memory.profile.plan
        };

        const result = await httpPost(`${ORCH_URL}/api/clients`, clientData);

        memory.profile.client_id = result.client_id;
        memory.profile.payment.status = "paid";
        saveMemory(memory);

        res.json({
            reply: "Cliente creato su Orchestrator",
            client_id: result.client_id
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE STATION (TRAMITE ORCHESTRATOR)
app.post("/createStation", async (req, res) => {
    try {
        const memory = loadMemory();

        if (!memory.profile.client_id) {
            return res.json({ reply: "Cliente non creato su Orchestrator" });
        }

        if (memory.profile.payment.status === "unpaid") {
            return res.json({ reply: "Pagamento non attivo" });
        }

        const result = await httpPost(
            `${ORCH_URL}/api/clients/${memory.profile.client_id}/create-station`,
            {}
        );

        res.json({
            reply: result.message,
            station_id: result.station_id || null
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// LIST STATIONS (DAL MOTORE)
app.get("/stations", async (req, res) => {
    try {
        const data = await httpGet(`${ORCH_URL}/api/stations`);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// STATUS
app.get("/status", (req, res) => {
    const memory = loadMemory();
    res.json(memory.profile);
});

// DASHBOARD
app.use(express.static(__dirname));

// START
app.listen(PORT, () => {
    console.log(`AGENT collegato a Orchestrator su http://localhost:${PORT}`);
});