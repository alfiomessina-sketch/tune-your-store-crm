const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = 4000;

// ================= CONFIG =================
const AZURA_URL = "https://tuneyourstore.net/api";
const AZURA_API_KEY = "2c95e5794a004630:cfb68f18d9f87c5d58e22d5df3d9f2ae";

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

// ================= PLAN LIMIT =================
function getPlanLimit(plan) {
    if (plan == 29) return 1;
    if (plan == 69) return 1;
    if (plan == 159) return 5;
    return 0;
}

// ================= AZURA CALL =================
async function azuraRequest(endpoint, method = "GET", body = null) {
    const options = {
        method: method,
        headers: {
            "Authorization": `Bearer ${AZURA_API_KEY}`,
            "Accept": "application/json"
        }
    };

    if (body) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    const res = await fetch(`${AZURA_URL}${endpoint}`, options);

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
    }

    return await res.json();
}

async function getAzuraStations() {
    return await azuraRequest("/admin/stations");
}

async function createAzuraStation(shortName, displayName) {
    return await azuraRequest("/admin/stations", "POST", {
        name: displayName,
        short_name: shortName,
        description: "Created by TYS CRM"
    });
}

async function setStationEnabled(stationId, enabled) {
    return await azuraRequest(`/admin/stations/${stationId}`, "PUT", {
        is_enabled: enabled
    });
}

// ================= AI CALL =================
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

// SET PROFILE MANUALE
app.post("/setProfile", (req, res) => {
    const { business_type, plan } = req.body;

    const memory = loadMemory();
    memory.profile.business_type = business_type;
    memory.profile.plan = plan;

    saveMemory(memory);
    res.json({ reply: "Profilo aggiornato" });
});

// CREATE STATION
app.post("/createStation", async (req, res) => {
    try {
        const memory = loadMemory();

        if (!memory.profile.business_type || !memory.profile.plan) {
            return res.json({ reply: "Profilo non configurato" });
        }

        if (memory.profile.payment.status === "unpaid") {
            return res.json({ reply: "Pagamento non attivo" });
        }

        const stations = await getAzuraStations();
        const prefix = `radio-${memory.profile.business_type}-`;

        const existing = stations.filter(s =>
            s.short_name.startsWith(prefix)
        );

        const limit = getPlanLimit(memory.profile.plan);

        if (existing.length >= limit) {
            return res.json({ reply: "Limite stazioni raggiunto" });
        }

        const nextIndex = existing.length + 1;
        const shortName = `${prefix}${nextIndex}`;
        const displayName = `Radio ${memory.profile.business_type} ${nextIndex}`;

        const newStation = await createAzuraStation(shortName, displayName);

        res.json({
            reply: "Stazione creata con successo",
            station_id: newStation.id
        });

} catch (err) {
    console.error("ERRORE CREATE STATION:", err);
    res.status(500).json({ error: err.message });
}});

// LIST STATIONS
app.get("/stations", async (req, res) => {
    try {
        const stations = await getAzuraStations();
        res.json(stations);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// STATUS
app.get("/status", (req, res) => {
    const memory = loadMemory();
    res.json(memory.profile);
});

// SERVE DASHBOARD
app.use(express.static(__dirname));

// START
app.listen(PORT, () => {
    console.log(`TYS CRM + AI STABILE su http://localhost:${PORT}`);
});