/**
 * Online LLM-enhanced recommendation path — Google Gemini.
 *
 * This module is entirely additive to the existing ML/offline recommendation
 * engine (app/lib/mlProcessor.ts + app/api/recommendations/route.ts). It is
 * never the source of truth for disease detection, chemical selection, or any
 * safety-gated action — the ML model and the farm decision engine remain
 * authoritative for those. This module only asks Gemini to interpret the
 * ML diagnosis plus live sensor/weather/image context into a more
 * contextual, farmer-facing explanation and action plan.
 *
 * Design:
 *  - Offline-first: if there is no internet, or no API key configured, or the
 *    call fails/times out/returns malformed output, callers fall back to the
 *    existing ML-only recommendation untouched. This module never throws.
 *  - No secrets in code: the API key comes only from process.env and is only
 *    ever used server-side (this file is only imported from API route code,
 *    never from a "use client" component) — it is never sent to the browser
 *    and never logged.
 */

import { GoogleGenAI, Type, type Schema } from "@google/genai"

// "gemini-2.5-flash" (and other "2.5"/"lite" non-"latest" ids) return HTTP 404
// ("no longer available to new users") for newer API keys — verified against
// the live API. "gemini-flash-lite-latest" is the current fast, non-thinking
// model that reliably returns structured JSON well within budget; verified
// with real text+image requests against the live API (see PR/testing notes).
const GEMINI_MODEL = process.env.GEMINI_RECOMMENDATION_MODEL ?? "gemini-flash-lite-latest"
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_RECOMMENDATION_TIMEOUT_MS) || 6000
// Some Gemini model families (e.g. "gemini-3.x-flash") spend a large, variable
// share of maxOutputTokens on hidden "thinking" tokens before the visible JSON
// — too small a budget truncates the response before it ever produces the
// answer (finishReason "MAX_TOKENS", empty response.text). 1024 comfortably
// covers the ~200-260 output tokens measured for this 9-field schema on the
// default non-thinking model, with headroom if a thinking-capable model is
// configured instead.
const GEMINI_MAX_OUTPUT_TOKENS = 1024

// A lightweight, low-data connectivity probe against the same host Gemini
// itself is called on — this is what we actually need to know is reachable,
// not general internet health. It never sends farm data.
const CONNECTIVITY_CHECK_URL =
  process.env.LLM_CONNECTIVITY_CHECK_URL ?? "https://generativelanguage.googleapis.com/"
const CONNECTIVITY_TIMEOUT_MS = 2500

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY)
}

/**
 * Best-effort internet check. Never throws; false means "assume offline".
 *
 * Any HTTP response (even a 404/403 with no API key attached) proves the
 * network path to the host is up — that's all this needs to confirm. Only a
 * thrown error (DNS failure, connection refused, or the abort timeout) means
 * "treat as offline". Checking `res.ok` here was measured to produce false
 * negatives: a plain, healthy connection can still return a non-2xx status
 * on an unauthenticated probe request.
 */
