import type { WeatherForecast } from "@/app/lib/weatherService"

export type StressKind = "normal" | "drought" | "flood" | "heat" | "multiple" | "insufficient_data"
export type StressSeverity = "none" | "low" | "moderate" | "high"
export type StressStatus = "Offline Prediction" | "Online Verified" | "Internet Unavailable"

export type StressResult = {
  condition: StressKind
  severity: StressSeverity
  confidence: number
  contributors: string[]
  lastUpdatedAt: string
  status: StressStatus
  connectivity: "online" | "offline" | "checking"
  scores: { drought: number; flood: number; heat: number }
  data: { zonesEvaluated: number; freshZones: number; coveragePercent: number; weatherSource: string }
}

type ZoneInput = {
  soilMoisture: number
  dryThreshold: number
  wetThreshold: number
  temperature?: number | null
  humidity?: number | null
  vpd?: number | null
  soilHistory?: number[]
  temperatureHistory?: number[]
  sensorFresh?: boolean
  sensorError?: boolean
  cycleActive?: boolean
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null

function severity(score: number): StressSeverity {
  if (score >= 75) return "high"
  if (score >= 50) return "moderate"
  if (score >= 25) return "low"
  return "none"
}

function slope(values: number[]) {
  if (values.length < 3) return 0
  return (values[values.length - 1] - values[0]) / Math.max(1, values.length - 1)
}

export function classifyStress(input: { zones: ZoneInput[]; weather?: WeatherForecast | null; now?: number }): StressResult {
  const now = input.now ?? Date.now()
  const validZones = input.zones.filter((z) => Number.isFinite(z.soilMoisture) && !z.sensorError)
  const freshCount = validZones.filter((z) => z.sensorFresh !== false).length
  if (!validZones.length) {
    return { condition: "insufficient_data", severity: "none", confidence: 0, contributors: ["No valid soil-moisture reading"], lastUpdatedAt: new Date(now).toISOString(), status: "Internet Unavailable", connectivity: "offline", scores: { drought: 0, flood: 0, heat: 0 }, data: { zonesEvaluated: 0, freshZones: 0, coveragePercent: 0, weatherSource: "unavailable" } }
  }

  const droughtScores: number[] = [], floodScores: number[] = [], heatScores: number[] = []
  const contributors = new Set<string>()
  for (const zone of validZones) {
    const moisture = clamp((zone.dryThreshold - zone.soilMoisture) / Math.max(1, zone.dryThreshold) * 100)
    const wetness = clamp((zone.soilMoisture - zone.wetThreshold) / Math.max(1, 100 - zone.wetThreshold) * 100)
    const moistureSlope = slope(zone.soilHistory || [])
    const decline = clamp((-moistureSlope / 1.5) * 100)
    const wetPersistence = (zone.soilHistory || []).filter((v) => v >= zone.wetThreshold).length >= 3 ? 100 : 0
    const temp = Number(zone.temperature)
    const humidity = Number(zone.humidity)
    const vpd = Number(zone.vpd)
    const tempStress = Number.isFinite(temp) ? clamp((temp - 32) / 8 * 100) : 0
    const vpdStress = Number.isFinite(vpd) ? clamp((vpd - 1.2) / 1.2 * 100) : 0
    const rainEvidence = input.weather && (Number(input.weather.current.precipitation) >= 0.1 || Number(input.weather.derived.totalRain24h) >= 2 || (input.weather.derived.nextRainHours !== null && input.weather.derived.nextRainHours <= 3)) ? 100 : 0
    const drySoil = zone.soilMoisture < zone.dryThreshold ? 100 : 0
    const drought = clamp(0.40 * moisture + 0.20 * decline + 0.15 * (rainEvidence ? 0 : 100) + 0.15 * Math.max(tempStress, vpdStress) + 0.10 * (zone.cycleActive ? 0 : drySoil))
    const flood = clamp(0.40 * wetness + 0.25 * rainEvidence + 0.20 * wetPersistence + 0.15 * (zone.cycleActive ? 100 : 0))
    const heat = clamp(0.45 * tempStress + 0.30 * vpdStress + 0.15 * (tempStress >= 50 ? 100 : 0) + 0.10 * drySoil)
    droughtScores.push(drought); floodScores.push(flood); heatScores.push(heat)
    if (drought >= 50) contributors.add("Soil moisture below target with a drying signal")
    if (flood >= 50) contributors.add("Wet soil combined with rain or irrigation context")
    if (heat >= 50) contributors.add("Elevated temperature/VPD with sustained heat signal")
  }
  const drought = Math.round(avg(droughtScores) || 0), flood = Math.round(avg(floodScores) || 0), heat = Math.round(avg(heatScores) || 0)
  const active = [{ kind: "drought" as const, score: drought }, { kind: "flood" as const, score: flood }, { kind: "heat" as const, score: heat }].filter((x) => x.score >= 25).sort((a, b) => b.score - a.score)
  const condition: StressKind = active.length >= 2 && active[0].score >= 50 && active[1].score >= 50 ? "multiple" : active[0]?.kind || "normal"
  const topScore = active[0]?.score || 0
  // The prototype has one physical soil probe feeding a representative zone;
  // one fresh probe is therefore meaningful evidence, while coverage is still
  // shown separately so confidence is not falsely presented as whole-farm certainty.
  const coveragePercent = Math.round((freshCount / validZones.length) * 100)
  const dataQuality = freshCount > 0 ? 60 + Math.min(40, coveragePercent * 0.4) : 25
  const agreement = active.length ? clamp(topScore + (active[0].score >= 50 ? 10 : 0)) : 75
  const confidence = Math.round(clamp(0.55 * dataQuality + 0.45 * agreement - (input.weather?.source === "fallback" ? 10 : 0)))
  if (confidence < 40) contributors.add("Limited or stale sensor evidence")
  const status: StressStatus = input.weather?.source === "live" ? "Online Verified" : input.weather ? "Offline Prediction" : "Internet Unavailable"
  return { condition, severity: severity(topScore), confidence, contributors: [...contributors].slice(0, 4), lastUpdatedAt: new Date(now).toISOString(), status, connectivity: status === "Online Verified" ? "online" : status === "Internet Unavailable" ? "offline" : "checking", scores: { drought, flood, heat }, data: { zonesEvaluated: validZones.length, freshZones: freshCount, coveragePercent, weatherSource: input.weather?.source || "unavailable" } }
}
