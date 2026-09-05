import { NextResponse } from "next/server"
import {
  hardwareState,
  queueIrrigationPulses,
  zones,
  irrigationSettings,
  getFarmClimate,
  setGlobalHydrateRequest,
} from "../zones/data"
import { getForecast } from "@/app/lib/weatherService"
import { decideFarmActions } from "@/app/lib/farmDecisionService"
import { getIrrigationPulsePlan, MAX_IRRIGATION_PULSES, PUMP_CALIBRATED } from "@/app/lib/demoHardware"
import { readDB, writeDB } from "@/app/lib/database"
import { buildWaterLogEntry } from "@/app/lib/waterLedger"
import { getCurrentFarmId } from "@/app/lib/farmContext"
import { estimatePulseLitres } from "@/app/lib/flowModel"

export async function POST(req: Request) {
  const { zoneId, pulses, globalRequest, globalTargetZoneIds } = await req.json()
  
  if (hardwareState.killSwitchEngaged) {
    return NextResponse.json({ message: "Safety kill switch is engaged" }, { status: 423 })
  }
  
  if (!zoneId) {
    return NextResponse.json({ message: "Zone ID is required" }, { status: 400 })
  }

  const zone = zones.find(item => item.id === zoneId)
  if (!zone) {
    return NextResponse.json({ message: "Zone not found" }, { status: 404 })
  }

  const weather = await getForecast()
  const decision = decideFarmActions({
    soilMoisture: zone.soilMoisture,
    dryThreshold: irrigationSettings.dryThreshold,
    climate: getFarmClimate(),
    weather,
  })

  const requestedPulses = Number.isFinite(Number(pulses))
    ? Number(pulses)
    : getIrrigationPulsePlan(zone.soilMoisture, irrigationSettings.dryThreshold).pulses
  const queued = queueIrrigationPulses(zoneId, requestedPulses, decision.irrigation)
  if (!queued.queued) {
    return NextResponse.json(
      {
        message: queued.message || decision.irrigation.reason || `Hydration skipped for ${zoneId}: ${queued.reason}`,
        decision,
      },
      { status: 409 },
    )
  }

  // A global action still queues one bounded controller command per zone, but
  // preserves the full target list so the dashboard can explain what the
  // single shared pump will irrigate.
  if (globalRequest && Array.isArray(globalTargetZoneIds)) {
    const targetedZones = globalTargetZoneIds.filter(
      (id: unknown): id is string => typeof id === "string" && zones.some(zone => zone.id === id),
    )
    setGlobalHydrateRequest({
      requestedAt: new Date().toISOString(),
      targetedZones,
      pumpControllerZone: zoneId,
    })
  }

  // Record the estimated irrigation volume in the unified, farmId-stamped
  // ledger so it counts toward the same honest water analytics as sprays.
  const farmId = getCurrentFarmId()
  const db = readDB()
  db.waterLog.push(
    buildWaterLogEntry({
      farmId,
      zoneId,
      kind: "irrigation",
      mode: "irrigation",
      pulses: queued.pulses,
      status: "queued",
    }),
  )
  writeDB(db)

  // The controller-reported pulse count is the only real delivery number until
  // the actual rig pump is calibrated; volume stays a labelled model estimate.
  const estL = estimatePulseLitres(queued.pulses)
  const showLitres = PUMP_CALIBRATED && estL != null
  return NextResponse.json({
    message: `Bounded irrigation loop started on ${zoneId} — 3-second pulses, checks soil after each, stops at target or after ${MAX_IRRIGATION_PULSES} pulses. Est. ${queued.pulses} pulse${queued.pulses === 1 ? "" : "s"}${showLitres ? ` (≈${estL!.toFixed(1)} L, calibration-model estimate)` : ""}.`,
    decision,
    estimatedPulses: queued.pulses,
    maxPulses: MAX_IRRIGATION_PULSES,
    pulseMs: queued.pulseMs,
    estimatedLitres: showLitres ? estL : null,
  })
}