export async function isInternetAvailable(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS)
  try {
    await fetch(CONNECTIVITY_CHECK_URL, { signal: controller.signal, cache: "no-store" })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export const RECOMMENDATION_SYSTEM_PROMPT = `You are Bhoomitra's agricultural treatment-recommendation assistant. You produce a practical, concise, actionable recommendation for a smallholder farmer, based ONLY on the farm data supplied to you in the user message.

Ground rules:
1. You will be given three kinds of information — treat them differently:
   - "observed_data": real sensor and weather readings (soil moisture, temperature, humidity, VPD, wind, rainfall, zone info). Treat these as facts.
   - "ml_prediction": the disease diagnosis and confidence score already produced by Bhoomitra's trained ML model. This is the primary, authoritative disease-detection source. Do NOT re-diagnose the photo(s) yourself and do NOT override this diagnosis — your job is to interpret it in context, not replace it.
   - Everything else you produce is "your own recommendation": practical guidance synthesized from the above.
2. Consider ALL of the provided inputs together (the ML diagnosis AND the sensor readings AND the weather AND the zone context) — never base the recommendation on a single field in isolation.
3. NEVER invent sensor readings, disease names, confidence values, zone identifiers, or any other fact that was not explicitly provided to you. If a value is missing or marked "not available", say so plainly instead of guessing.
4. One or more leaf/plant photos of the same zone may be attached. Use them only as supporting visual evidence for the ML model's stated diagnosis (e.g. to comment on visible severity, spread pattern, or affected leaf area across the photos) — never state a different disease than the one given in ml_prediction, even if a photo looks ambiguous. If no photo is attached, rely only on the text data.
5. Be concise and practical. Write for a farmer, not an agronomist: short sentences, concrete actions, no jargon without explanation.
6. Return ONLY machine-readable JSON matching the supplied response schema — no markdown, no commentary, no text outside the JSON object. Every field is a string:
   - "diagnosis": restate the ML-provided disease/crop diagnosis in plain language (do not invent a different one)
   - "confidence": restate the provided ML confidence and what it means in practice (e.g. "high confidence, 87%")
   - "severity": low | moderate | high, matching the provided severity unless the combined evidence clearly supports a different practical urgency — explain if you differ
   - "recommended_action": the single most important next action, in one sentence
   - "treatment": concrete treatment guidance consistent with the ML/offline treatment data provided — do not invent a chemical or dosage that was not given to you
   - "timing": when to act, accounting for the supplied weather/wind/rain data
   - "weather_consideration": how the supplied weather/soil/humidity data affects this recommendation
   - "reasoning": a short explanation of how you combined the ML diagnosis with the sensor, weather, and photo evidence to reach this recommendation
   - "safety_notes": any safety precautions relevant to the treatment or conditions, or "None beyond standard PPE" if nothing specific applies`

export interface LLMFarmContext {
  zoneId: string
  crop: string
  disease: string
  mlConfidencePct: number
  severity: "low" | "moderate" | "high"
  mlChemical?: string
  mlDosage?: string
  mlOrganicAlternative?: string
  soilMoisturePct?: number | null
  temperatureC?: number | null
  humidityPct?: number | null
  vpdKpa?: number | null
  vpdBand?: string | null
  weatherDescription?: string | null
  windSpeedKmh?: number | null
  windDirectionDeg?: number | null
  nextRainHours?: number | null
  totalRain24hMm?: number | null
  fungalPressureBand?: string | null
  sprayWindowSafeNow?: boolean | null
  /** Zero or more leaf/plant photos for this zone/detection, most recent first. */
  photos: { base64: string; mimeType: string }[]
}

export interface LLMStructuredRecommendation {
  diagnosis: string
  confidence: string
  severity: string
  recommended_action: string
  treatment: string
  timing: string
  weather_consideration: string
  reasoning: string
  safety_notes: string
}

const REQUIRED_FIELDS: (keyof LLMStructuredRecommendation)[] = [
  "diagnosis",
  "confidence",
  "severity",
  "recommended_action",
  "treatment",
  "timing",
  "weather_consideration",
  "reasoning",
  "safety_notes",
]

// Asks Gemini's structured-output mode to shape the response for us. This is
// a reliability aid, not a substitute for validateLLMRecommendation() below —
// the raw response is always re-validated before it ever reaches the UI.
const GEMINI_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, { type: Type.STRING }])),
  required: REQUIRED_FIELDS as string[],
}

/** Strips accidental markdown fences and extracts the first JSON object. */
function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : text).trim()
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  return candidate.slice(start, end + 1)
}

/** Validates the LLM output against the fixed schema. Never throws. */
export function validateLLMRecommendation(raw: string): LLMStructuredRecommendation | null {
  try {
    const jsonText = extractJsonObject(raw)
    if (!jsonText) return null
    const parsed = JSON.parse(jsonText)
    if (!parsed || typeof parsed !== "object") return null

    const result: Record<string, string> = {}
    for (const field of REQUIRED_FIELDS) {
      const value = parsed[field]
      if (typeof value !== "string" || value.trim().length === 0) return null
      result[field] = value.trim()
    }
    return result as unknown as LLMStructuredRecommendation
  } catch {
    return null
  }
}

