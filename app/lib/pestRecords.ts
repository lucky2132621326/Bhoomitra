import { readDB, writeDB } from "@/app/lib/database"
import type { PestScanSnapshot } from "@/lib/pest-zone-types"

export type PestPrediction = {
  label: string
  pestId: string
  pestName: string
  confidence: number
  count: number
  boxCoverageRatio: number
}

export type PestDetection = {
  classId: number
  label: string
  pestId: string
  confidence: number
  box: { x1: number; y1: number; x2: number; y2: number; width: number; height: number }
  areaRatio: number
}

export type PestInference = { inputSize: number; retryUsed: boolean; attemptedSizes: number[] }

export type FollowUpComparison = "improving" | "stable" | "worsening" | "resolved" | "different_pest" | "needs_recheck"

export type PestFollowUp = {
  snapshot?: PestScanSnapshot
  id: string
  timestamp: string
  imageName: string | null
  pestId: string | null
  pestName: string
  scientificName: string | null
  confidence: number
  visibleCount: number
  boxCoverageRatio: number
  pressureLevel: "low" | "moderate" | "high" | "none" | "unknown"
  comparison: FollowUpComparison
  countChangePercent: number | null
  coverageChangePercent: number | null
  inference?: PestInference
  modelId: string | null
  modelVersion: string | null
}

export type PestRecord = {
  snapshot?: PestScanSnapshot
  id: string
  zoneId: string
  crop: string
  pestId: string
  pestName: string
  scientificName: string
  confidence: number
  confidenceBand: "low" | "medium" | "high"
  cropMatch: "matched" | "review" | "not_applicable"
  predictions: PestPrediction[]
  detections: PestDetection[]
  imageWidth: number
  imageHeight: number
  visibleCount: number
  boxCoverageRatio: number
  pressureLevel: "none" | "low" | "moderate" | "high" | "unknown"
  imageName: string | null
  timestamp: string
  modelId: string | null
  modelVersion: string | null
  farmerConfirmed: boolean
  status: "new" | "monitoring" | "improving" | "increasing" | "resolved" | "needs_recheck"
  inference?: PestInference
  followUpDue: string
  followUps: PestFollowUp[]
  outcomeNote: string | null
  updatedAt: string
}

export type NewPestRecord = Omit<
  PestRecord,
  "id" | "timestamp" | "status" | "followUpDue" | "followUps" | "outcomeNote" | "updatedAt"
>

export type NewPestFollowUp = {
  pestId: string | null
  pestName: string
  scientificName: string | null
  confidence: number
  visibleCount: number
  boxCoverageRatio: number
  pressureLevel: PestFollowUp["pressureLevel"]
  imageName: string | null
  modelId: string | null
  modelVersion: string | null
  inference?: PestInference
}

