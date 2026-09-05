import { NextResponse } from "next/server"
import { zones } from "@/app/api/zones/data"
import { cropIsSupported, getPestKnowledge } from "@/app/data/pestKnowledge"
import { photoExtension, savePestPhoto } from "@/app/lib/pestPhotos"
import { attachPestSnapshot } from "@/app/lib/pestZoneHistory"
import {
  confidenceBand,
  findPestRecord,
  PestDetection,
  PestFollowUp,
  PestPrediction,
  savePestFollowUp,
  savePestRecord,
} from "@/app/lib/pestRecords"

export const dynamic = "force-dynamic"

const PEST_ML_SERVICE_URL = process.env.PEST_ML_SERVICE_URL ?? "http://127.0.0.1:5001"
const MODEL_TIMEOUT_MS = 30_000
const IDENTITY_CONFIDENCE_GATE = 0.6

type ServicePrediction = {
  classId?: number
  label?: string
  confidence?: number
  count?: number
  boxCoverageRatio?: number
}

type ServiceDetection = {
  classId?: number
  label?: string
  confidence?: number
  areaRatio?: number
  box?: { x1?: number; y1?: number; x2?: number; y2?: number; width?: number; height?: number }
}

function clamp(value: unknown, min = 0, max = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return min
  return Math.max(min, Math.min(max, parsed))
}

function positiveNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function publicFollowUp(followUp?: PestFollowUp) {
  if (!followUp) return null
  const { confidence: _confidence, ...publicFields } = followUp
  return publicFields
}