function buildContents(context: LLMFarmContext) {
  const farmData = {
    zone: { id: context.zoneId, crop: context.crop },
    observed_data: {
      soil_moisture_percent: context.soilMoisturePct ?? "not available",
      temperature_celsius: context.temperatureC ?? "not available",
      humidity_percent: context.humidityPct ?? "not available",
      vpd_kpa: context.vpdKpa ?? "not available",
      vpd_band: context.vpdBand ?? "not available",
      weather_description: context.weatherDescription ?? "not available",
      wind_speed_kmh: context.windSpeedKmh ?? "not available",
      wind_direction_deg: context.windDirectionDeg ?? "not available",
      hours_until_next_rain: context.nextRainHours ?? "no rain expected in forecast window",
      expected_rain_next_24h_mm: context.totalRain24hMm ?? "not available",
      fungal_disease_pressure_band: context.fungalPressureBand ?? "not available",
      spray_window_safe_now: context.sprayWindowSafeNow ?? "not available",
    },
    ml_prediction: {
      disease: context.disease,
      confidence_percent: context.mlConfidencePct,
      severity: context.severity,
      offline_recommended_chemical: context.mlChemical ?? "not specified by the offline catalog",
      offline_dosage: context.mlDosage ?? "not specified by the offline catalog",
      offline_organic_alternative: context.mlOrganicAlternative ?? "not specified",
    },
    photo_count: context.photos.length,
  }

  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
    { text: `Farm data (JSON). Use only these facts:\n${JSON.stringify(farmData, null, 2)}` },
  ]
  for (const photo of context.photos) {
    parts.push({ inlineData: { mimeType: photo.mimeType, data: photo.base64 } })
  }

  return [{ role: "user" as const, parts }]
}

export type LLMRecommendationResult =
  | { ok: true; data: LLMStructuredRecommendation }
  | { ok: false; reason: "not_configured" | "network_error" | "timeout" | "invalid_response" }

