import { readDB, writeDB } from "@/app/lib/database"
import { listPestRecords, type PestRecord, type PestFollowUp } from "@/app/lib/pestRecords"
import { cropIsSupported, getPestKnowledge } from "@/app/data/pestKnowledge"
import type { PestScanResult, PestZoneObservation } from "@/lib/pest-zone-types"

// Legacy observations had metrics, but no retained image. Keep them, without fabricating a photo.
function legacyResult(record: PestRecord, entry: PestRecord | PestFollowUp): PestScanResult {
  const knowledge = getPestKnowledge(entry.pestId || "unknown")
  const detected = Boolean(entry.pestId && entry.visibleCount > 0)
  const matched = cropIsSupported(knowledge, record.crop)
  const eligible = detected && matched && entry.confidence >= 0.6
  return {
    success: true, detected, persisted: true, recordId: record.id,
    scan: { zoneId: record.zoneId, crop: record.crop, timestamp: entry.timestamp, imageName: entry.imageName },
    image: { width: "imageWidth" in entry ? entry.imageWidth : 0, height: "imageHeight" in entry ? entry.imageHeight : 0 },
    summary: detected ? { primaryPestId: entry.pestId!, primaryPestName: entry.pestName, scientificName: entry.scientificName || "", cropMatch: matched ? "matched" : "review", visibleCount: entry.visibleCount, boxCoverageRatio: entry.boxCoverageRatio, pressureLevel: entry.pressureLevel } : null,
    predictions: "predictions" in entry ? (entry.predictions || []).map(({ confidence: _score, ...prediction }) => prediction) : [],
    detections: "detections" in entry ? (entry.detections || []).map(({ confidence: _score, ...detection }) => detection) : [],
    pressure: { level: entry.pressureLevel, visibleCount: entry.visibleCount, boxCoverageRatio: entry.boxCoverageRatio },
    classificationLimit: "Counts and pressure describe this photo only, not the whole zone.",
    message: "A pest may still be present. Retake a clear close-up and inspect the plant again.",
    pest: detected ? { damageSigns: knowledge.damageSigns, whyItMatters: knowledge.whyItMatters } : null,
    advice: detected && knowledge.id !== "unknown" ? {
      inspectToday: knowledge.inspectToday, next48Hours: knowledge.next48Hours, prevention: knowledge.prevention,
      biologicalControl: knowledge.biologicalControl,
      pesticide: { ...knowledge.chemical, eligible, blockedReason: eligible ? null : "Confirm the pest and crop with local extension before choosing a pesticide." },
    } : null,
  }
}

export function listPestZoneObservations(): PestZoneObservation[] {
  return listPestRecords().flatMap((record) => [record, ...(record.followUps || [])].map((entry) => ({
    id: entry.id, recordId: record.id,
    result: entry.snapshot?.result || legacyResult(record, entry),
    photoUrl: entry.snapshot?.photoName ? `/api/pest-photos/${entry.snapshot.photoName}` : null,
    fieldNoPestsAt: entry.snapshot?.fieldNoPestsAt || null,
    legacy: !entry.snapshot,
  }))).sort((a, b) => Date.parse(b.result.scan.timestamp) - Date.parse(a.result.scan.timestamp))
}

export function attachPestSnapshot(recordId: string, observationId: string, result: PestScanResult, photoName: string) {
  const db = readDB()
  const record = db.pestDetections.find((item: PestRecord) => item.id === recordId) as PestRecord | undefined
  const entry = record?.id === observationId ? record : record?.followUps?.find((item) => item.id === observationId)
  if (!entry) throw new Error("The pest observation could not be saved.")
  // Whitelist public fields rather than retaining the whole inference response.
  const snapshotResult: PestScanResult = {
    success: true, detected: result.detected, identificationSource: result.identificationSource, persisted: true, recordId,
    scan: { ...result.scan, timestamp: entry.timestamp }, image: result.image, summary: result.summary,
    predictions: result.predictions, detections: result.detections, pressure: result.pressure,
    classificationLimit: typeof result.classificationLimit === "string" ? result.classificationLimit : "Counts and pressure describe this photo only, not the whole zone.",
    message: result.message, pest: result.pest, advice: result.advice,
  }
  entry.snapshot = { result: snapshotResult, photoName }
  writeDB(db)
  return listPestZoneObservations().find((item) => item.id === observationId)!
}

export function confirmNoPests(observationId: string) {
  const observations = listPestZoneObservations()
  const observation = observations.find((item) => item.id === observationId)
  if (!observation) throw new Error("The pest observation was not found.")
  const latest = observations.find((item) => item.result.scan.zoneId === observation.result.scan.zoneId)
  if (latest?.id !== observation.id || observation.result.detected || observation.legacy) {
    throw new Error("Only the latest inconclusive photo can receive a field no-pest confirmation.")
  }
  const db = readDB()
  const record = db.pestDetections.find((item: PestRecord) => item.id === observation.recordId) as PestRecord
  const entry = record.id === observationId ? record : record.followUps.find((item) => item.id === observationId)
  if (!entry?.snapshot) throw new Error("The saved photo was not found.")
  entry.snapshot.fieldNoPestsAt = new Date().toISOString()
  record.status = "resolved"
  record.farmerConfirmed = true
  record.outcomeNote = "Farmer checked the plants and reported no visible pests. Not an ML guarantee."
  record.updatedAt = entry.snapshot.fieldNoPestsAt
  writeDB(db)
  return listPestZoneObservations().find((item) => item.id === observationId)!
}