async function getModelHealth() {
  try {
    const response = await fetch(PEST_ML_SERVICE_URL + "/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    })
    const body = await response.json().catch(() => ({}))
    return {
      reachable: response.ok,
      ready: Boolean(response.ok && body?.ready),
      modelId: body?.modelId ?? "bhoomitra_pest_detector_yolo26_v1",
      modelVersion: body?.modelVersion ?? "1.0.0",
      classCount: Number(body?.classCount || 0),
      task: body?.task ?? "object-detection",
      message: body?.message ?? (response.ok ? "Pest detector reachable." : "Pest detector is not ready."),
    }
  } catch {
    return {
      reachable: false,
      ready: false,
      modelId: "bhoomitra_pest_detector_yolo26_v1",
      modelVersion: "1.0.0",
      classCount: 0,
      task: "object-detection",
      message: "The local pest-detection service is not running.",
    }
  }
}

export async function GET() {
  const model = await getModelHealth()
  return NextResponse.json({
    integrationReady: model.ready,
    model,
    contract: {
      endpoint: "/predict",
      input: "one close-up pest image",
      output: "pest labels, bounding boxes, visible counts and image-level pest pressure",
      limitation: "The detector describes only visible pests in the uploaded photo, not whole-field severity.",
    },
  })
}

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const zoneId = String(form.get("zoneId") || "").trim()
    const crop = String(form.get("crop") || "").trim()
    const language = String(form.get("language") || "en").trim()
    const comparablePhoto = form.get("comparablePhoto") === "true"
    const baselineRecordId = String(form.get("baselineRecordId") || "").trim()
    const fileValue = form.get("file")
    const file = fileValue instanceof File ? fileValue : null

    if (!zoneId || !crop) {
      return NextResponse.json({ error: "Select the crop and field zone before checking the image." }, { status: 400 })
    }
    if (!zones.some((zone) => zone.id === zoneId)) {
      return NextResponse.json({ error: "The selected field zone was not found." }, { status: 404 })
    }
    if (!file) {
      return NextResponse.json({ error: "Take or choose a clear pest image first." }, { status: 400 })
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Choose an image file such as JPG, PNG or WEBP." }, { status: 400 })
    }
    if (file.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "Image is too large. Choose an image below 12 MB." }, { status: 413 })
    }
    const photoBytes = Buffer.from(await file.arrayBuffer())
    if (!photoExtension(photoBytes)) {
      return NextResponse.json({ error: "Choose a JPG, PNG or WEBP photo." }, { status: 400 })
    }

    const baseline = baselineRecordId ? findPestRecord(baselineRecordId) : null
    if (baselineRecordId && !baseline) {
      return NextResponse.json({ error: "The original pest observation was not found." }, { status: 404 })
    }
    if (baseline && (baseline.zoneId !== zoneId || baseline.crop.toLowerCase() !== crop.toLowerCase())) {
      return NextResponse.json({ error: "A follow-up photo must use the same field zone and crop as the original observation." }, { status: 400 })
    }

    const modelForm = new FormData()
    modelForm.append("file", file)

    let response: Response
    try {
      response = await fetch(PEST_ML_SERVICE_URL + "/predict", {
        method: "POST",
        body: modelForm,
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      })
    } catch {
      return NextResponse.json({
        error: "The local pest-detection service is not running.",
        modelReady: false,
        nextStep: "Start pest_ml_service/main.py on port 5001 and try again.",
      }, { status: 503 })
    }

    const modelBody = await response.json().catch(() => ({}))
    if (!response.ok) {
      return NextResponse.json({
        error: modelBody?.error || "The pest detector could not analyse this image.",
        modelReady: Boolean(modelBody?.ready),
        nextStep: "Verify the YOLO checkpoint, class-name file and Python service.",
      }, { status: response.status === 400 || response.status === 413 ? response.status : 503 })
    }

    const classifierOnly = modelBody?.identificationSource === "classifier"
    const modelDetails = {
      modelId: String(modelBody?.modelId || "bhoomitra_pest_detector_yolo26_v1"),
      modelVersion: String(modelBody?.modelVersion || "1.0.0"),
      ready: true,
      task: classifierOnly ? "image-classification" : "object-detection",
    }
    const timestamp = new Date().toISOString()
    const image = {
      width: positiveNumber(modelBody?.image?.width),
      height: positiveNumber(modelBody?.image?.height),
    }
    const inference = modelBody?.inference ? {
      inputSize: positiveNumber(modelBody.inference.inputSize),
      retryUsed: Boolean(modelBody.inference.retryUsed),
      attemptedSizes: Array.isArray(modelBody.inference.attemptedSizes)
        ? modelBody.inference.attemptedSizes.map(positiveNumber)
        : [],
    } : undefined
    const rawPredictions: ServicePrediction[] = Array.isArray(modelBody?.predictions)
      ? modelBody.predictions.slice(0, 3)
      : []

    if (!rawPredictions.length || !modelBody?.primaryPrediction) {
      const followUpSaved = baseline
        ? savePestFollowUp(baseline.id, {
          pestId: null,
          pestName: "Could not confidently identify a pest",
          scientificName: null,
          confidence: 0,
          visibleCount: 0,
          boxCoverageRatio: 0,
          pressureLevel: "none",
          imageName: file.name,
          modelId: modelDetails.modelId,
          modelVersion: modelDetails.modelVersion,
          inference,
        })
        : null

      const record = followUpSaved?.record || savePestRecord({
        zoneId, crop, pestId: "", pestName: "Needs recheck", scientificName: "",
        confidence: 0, confidenceBand: "low", cropMatch: "not_applicable",
        predictions: [], detections: [], imageWidth: image.width, imageHeight: image.height,
        visibleCount: 0, boxCoverageRatio: 0, pressureLevel: "none", imageName: file.name,
        modelId: modelDetails.modelId, modelVersion: modelDetails.modelVersion, farmerConfirmed: false, inference,
      })
      const result = {
        success: true,
        detected: false,
        persisted: true,
        recordId: record.id,
        model: modelDetails,
        inference,
        scan: { zoneId, crop, language, timestamp, imageName: file.name, comparablePhoto },
        image,
        summary: null,
        predictions: [],
        detections: [],
        pressure: { level: "none" as const, visibleCount: 0, boxCoverageRatio: 0 },
        classificationLimit: modelBody?.limitations,
        followUpComparison: publicFollowUp(followUpSaved?.followUp),
        followUpBaseline: followUpSaved?.previous || null,
        message: baseline
          ? "This photo could not confirm whether the pest is still present. The observation remains open. Retake a closer photo and inspect the same plants."
          : "A pest may still be present. Retake a clear close-up and inspect the plant again.",
        pest: null,
        advice: null,
      }
      const observation = attachPestSnapshot(record.id, followUpSaved?.followUp.id || record.id, result, savePestPhoto(photoBytes))
      return NextResponse.json({ ...result, observation })
    }

    const predictions: PestPrediction[] = rawPredictions.map((item) => {
      const label = String(item?.label || "").trim()
      const knowledge = getPestKnowledge(label)
      if (knowledge.id === "unknown") throw new Error(`No Bhoomitra advisory is mapped to model class “${label}”.`)
      return {
        label,
        pestId: knowledge.id,
        pestName: knowledge.commonName,
        confidence: clamp(item?.confidence),
        count: Math.round(positiveNumber(item?.count)),
        boxCoverageRatio: clamp(item?.boxCoverageRatio),
      }
    })

    const detections: PestDetection[] = (Array.isArray(modelBody?.detections) ? modelBody.detections : []).map((item: ServiceDetection) => {
      const label = String(item?.label || "").trim()
      const knowledge = getPestKnowledge(label)
      const box = item?.box || {}
      return {
        classId: Math.round(positiveNumber(item?.classId)),
        label,
        pestId: knowledge.id,
        confidence: clamp(item?.confidence),
        areaRatio: clamp(item?.areaRatio),
        box: {
          x1: positiveNumber(box.x1),
          y1: positiveNumber(box.y1),
          x2: positiveNumber(box.x2),
          y2: positiveNumber(box.y2),
          width: positiveNumber(box.width),
          height: positiveNumber(box.height),
        },
      }
    })

    const primary = predictions[0]
    const primaryKnowledge = getPestKnowledge(primary.label)
    const confidence = primary.confidence
    const band = confidenceBand(confidence)
    const cropMatch = cropIsSupported(primaryKnowledge, crop) ? "matched" as const : "review" as const
    const identityNeedsReview = classifierOnly || confidence < IDENTITY_CONFIDENCE_GATE
    const pressureLevel = (classifierOnly ? "unknown" : ["low", "moderate", "high"].includes(modelBody?.pressure?.level)
      ? modelBody.pressure.level
      : "low") as "low" | "moderate" | "high" | "unknown"
    const visibleCount = classifierOnly ? 0 : Math.round(positiveNumber(modelBody?.pressure?.visibleCount ?? primary.count))
    const boxCoverageRatio = classifierOnly ? 0 : clamp(modelBody?.pressure?.boxCoverageRatio ?? primary.boxCoverageRatio)
    const chemicalBlockedReason = identityNeedsReview
      ? "Retake the photo or obtain expert confirmation before selecting a pesticide."
      : cropMatch === "review"
        ? `The ${primaryKnowledge.commonName} guide is not verified for ${crop}. Confirm with local extension.`
        : null

    const result = {
      success: true,
      detected: true,
      identificationSource: classifierOnly ? "classifier" as const : "detector" as const,
      persisted: true,
      model: modelDetails,
      inference,
      scan: { zoneId, crop, language, timestamp, imageName: file.name, comparablePhoto },
      image,
      summary: {
        primaryPestId: primaryKnowledge.id,
        primaryPestName: primaryKnowledge.commonName,
        scientificName: primaryKnowledge.scientificName,
        cropMatch,
        visibleCount,
        boxCoverageRatio,
        pressureLevel,
      },
      predictions: predictions.map(({ label, pestId, pestName, count, boxCoverageRatio }) => ({
        label,
        pestId,
        pestName,
        count,
        boxCoverageRatio,
      })),
      detections: detections.map(({ classId, label, pestId, areaRatio, box }) => ({
        classId,
        label,
        pestId,
        areaRatio,
        box,
      })),
      pressure: { level: pressureLevel, visibleCount, boxCoverageRatio },
      classificationLimit: modelBody?.limitations || "Counts and boxes apply only to visible pests in this image.",
      pest: { damageSigns: primaryKnowledge.damageSigns, whyItMatters: primaryKnowledge.whyItMatters },
      advice: {
        inspectToday: primaryKnowledge.inspectToday,
        next48Hours: primaryKnowledge.next48Hours,
        prevention: primaryKnowledge.prevention,
        biologicalControl: primaryKnowledge.biologicalControl,
        pesticide: {
          ...primaryKnowledge.chemical,
          eligible: !chemicalBlockedReason,
          blockedReason: chemicalBlockedReason,
        },
      },
      safety: {
        identityConfirmationRequired: identityNeedsReview,
        fieldThresholdRequired: true,
        automaticChemicalAction: false,
        message: "Use the photo result for scouting; follow only a crop-registered label and local agricultural guidance.",
      },
    }

    const followUpSaved = baseline
      ? savePestFollowUp(baseline.id, {
        pestId: primaryKnowledge.id,
        pestName: primaryKnowledge.commonName,
        scientificName: primaryKnowledge.scientificName,
        confidence,
        visibleCount,
        boxCoverageRatio,
        pressureLevel,
        imageName: file.name,
        modelId: modelDetails.modelId,
        modelVersion: modelDetails.modelVersion,
        inference,
      })
      : null

    const record = baseline
      ? followUpSaved?.record
      : savePestRecord({
        zoneId,
        crop,
        pestId: primaryKnowledge.id,
        pestName: primaryKnowledge.commonName,
        scientificName: primaryKnowledge.scientificName,
        confidence,
        confidenceBand: band,
        cropMatch,
        predictions,
        detections,
        imageWidth: image.width,
        imageHeight: image.height,
        visibleCount,
        boxCoverageRatio,
        pressureLevel,
        imageName: file.name,
        modelId: modelDetails.modelId,
        modelVersion: modelDetails.modelVersion,
        farmerConfirmed: false,
        inference,
      })

    if (!record) throw new Error("The pest observation could not be saved.")
    const observation = attachPestSnapshot(record.id, followUpSaved?.followUp.id || record.id, { ...result, recordId: record.id }, savePestPhoto(photoBytes))
    return NextResponse.json({
      ...result,
      recordId: record?.id || baseline?.id || null,
      observation,
      followUpComparison: publicFollowUp(followUpSaved?.followUp),
      followUpBaseline: followUpSaved?.previous || null,
    })
  } catch (error) {
    console.error("Pest detection route failed", error)
    const message = error instanceof Error ? error.message : "The pest check could not be completed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