function asMetric(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function latestMetrics(record: PestRecord) {
  const followUps = Array.isArray(record.followUps) ? record.followUps : []
  // An inconclusive photo is not a zero-pest baseline for the next comparison.
  const last = [...followUps].reverse().find((entry) => entry.pestId && entry.visibleCount > 0)
  return {
    pestId: last?.pestId ?? record.pestId,
    pestName: last?.pestName ?? record.pestName,
    visibleCount: asMetric(last?.visibleCount, asMetric(record.visibleCount)),
    boxCoverageRatio: asMetric(last?.boxCoverageRatio, asMetric(record.boxCoverageRatio)),
  }
}

function percentageChange(current: number, previous: number, floor: number) {
  if (current === previous) return 0
  return ((current - previous) / Math.max(previous, floor)) * 100
}

function compareFollowUp(record: PestRecord, input: NewPestFollowUp) {
  const previous = latestMetrics(record)
  const latest = record.followUps?.at(-1) || record
  if (input.pressureLevel === "unknown" || latest.pressureLevel === "unknown") {
    return { previous, comparison: "needs_recheck" as const, countChangePercent: null, coverageChangePercent: null }
  }
  if (!input.pestId || input.visibleCount === 0) {
    return { previous, comparison: "needs_recheck" as const, countChangePercent: null, coverageChangePercent: null }
  }
  const countChangePercent = percentageChange(input.visibleCount, previous.visibleCount, 1)
  const coverageChangePercent = percentageChange(input.boxCoverageRatio, previous.boxCoverageRatio, 0.005)

  let comparison: FollowUpComparison
  if (input.pestId !== previous.pestId) {
    comparison = "different_pest"
  } else {
    const combinedChange = countChangePercent * 0.7 + coverageChangePercent * 0.3
    comparison = combinedChange <= -20 ? "improving" : combinedChange >= 20 ? "worsening" : "stable"
  }

  return { previous, comparison, countChangePercent, coverageChangePercent }
}

export function listPestRecords() {
  return [...(readDB().pestDetections || [])]
    .filter((record) => !record.sample && (record.modelId === "bhoomitra_pest_detector_yolo26_v1" || (record.modelId === "bhoomitra_pest_classifier_v1" && record.pressureLevel === "unknown")))
    .sort((a, b) => Date.parse(String(b.timestamp || "")) - Date.parse(String(a.timestamp || ""))) as PestRecord[]
}

export function findPestRecord(id: string) {
  return listPestRecords().find((record) => record.id === id) || null
}

export function savePestRecord(input: NewPestRecord) {
  const now = new Date()
  const followUpDue = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const record: PestRecord = {
    ...input,
    id: crypto.randomUUID(),
    timestamp: now.toISOString(),
    status: input.visibleCount > 0 ? "monitoring" : "needs_recheck",
    followUpDue: input.visibleCount > 0 ? followUpDue.toISOString() : now.toISOString(),
    followUps: [],
    outcomeNote: null,
    updatedAt: now.toISOString(),
  }

  const db = readDB()
  db.pestDetections.push(record)
  db.activityLog.unshift({
    type: "alert",
    recordId: record.id,
    zoneId: record.zoneId,
    timestamp: record.timestamp,
    source: "pest-detection",
    pestId: record.pestId,
    visibleCount: record.visibleCount,
  })
  writeDB(db)
  return record
}

export function savePestFollowUp(id: string, input: NewPestFollowUp) {
  const db = readDB()
  const record = db.pestDetections.find((entry: PestRecord) => entry.id === id) as PestRecord | undefined
  if (!record) return null

  const now = new Date()
  const comparisonResult = compareFollowUp(record, input)
  const followUp: PestFollowUp = {
    ...input,
    id: crypto.randomUUID(),
    timestamp: now.toISOString(),
    comparison: comparisonResult.comparison,
    countChangePercent: comparisonResult.countChangePercent,
    coverageChangePercent: comparisonResult.coverageChangePercent,
  }

  if (!Array.isArray(record.followUps)) record.followUps = []
  record.followUps.push(followUp)
  record.status = followUp.comparison === "worsening"
    ? "increasing"
    : followUp.comparison === "stable" || followUp.comparison === "different_pest"
      ? "monitoring"
      : followUp.comparison
  record.followUpDue = followUp.comparison === "needs_recheck"
    ? now.toISOString()
    : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  record.outcomeNote = followUp.comparison === "needs_recheck"
    ? "The follow-up photo was inconclusive. The observation remains open and needs another check."
    : followUp.comparison === "different_pest"
    ? `Follow-up detected ${followUp.pestName}; review it separately from ${comparisonResult.previous.pestName}.`
    : `Automatic photo comparison: ${followUp.comparison}.`
  record.updatedAt = now.toISOString()

  db.activityLog.unshift({
    type: followUp.comparison === "worsening" ? "alert" : "info",
    recordId: record.id,
    followUpId: followUp.id,
    zoneId: record.zoneId,
    timestamp: followUp.timestamp,
    source: "pest-follow-up",
    pestId: followUp.pestId,
    comparison: followUp.comparison,
    visibleCount: followUp.visibleCount,
  })
  writeDB(db)
  return { record, followUp, previous: comparisonResult.previous }
}

export function updatePestRecord(
  id: string,
  status: PestRecord["status"],
  outcomeNote?: string | null,
  farmerConfirmed?: boolean,
) {
  const db = readDB()
  const record = db.pestDetections.find((entry: PestRecord) => entry.id === id) as PestRecord | undefined
  if (!record) return null

  record.status = status
  record.outcomeNote = outcomeNote?.trim() || null
  if (typeof farmerConfirmed === "boolean") record.farmerConfirmed = farmerConfirmed
  record.updatedAt = new Date().toISOString()
  writeDB(db)
  return record
}

export function confidenceBand(confidence: number): PestRecord["confidenceBand"] {
  if (confidence >= 0.8) return "high"
  if (confidence >= 0.6) return "medium"
  return "low"
}
