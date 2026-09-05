# Bhoomitra — AI Crop Intelligence for Smallholder Farms

Bhoomitra helps smallholder farmers detect crop diseases from a leaf photo, get a safe treatment recommendation, and act on it — down to physically running pumps on a real farm rig. Built for the national-level MSME hackathon.

## What it does

1. **AI disease detection** — upload a leaf photo; a MobileNetV2 model (trained on the 38-class PlantVillage dataset) identifies the crop and disease with a confidence score.
2. **Pest detection and prevention** — a trained YOLO26 detector locates and counts visible pests from 10 field-pest classes, draws bounding boxes, and produces a photo-level pressure cue. Each class has distinct scouting, prevention, lower-impact treatment, and crop-aware pesticide guidance. Model confidence is retained in the audit record but hidden from the farmer interface.
3. **Severity scoring + IPM recommendation** — confidence is mapped to a severity level, and the system looks up a treatment: active ingredient, dosage, spray interval, pre-harvest interval, resistance group, and an organic alternative. Low-confidence predictions deliberately get *no* pesticide recommendation — the farmer is told to retake the photo and consult local extension. The ML/offline catalog is always computed first and is the guaranteed fallback; when the internet is reachable and `GEMINI_API_KEY` is set, that same recommendation is optionally enhanced by a Google Gemini call that interprets the diagnosis together with live sensors, weather, and the leaf photo(s) — see `app/lib/llmRecommendationEngine.ts`. Any Gemini failure, timeout, or malformed response silently falls back to the ML recommendation.
4. **Farm map & zone monitoring** — the farm is divided into grid zones with live soil moisture, temperature, and humidity. Zones are color-coded by moisture thresholds, and a VPD (vapor pressure deficit) calculation gates spraying to the optimal weather window.
5. **Smart irrigation** — per-zone timed hydration cycles (10 min on / 50 min off), auto-stop on wet threshold, stuck-sensor detection, ripening-mode lockout, and a global "Hydrate" that targets only dry zones.
6. **Spread Control AI** — simulates disease spread across plots (BFS over the farm grid) and computes the best treatment plan under a budget (greedy optimization). See `SPREAD_CONTROL_GUIDE.md`.
7. **Multilingual UI** — English and Hindi across the prototype. See `MULTILINGUAL.md`.
8. **Safety first** — spraying is never an automatic ML side effect. Every spray requires explicit farmer confirmation, and a hardware kill switch blocks all commands.

## Architecture

```
Next.js 14 app (frontend + API routes, port 3000)
  ├── JSON-file database (app/data/db.json) — detections, sprays, activity log
  ├── Flask disease ML service (ml_service/, port 5000) — crop-disease classification
  ├── Flask pest ML service (pest_ml_service/, port 5001) — 10-class YOLO26 pest detection
  └── /api/sensor  ←→  hardware_bridge.py  ←→  ESP32 over USB serial
```

## Hardware rig (live demo)

The dashboard is wired to a physical rig:

- **ESP32** with a soil-moisture sensor and DHT11 (temperature/humidity)
- **Two relay-driven pumps** — one for irrigation, one for spraying
- **A servo** that aims the outlet: each grid zone has a fixed angle; on "Hydrate", the servo rotates to that zone, the pump runs for a few seconds, then the servo returns home

Data flow: the ESP32 prints sensor JSON over serial → `hardware_bridge.py` forwards it to `POST /api/sensor` → the server updates the zone and replies with any queued command (`WATER:A1`, `SPRAY:A1`, `STOP:A1`) → the bridge writes it back to the ESP32, which drives the servo and relays. When real sensor data arrives, the server automatically switches off simulation mode.

## Running it

Optional: create `.env.local` in the project root to enable Gemini-enhanced recommendations (the app works fully offline without it — recommendations then use the ML model only). The key is read server-side only; it is never sent to the browser and never logged:

```
GEMINI_API_KEY=your-key-here
# Optional overrides (defaults shown):
# GEMINI_RECOMMENDATION_MODEL=gemini-flash-lite-latest
# GEMINI_RECOMMENDATION_TIMEOUT_MS=6000
```

```bash
# 1. Frontend
npm install
npm run dev              # http://localhost:3000

# 2. ML service (separate terminal)
python -m venv ml_service/venv
ml_service/venv/Scripts/pip install -r ml_service/requirements.txt
ml_service/venv/Scripts/python ml_service/main.py    # port 5000

# 3. Pest detector service (separate terminal, Windows PowerShell)
py -3.11 -m venv pest_ml_service/.venv
& .\pest_ml_service\.venv\Scripts\python.exe -m pip install -r pest_ml_service\requirements.txt
& .\pest_ml_service\.venv\Scripts\python.exe pest_ml_service\main.py    # port 5001

# 4. (Optional) Hardware bridge — set your COM port in hardware_bridge.py
python hardware_bridge.py
```

The Windows launcher starts the leaf-disease service, pest service, and frontend after both Python environments are installed:

```powershell
scripts/start-demo.ps1
```

Log in with any account or use **Continue as Guest**. Sample leaf images for testing are in `ml_service/` (`leaf.jpg`, `corn.jpg`, `fire blight.jpg`, ...).

## Suggested demo walkthrough

### Pest-zone workflow

- Open **Pest Check**, select a farm zone and crop, and check a JPG, PNG or WEBP photo (up to 12 MB). Results save automatically; there is no separate follow-up mode.
- The same A1–A6 / B1–B6 layout shows the latest photo's pressure: red high, orange moderate, yellow low. Untested zones are white; inconclusive scans are grey and never count as pest-free.
- Click a tested zone to open its large result popup: retained photo and boxes, counts, pest-specific prevention and treatment, and dated history. **Check this zone again** prepares a fresh photo check.
- Confirm comparable plants/distance only when that is true. High → Moderate can then be labelled improving **in photos**, not an estimate of whole-field infestation. Different pests/crops or inconclusive results do not produce improvement claims.
- Green means a farmer explicitly inspected the plants and reported no visible pests after the latest inconclusive scan. A newer scan replaces this map state; the original observation is retained.
- New photos are private local runtime files in `app/data/pest-photos/` (git-ignored); metadata and confidence remain in `app/data/db.json`. Back up both together. Older records remain available but cannot show photos that were never stored. The local prototype's existing sign-in/guest session is required to reopen saved photos; it is not production-grade multi-farm authentication.
- English and Hindi are supported. Regression checks use an in-memory database and never add sample farm records: `node scripts/test-pest-followups.cjs`.

1. Log in as guest → dashboard overview
2. **Detection**: upload a diseased leaf → show confidence, severity, and the IPM treatment card
3. **Farm map**: point out live sensor zones, VPD spray window, then click **Hydrate** on a dry zone → the servo physically aims at that zone and the pump runs
4. **Spread Control**: simulate an outbreak and show the budget-optimized treatment plan
5. Flip the language selector between English and Hindi to show farmer accessibility

### Merge and run the new pest model

See [the owner AI handoff](docs/OWNER_AI_HANDOFF.md) for merge precautions, setup commands, model verification and acceptance checks. The trained YOLO26 checkpoint and its 10-class label file are included in Git; no Google Drive download or retraining is required.
