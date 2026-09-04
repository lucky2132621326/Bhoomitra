import type { PestChemicalGuidance } from "@/app/data/pestKnowledge"

export type PestPressure = "none" | "unknown" | "low" | "moderate" | "high"
export type PestScanResult = {
  success: boolean
  detected: boolean
  identificationSource?: "detector" | "classifier"
  persisted: boolean
  recordId: string | null
  message?: string
  scan: { zoneId: string; crop: string; timestamp: string; imageName: string | null; comparablePhoto?: boolean }
  image: { width: number; height: number }
  summary: null | {
    primaryPestId: string; primaryPestName: string; scientificName: string
    cropMatch: "matched" | "review" | "not_applicable"
    visibleCount: number; boxCoverageRatio: number; pressureLevel: PestPressure
  }
  predictions: { label: string; pestId: string; pestName: string; count: number; boxCoverageRatio: number }[]
  detections: { classId: number; label: string; pestId: string; areaRatio: number; box: { x1: number; y1: number; x2: number; y2: number; width: number; height: number } }[]
  pressure: { level: PestPressure; visibleCount: number; boxCoverageRatio: number }
  classificationLimit: string
  pest: null | { damageSigns: string[]; whyItMatters: string }
  advice: null | {
    inspectToday: string[]; next48Hours: string[]; prevention: string[]; biologicalControl: string[]
    pesticide: PestChemicalGuidance & { eligible: boolean; blockedReason: string | null }
  }
}

// Scores remain on the private PestRecord, never in the browser snapshot.
export type PestScanSnapshot = { result: PestScanResult; photoName: string | null; fieldNoPestsAt?: string }
export type PestZoneObservation = {
  id: string; recordId: string; result: PestScanResult; photoUrl: string | null
  fieldNoPestsAt: string | null; legacy: boolean
}
export type PestZoneState = "high" | "moderate" | "low" | "clear" | "recheck" | "untested" | "unmeasured"
export type PestZoneTrend = {
  status: "first" | "improving" | "worsening" | "stable" | "different_pest" | "different_crop" | "recheck" | "field_clear" | "not_comparable"
  previous: PestZoneObservation | null
}

export function zoneState(observation?: PestZoneObservation): PestZoneState {
  if (!observation) return "untested"
  if (observation.result.identificationSource === "classifier") return "unmeasured"
  if (!observation.result.detected) return observation.fieldNoPestsAt ? "clear" : "recheck"
  const level = observation.result.summary?.pressureLevel
  return level === "high" || level === "moderate" || level === "low" ? level : "recheck"
}

export function cropKey(crop: string) {
  const key = crop.trim().toLowerCase()
  return key === "rice" ? "paddy" : key
}

// Newest first. Compare successive photos, never confidence or whole-field severity.
export function zoneTrend(current: PestZoneObservation, observations: PestZoneObservation[]): PestZoneTrend {
  const ordered = observations.filter((item) => item.result.scan.zoneId === current.result.scan.zoneId)
  const position = ordered.findIndex((item) => item.id === current.id)
  const previous = position >= 0 ? ordered[position + 1] ?? null : null
  if (current.result.identificationSource === "classifier" || previous?.result.identificationSource === "classifier" || current.result.summary?.pressureLevel === "unknown" || previous?.result.summary?.pressureLevel === "unknown") return { status: "recheck", previous }
  if (current.fieldNoPestsAt && !current.result.detected) return { status: "field_clear", previous }
  if (!current.result.detected) return { status: "recheck", previous }
  if (!previous) return { status: "first", previous: null }
  if (cropKey(current.result.scan.crop) !== cropKey(previous.result.scan.crop)) return { status: "different_crop", previous }
  if (!previous.result.detected || !previous.result.summary || !current.result.summary) return { status: "recheck", previous }
  // All visible pest categories must match; do not call a newly appearing pest an improvement.
  const signature = (item: PestZoneObservation) => [...new Set(item.result.predictions.map((p) => p.pestId))].sort().join("|") || item.result.summary?.primaryPestId
  if (signature(current) !== signature(previous) || current.result.summary.primaryPestId !== previous.result.summary.primaryPestId) return { status: "different_pest", previous }
  if (!current.result.scan.comparablePhoto) return { status: "not_comparable", previous }
  const rank = { none: 0, unknown: 0, low: 1, moderate: 2, high: 3 }
  const delta = rank[current.result.summary.pressureLevel] - rank[previous.result.summary.pressureLevel]
  return { status: delta < 0 ? "improving" : delta > 0 ? "worsening" : "stable", previous }
}