/** Calls Gemini and validates its output. Never throws — always resolves. */
export async function requestGeminiRecommendation(context: LLMFarmContext): Promise<LLMRecommendationResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { ok: false, reason: "not_configured" }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    const client = new GoogleGenAI({ apiKey })
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildContents(context),
      config: {
        systemInstruction: RECOMMENDATION_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        abortSignal: controller.signal,
      },
    })

    const text = response.text
    if (!text) return { ok: false, reason: "invalid_response" }

    const validated = validateLLMRecommendation(text)
    if (!validated) return { ok: false, reason: "invalid_response" }

    return { ok: true, data: validated }
  } catch (err: any) {
    if (err?.name === "AbortError" || controller.signal.aborted) return { ok: false, reason: "timeout" }
    return { ok: false, reason: "network_error" }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Detection-time "complete analysis" — used by the Disease/Pest (and future
 * nutrient-deficiency) detection result screens, called once right after the
 * ML model finishes classifying the just-uploaded image. This is a second
 * capability of the SAME Gemini integration above (same client construction,
 * same connectivity check, same JSON-extraction/validation approach, same
 * "ML is authoritative, Gemini only enhances" contract) — not a second
 * implementation. It uses its own prompt/schema because the detection-result
 * screens need a richer, multi-section analysis than the recommendations
 * feed's single-paragraph fields, and changing that existing schema would
 * risk breaking the already-shipped Recommendations page.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Where a detection-result screen's analysis came from — mirrors the recommendations feed's three states. */
export type GeminiAnalysisSource = "ml-offline" | "gemini" | "ml-fallback"

export const DETECTION_ANALYSIS_SYSTEM_PROMPT = `You are Bhoomitra's field-diagnosis assistant. A farmer just photographed a crop/leaf and Bhoomitra's trained ML model has already classified it. You produce a complete, farmer-friendly analysis based ONLY on the image and the structured farm data supplied in the user message — you enhance the ML result, you do not replace it.

Ground rules:
1. "ml_prediction" (the detected issue, its confidence, and severity) is the primary, authoritative diagnosis, already produced by Bhoomitra's trained model. Do NOT diagnose a different issue than the one given, even if the image looks ambiguous — your job is to interpret and explain it, not override it.
2. "observed_data" is real sensor/weather data (soil moisture, temperature, humidity, VPD, wind, rainfall). Treat it as fact.
3. NEVER invent sensor readings, confidence values, chemical names, dosages, or any other fact not explicitly provided. If something is missing or marked "not available", say so plainly instead of guessing.
4. Use the attached image only to describe what is visibly present (symptoms, affected area, visual severity) in support of the given ml_prediction — never to assert a different diagnosis.
5. Any chemical/dosage you mention in "treatment" must come from the offline treatment data provided (offline_recommended_chemical / offline_dosage / offline_organic_alternative) — never invent a new one.
6. Be concise and practical. Write for a farmer, not a scientist: short sentences, concrete actions, plain language.
7. Return ONLY machine-readable JSON matching the supplied response schema — no markdown, no commentary, no text outside the JSON object. String fields hold one clear sentence or short paragraph; array fields hold short, distinct bullet-style points (not one giant sentence per array):
   - "summary": one-sentence plain-language summary of the whole situation
   - "diagnosis": restate the ML-provided diagnosis in plain language (do not invent a different one)
   - "confidence": restate the provided ML confidence and what it means in practice
   - "severity": low | moderate | high, matching the provided severity unless the evidence clearly supports a different practical urgency — explain if you differ
   - "visual_analysis": what is actually visible in the photo that supports (or is consistent with) the ML diagnosis
   - "symptoms": short list of the specific visible symptoms
   - "likely_causes": short list of likely contributing causes for this specific case
   - "environmental_factors": short list of how the supplied sensor/weather data is contributing to or affecting this issue
   - "recommended_action": the single most important next action, in one sentence
   - "treatment": concrete treatment guidance consistent with the provided offline treatment data — do not invent a chemical or dosage
   - "timing": when to act, accounting for the supplied weather/wind/rain data
   - "weather_consideration": how the supplied weather/soil/humidity data affects this recommendation
   - "prevention": short list of preventive measures for next time
   - "safety_notes": short list of safety precautions relevant to the treatment or conditions (e.g. PPE) — use ["None beyond standard PPE"] if nothing specific applies`

export interface GeminiDetectionAnalysis {
  summary: string
  diagnosis: string
  confidence: string
  severity: string
  visual_analysis: string
  symptoms: string[]
  likely_causes: string[]
  environmental_factors: string[]
  recommended_action: string
  treatment: string
  timing: string
  weather_consideration: string
  prevention: string[]
  safety_notes: string[]
}

export interface GeminiDetectionContext {
  /** "pest" today; "disease" also covers nutrient-deficiency once that model ships into the same pipeline. */
  kind: "disease" | "pest"
  zoneId: string
  crop: string
  mlLabel: string
  mlConfidencePct: number
  severity: "low" | "moderate" | "high" | "unknown"
  mlTreatmentSummary?: string
  mlDosage?: string
  mlOrganicAlternative?: string
  soilMoisturePct?: number | null
  temperatureC?: number | null
  humidityPct?: number | null
  vpdKpa?: number | null
  vpdBand?: string | null
  weatherDescription?: string | null
  windSpeedKmh?: number | null
  windDirectionDeg?: number | null
  nextRainHours?: number | null
  totalRain24hMm?: number | null
  fungalPressureBand?: string | null
  sprayWindowSafeNow?: boolean | null
  /** The just-uploaded image — the whole point of this call is to analyse it together with the ML result. */
  photo: { base64: string; mimeType: string } | null
}

const DETECTION_STRING_FIELDS: (keyof GeminiDetectionAnalysis)[] = [
  "summary",
  "diagnosis",
  "confidence",
  "severity",
  "visual_analysis",
  "recommended_action",
  "treatment",
  "timing",
  "weather_consideration",
]
const DETECTION_ARRAY_FIELDS: (keyof GeminiDetectionAnalysis)[] = [
  "symptoms",
  "likely_causes",
  "environmental_factors",
  "prevention",
  "safety_notes",
]

// Thinking-capable models can spend hundreds of tokens reasoning before the
// visible JSON; this schema also has 5 array fields, so it needs more budget
// than the single-paragraph recommendation schema above.
const DETECTION_MAX_OUTPUT_TOKENS = 2048

const DETECTION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    ...Object.fromEntries(DETECTION_STRING_FIELDS.map((field) => [field, { type: Type.STRING }])),
    ...Object.fromEntries(DETECTION_ARRAY_FIELDS.map((field) => [field, { type: Type.ARRAY, items: { type: Type.STRING } }])),
  },
  required: [...DETECTION_STRING_FIELDS, ...DETECTION_ARRAY_FIELDS] as string[],
}

