import { NextResponse } from "next/server"
import {
  zones,
  zoneHistory,
  updateLiveZones,
  simulationEnabledRef,
  irrigationSettings,
  globalHydrateRequest,
  getHydrationCandidates,
  getFarmClimate,
  getFarmClimatePresentation,
  activityLog,
  hardwareState,
  pendingCommands,
} from "@/app/api/zones/data"
import { getForecast } from "@/app/lib/weatherService"
import { decideFarmActions } from "@/app/lib/farmDecisionService"
import { readDB } from "@/app/lib/database"
import { classifyStress } from "@/app/lib/stressClassifier"

// This endpoint reflects live soil probes and the shared DHT11 station, so it
// must never be prerendered or served as a build-time snapshot.
export const dynamic = "force-dynamic"

export async function GET() {
  if (simulationEnabledRef.value) {
    updateLiveZones()
  }

  const hydrateMeta = getHydrationCandidates()
  const weatherForecast = await getForecast()
  const farmClimate = getFarmClimate()
  const climatePresentation = getFarmClimatePresentation(farmClimate)
  const allDetections = readDB().detections || []
  const activeDetectionZoneIds = new Set(
    allDetections
      .filter((d: any) => d.status === "active" && d.cropMatch !== "review" && !String(d.diseaseName || d.disease || "").toLowerCase().includes("healthy"))
      .map((d: any) => d.zoneId)
      .filter(Boolean),
  )
  const cropReviewZoneIds = new Set(
    allDetections
      .filter((d: any) => d.status === "active" && d.cropMatch === "review")
      .map((d: any) => d.zoneId)
      .filter(Boolean),
  )

  // The zone detail panel and disease ring read the scan's diagnosis, but the
  // in-memory zone only carries a disease after a live in-session scan. Seed
  // and persisted detections live in db.json, so surface the most recent
  // relevant detection per zone here — keeping the map consistent with
  // analytics and recommendations, which both read from db.json.
  const detectionByZone = new Map<string, any>()
  for (const d of allDetections) {
    const isHealthy = String(d.diseaseName || d.disease || "").toLowerCase().includes("healthy")
    if (d.status !== "active" || d.cropMatch === "review" || isHealthy) continue
    const prev = detectionByZone.get(d.zoneId)
    if (!prev || Date.parse(String(d.timestamp || "")) > Date.parse(String(prev.timestamp || ""))) {
      detectionByZone.set(d.zoneId, d)
    }
  }

  const decisions = new Map(
    zones.map(zone => [
      zone.id,
      decideFarmActions({
        soilMoisture: zone.soilMoisture,
        dryThreshold: irrigationSettings.dryThreshold,
        climate: farmClimate,
        weather: weatherForecast,
      }),
    ]),
  )
  const stress = classifyStress({
    weather: weatherForecast,
    zones: zones.map((zone) => {
      const history = zoneHistory.find((entry) => entry.zoneId === zone.id)
      return {
        soilMoisture: zone.soilMoisture,
        dryThreshold: irrigationSettings.dryThreshold,
        wetThreshold: irrigationSettings.wetThreshold,
        temperature: farmClimate.temperature ?? zone.temperature,
        humidity: farmClimate.humidity ?? zone.humidity,
        vpd: zone.vpd,
        soilHistory: history?.moistureHistory,
        temperatureHistory: history?.temperatureHistory,
        sensorFresh: Boolean(zone.sensor?.lastValidAt && Date.now() - zone.sensor.lastValidAt <= 15 * 60 * 1000),
        sensorError: Boolean(zone.sensor?.hasError),
        cycleActive: Boolean(zone.cycle?.active),
      }
    }),
  })
  const actionableTargets = hydrateMeta.targeted.filter(zone => decisions.get(zone.id)?.irrigation.allowsStart)
  const deferredTargets = hydrateMeta.targeted.filter(zone => !decisions.get(zone.id)?.irrigation.allowsStart)
  const weatherContext = zones.length > 0 ? decisions.get(zones[0].id)?.weather : null
  const hydrateDisabled = irrigationSettings.ripeningMode || actionableTargets.length === 0
  const hydrateReason = irrigationSettings.ripeningMode
    ? "Ripening mode is active"
    : actionableTargets.length === 0
      ? deferredTargets[0]
        ? decisions.get(deferredTargets[0].id)?.irrigation.reason || "Weather conditions defer hydration."
        : "All grids are green"
      : null

  const payload = zones.map(zone => {
    const det = detectionByZone.get(zone.id)
    return {
      ...zone,
      // Prefer the in-memory live scan when present, otherwise fall back to
      // the persisted detection so seeded/historical scans render identically.
      disease: zone.disease || det?.disease,
      canonicalDisease: zone.canonicalDisease || det?.canonicalDisease || det?.disease,
      mlConfidence: zone.mlConfidence ?? (typeof det?.confidence === "number" ? det.confidence : undefined),
      severityLevel: zone.severityLevel || det?.severityLevel,
      severityScore: zone.severityScore ?? det?.severityScore,
      lastAnalyzed: zone.lastAnalyzed || det?.timestamp,
      cycleStatus: zone.cycle?.state || "idle",
      pumpStatus: zone.pumpStatus || "off",
      sensorError: zone.sensor?.hasError || false,
      sensorErrorMessage: zone.sensor?.errorMessage || null,
      activeDetection: activeDetectionZoneIds.has(zone.id),
      cropReview: cropReviewZoneIds.has(zone.id),
      decisions: decisions.get(zone.id),
    }
  })

  return NextResponse.json({
    zones: payload,
    farmClimate,
    climatePresentation,
    weather: weatherContext
      ? { ...weatherContext, sprayWindow: weatherForecast.derived.sprayWindow }
      : null,
    stress,
    controller: {
      ...hardwareState,
      queuedCommandCount: Object.values(pendingCommands).reduce((total, queue) => total + queue.length, 0),
    },
    recentActivity: activityLog.slice(0, 6),
    irrigation: {
      dryThreshold: irrigationSettings.dryThreshold,
      wetThreshold: irrigationSettings.wetThreshold,
      ripeningMode: irrigationSettings.ripeningMode,
      hydrateDisabled,
      hydrateReason,
      targetedZoneIds: actionableTargets.map(zone => zone.id),
      deferredZoneIds: deferredTargets.map(zone => zone.id),
      ignoredZoneIds: hydrateMeta.ignored,
      globalHydrateRequest,
    },
  })
}