/** Validates the detection-analysis output against the fixed schema. Never throws. */
export function validateGeminiDetectionAnalysis(raw: string): GeminiDetectionAnalysis | null {
  try {
    const jsonText = extractJsonObject(raw)
    if (!jsonText) return null
    const parsed = JSON.parse(jsonText)
    if (!parsed || typeof parsed !== "object") return null

    const result: Record<string, string | string[]> = {}
    for (const field of DETECTION_STRING_FIELDS) {
      const value = parsed[field]
      if (typeof value !== "string" || value.trim().length === 0) return null
      result[field] = value.trim()
    }
    for (const field of DETECTION_ARRAY_FIELDS) {
      const value = parsed[field]
      if (!Array.isArray(value) || value.length === 0) return null
      const items = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
      if (items.length === 0) return null
      result[field] = items
    }
    return result as unknown as GeminiDetectionAnalysis
  } catch {
    return null
  }
}

function buildDetectionContents(context: GeminiDetectionContext) {
  const farmData = {
    zone: { id: context.zoneId, crop: context.crop },
    detection_kind: context.kind,
    observed_data: {
      soil_moisture_percent: context.soilMoisturePct ?? "not available",
      temperature_celsius: context.temperatureC ?? "not available",
      humidity_percent: context.humidityPct ?? "not available",
      vpd_kpa: context.vpdKpa ?? "not available",
      vpd_band: context.vpdBand ?? "not available",
      weather_description: context.weatherDescription ?? "not available",
      wind_speed_kmh: context.windSpeedKmh ?? "not available",
      wind_direction_deg: context.windDirectionDeg ?? "not available",
      hours_until_next_rain: context.nextRainHours ?? "no rain expected in forecast window",
      expected_rain_next_24h_mm: context.totalRain24hMm ?? "not available",
      fungal_disease_pressure_band: context.fungalPressureBand ?? "not available",
      spray_window_safe_now: context.sprayWindowSafeNow ?? "not available",
    },
    ml_prediction: {
      detected_issue: context.mlLabel,
      confidence_percent: context.mlConfidencePct,
      severity: context.severity,
      offline_recommended_chemical: context.mlTreatmentSummary ?? "not specified by the offline catalog",
      offline_dosage: context.mlDosage ?? "not specified by the offline catalog",
      offline_organic_alternative: context.mlOrganicAlternative ?? "not specified",
    },
    photo_attached: Boolean(context.photo),
  }

  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
    { text: `Farm data (JSON). Use only these facts:\n${JSON.stringify(farmData, null, 2)}` },
  ]
  if (context.photo) parts.push({ inlineData: { mimeType: context.photo.mimeType, data: context.photo.base64 } })

  return [{ role: "user" as const, parts }]
}

export type GeminiDetectionAnalysisResult =
  | { ok: true; data: GeminiDetectionAnalysis }
  | { ok: false; reason: "not_configured" | "network_error" | "timeout" | "invalid_response" }

/** Calls Gemini for a full detection-time analysis and validates its output. Never throws — always resolves. */
export async function requestGeminiDetectionAnalysis(context: GeminiDetectionContext): Promise<GeminiDetectionAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { ok: false, reason: "not_configured" }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    const client = new GoogleGenAI({ apiKey })
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildDetectionContents(context),
      config: {
        systemInstruction: DETECTION_ANALYSIS_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: DETECTION_RESPONSE_SCHEMA,
        maxOutputTokens: DETECTION_MAX_OUTPUT_TOKENS,
        abortSignal: controller.signal,
      },
    })

    const text = response.text
    if (!text) return { ok: false, reason: "invalid_response" }

    const validated = validateGeminiDetectionAnalysis(text)
    if (!validated) return { ok: false, reason: "invalid_response" }

    return { ok: true, data: validated }
  } catch (err: any) {
    if (err?.name === "AbortError" || controller.signal.aborted) return { ok: false, reason: "timeout" }
    return { ok: false, reason: "network_error" }
  } finally {
    clearTimeout(timer)
  }
}
