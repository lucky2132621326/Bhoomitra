import {
  ZoneStatus,
  ZoneData,
  ZoneHistoryEntry,
  GridColor,
  DetectionEvent,
  VpdBand,
  IrrigationCycleRuntime,
  SensorRuntime,
} from "./types"
import fs from "fs"
import path from "path"
import { readDB, writeDB } from "@/app/lib/database"
import {
  FARM_DECISION_CONFIG,
  buildFarmClimateSnapshot,
  calculateAirVpd,
  classifyVpd,
  isValidClimateReading,
  type FarmClimateSnapshot,
} from "@/app/lib/farmDecisionService"
import {
  DEMO_CONTROL_ZONE_IDS,
  IRRIGATION_PULSE_MS,
  isDemoControlZone,
} from "@/app/lib/demoHardware"

const globalMemory = global as any

type FarmProfile = {
  acres: number
  zoneSizeAcres: number
  totalZones: number
  rows: number
  cols: number
}

type FarmerProfileFile = {
  acres?: number
  zones?: number
  zoneCount?: number
  primaryCrop?: string
}

export type HardwareNozzleStatus = "idle" | "pending" | "open" | "clogged" | "closed"

export type HardwareState = {
  killSwitchEngaged: boolean
  currentAction: "idle" | "spray" | "hydrate" | "moving"
  activeZoneId: string | null
  currentPath: string[]
  nozzleStatus: HardwareNozzleStatus
  lastCommand: string | null
  lastCommandAt: string | null
  lastFeedback: string | null
  lastFeedbackAt: string | null
  awaitingFeedback: boolean
}

export type IrrigationSettings = {
  dryThreshold: number
  wetThreshold: number
  ripeningMode: boolean
  singlePumpMode: boolean
  cycleOnMs: number
  cycleOffMs: number
  maxDurationMs: number
  unchangedSensorMs: number
  minChangePercent: number
}

export type SprayWindowStatus = {
  vpd: number | null
  band: VpdBand
  message: string
  sprayEnabled: boolean
}

export type FarmClimatePresentation = {
  source: "dht11" | "reference"
  isLive: boolean
  temperature: number
  humidity: number
  vpd: number
  vpdBand: VpdBand
  lastUpdatedAt: number | null
  message: string
}

type FarmClimateRuntime = {
  rawTemperature: number | null
  rawHumidity: number | null
  temperature: number | null
  humidity: number | null
  lastValidAt: number | null
  sampleCount: number
}

const farmerProfilePath = path.join(process.cwd(), "app/data/farmer_profile.json")
const irrigationSettingsPath = path.join(process.cwd(), "app/data/irrigation_settings.json")
const farmClimatePath = path.join(process.cwd(), "app/data/farm_climate.json")

// The product spec and physical pilot both fix the farm map at 12 zones
// (A1-A6, B1-B6). This is a hard constant, not a function of acreage.
const CANONICAL_ZONE_COUNT = 12
const CANONICAL_ZONE_COLS = 6

const DEFAULT_SETTINGS: IrrigationSettings = {
  dryThreshold: 40,
  wetThreshold: 60,
  ripeningMode: false,
  singlePumpMode: true,
  // The physical prototype executes one three-second pulse per queued
  // irrigation command. Longer repeating cycles would misrepresent it.
  cycleOnMs: IRRIGATION_PULSE_MS,
  cycleOffMs: 0,
  maxDurationMs: IRRIGATION_PULSE_MS,
  unchangedSensorMs: 30 * 60 * 1000,
  minChangePercent: 0.5,
}

// A calm, plausible calibration reference keeps the presentation useful before
// hardware is connected. It is display-only: automation decisions still wait
// for an actual fresh DHT11 payload.
const PRESENTATION_CLIMATE_REFERENCE = {
  temperature: 28,
  humidity: 69,
} as const

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function readFarmerProfile(): FarmerProfileFile | null {
  try {
    if (!fs.existsSync(farmerProfilePath)) return null
    const raw = fs.readFileSync(farmerProfilePath, "utf-8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function readIrrigationSettings(): IrrigationSettings {
  try {
    if (!fs.existsSync(irrigationSettingsPath)) {
      fs.writeFileSync(irrigationSettingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf-8")
      return { ...DEFAULT_SETTINGS }
    }

    const parsed = JSON.parse(fs.readFileSync(irrigationSettingsPath, "utf-8"))
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      dryThreshold: clamp(Number(parsed?.dryThreshold ?? DEFAULT_SETTINGS.dryThreshold), 5, 95),
      wetThreshold: clamp(Number(parsed?.wetThreshold ?? DEFAULT_SETTINGS.wetThreshold), 5, 95),
      // Migrate the old 10m-on/50m-off demo configuration in memory. A
      // three-second hardware pulse is the only honest actuator duration.
      cycleOnMs: IRRIGATION_PULSE_MS,
      cycleOffMs: 0,
      maxDurationMs: IRRIGATION_PULSE_MS,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeIrrigationSettings(settings: IrrigationSettings) {
  fs.writeFileSync(irrigationSettingsPath, JSON.stringify(settings, null, 2), "utf-8")
}

function getPlantingDensityDivisor(primaryCrop?: string) {
  const crop = (primaryCrop || "").toLowerCase()

  if (crop.includes("tomato")) return 4
  if (crop.includes("rice") || crop.includes("paddy")) return 1
  if (crop.includes("cotton")) return 6
  return 3
}

function calculateInitialHealthScore(soilMoisture: number, humidity: number, temperature: number) {
  const moisturePenalty = Math.abs(65 - soilMoisture) * 0.8
  const humidityPenalty = Math.max(0, humidity - 75) * 0.5
  const temperaturePenalty = Math.abs(24 - temperature) * 0.6
  return clamp(Math.round(100 - moisturePenalty - humidityPenalty - temperaturePenalty), 35, 95)
}

function getRowLabel(index: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  let value = index
  let label = ""

  do {
    label = alphabet[value % 26] + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)

  return label
}

function buildFarmProfile(acresInput: number, zoneSizeAcresInput: number): FarmProfile {
  const acres = clamp(Number.isFinite(acresInput) ? acresInput : 6, 2, 10)
  const zoneSizeAcres = clamp(Number.isFinite(zoneSizeAcresInput) ? zoneSizeAcresInput : 0.25, 0.1, 1)
  const totalZones = Math.max(1, Math.ceil(acres / zoneSizeAcres))
  const cols = Math.max(2, Math.ceil(Math.sqrt(totalZones)))
  const rows = Math.max(1, Math.ceil(totalZones / cols))

  return {
    acres,
    zoneSizeAcres,
    totalZones,
    rows,
    cols,
  }
}

function getGridColorByMoisture(soilMoisture: number, settings: IrrigationSettings): GridColor {
  if (soilMoisture < settings.dryThreshold) return "red"
  if (soilMoisture < settings.wetThreshold) return "yellow"
  return "green"
}

function createDefaultSensorRuntime(): SensorRuntime {
  return {
    hasError: false,
    errorMessage: null,
    lastValidAt: null,
    lastValue: null,
    unchangedSince: null,
  }
}

function createDefaultCycleRuntime(): IrrigationCycleRuntime {
  return {
    active: false,
    state: "idle",
    cycleStartedAt: null,
    phaseStartedAt: null,
    totalElapsedMs: 0,
    pumpOn: false,
    targetByGlobalHydrate: false,
  }
}

function createDefaultFarmClimate(): FarmClimateRuntime {
  return {
    rawTemperature: null,
    rawHumidity: null,
    temperature: null,
    humidity: null,
    lastValidAt: null,
    sampleCount: 0,
  }
}

type PersistedFarmClimate = {
  version: 1
  state: FarmClimateRuntime
  samples: { temperature: number[]; humidity: number[] }
}

function readFarmClimateStore(): PersistedFarmClimate | null {
  try {
    if (!fs.existsSync(farmClimatePath)) return null
    const parsed = JSON.parse(fs.readFileSync(farmClimatePath, "utf-8"))
    const state = parsed?.state
    const samples = parsed?.samples
    if (!state || !samples || !Array.isArray(samples.temperature) || !Array.isArray(samples.humidity)) return null

    return {
      version: 1,
      state: {
        rawTemperature: Number.isFinite(state.rawTemperature) ? state.rawTemperature : null,
        rawHumidity: Number.isFinite(state.rawHumidity) ? state.rawHumidity : null,
        temperature: Number.isFinite(state.temperature) ? state.temperature : null,
        humidity: Number.isFinite(state.humidity) ? state.humidity : null,
        lastValidAt: Number.isFinite(state.lastValidAt) ? state.lastValidAt : null,
        sampleCount: Math.max(0, Number(state.sampleCount) || 0),
      },
      samples: {
        temperature: samples.temperature.filter((value: unknown) => Number.isFinite(value)),
        humidity: samples.humidity.filter((value: unknown) => Number.isFinite(value)),
      },
    }
  } catch {
    return null
  }
}

function writeFarmClimateStore(state: FarmClimateRuntime, samples: { temperature: number[]; humidity: number[] }) {
  const payload: PersistedFarmClimate = {
    version: 1,
    state,
    samples,
  }
  fs.writeFileSync(farmClimatePath, JSON.stringify(payload, null, 2), "utf-8")
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function generateZones(profile: FarmProfile, settings: IrrigationSettings): ZoneData[] {
  const zoneList: ZoneData[] = []
  const farmerProfile = readFarmerProfile()
  const acres = farmerProfile?.acres ?? profile.acres
  // The farm map is a fixed 12-zone layout (A1-A6, B1-B6): only A1-A4 carry a
  // physical pump, and the product spec forbids ever showing a different zone
  // count (e.g. 24). Zone count must never be derived from acreage or a stale
  // profile.totalZones — both can disagree with this fixed grid and produce
  // wrong ids like C1/C2 instead of A6/B6. Acreage still drives plant density.
  const zoneCount = CANONICAL_ZONE_COUNT
  const cols = CANONICAL_ZONE_COLS
  const zoneAreaSqYards = (acres * 4840) / Math.max(1, zoneCount)
  const densityDivisor = getPlantingDensityDivisor(farmerProfile?.primaryCrop)
  const dynamicPlantCount = Math.max(1, Math.floor(zoneAreaSqYards / densityDivisor))

  const getInitialStatus = (index: number): ZoneStatus => {
    if (index === 0 || index === 1) return "warning"
    if (index === 2 || index === 3) return "critical"
    return "healthy"
  }

  const getInitialSoilMoisture = (status: ZoneStatus) => {
    if (status === "warning") return 38
    if (status === "critical") return 22
    return 72
  }

  for (let i = 0; i < zoneCount; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const rowLabel = getRowLabel(row)
    const id = `${rowLabel}${col + 1}`

    const status = getInitialStatus(i)
    const moisture = getInitialSoilMoisture(status)
    // The DHT11 is a single fixed farm-climate station, so zones do not get
    // invented temperature/humidity readings at seed time. Climate stays
    // unavailable until a real DHT11 report arrives.
    const temperature = 0
    const humidity = 0
    const healthScore = calculateInitialHealthScore(moisture, 75, 26)

    zoneList.push({
      id,
      row,
      col,
      status,
      lastSprayed: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
      soilMoisture: moisture,
      temperature,
      humidity,
      plantCount: dynamicPlantCount,
      healthScore,
      gridColor: getGridColorByMoisture(moisture, settings),
      dryThreshold: settings.dryThreshold,
      wetThreshold: settings.wetThreshold,
      hydrateEligible: moisture < settings.wetThreshold,
      sensor: createDefaultSensorRuntime(),
      cycle: createDefaultCycleRuntime(),
      pumpStatus: "off",
      vpd: 0,
      vpdBand: "red",
      sprayEnabled: false,
      sprayMessage: "Hold spray until optimal VPD window",
    })
  }

  return zoneList
}

function generateZoneHistory(zoneList: ZoneData[]): ZoneHistoryEntry[] {
  return zoneList.map(zone => ({
    zoneId: zone.id,
    moistureHistory: [zone.soilMoisture],
    temperatureHistory: [zone.temperature],
    sprays: 0,
    diseaseHistory: [],
    confidenceHistory: [],
    severityHistory: [],
    timestampHistory: [],
    treatmentHistory: [],
  }))
}

export function calculateVPD(temperature: number, humidity: number) {
  return calculateAirVpd(temperature, humidity)
}

export function getSprayWindowStatus(temperature: number | null, humidity: number | null): SprayWindowStatus {
  if (!isValidClimateReading(temperature, humidity)) {
    return {
      vpd: null,
      band: "unavailable",
      message: "Farm climate reading unavailable; VPD cannot clear spraying.",
      sprayEnabled: false,
    }
  }

  const vpd = calculateVPD(temperature as number, humidity as number)
  const band = classifyVpd(vpd)

  return {
    vpd: Number(vpd.toFixed(3)),
    band,
    message: band === "red" ? "Farm VPD is outside the configured spray window" : band === "orange" ? "Farm VPD is marginal; use caution" : "Farm VPD is in the configured spray window",
    sprayEnabled: band === "green",
  }
}

export const simulationEnabledRef = globalMemory.simulationEnabledRef || { value: false }
if (!globalMemory.simulationEnabledRef) globalMemory.simulationEnabledRef = simulationEnabledRef

export const hardwareState: HardwareState = globalMemory.hardwareState || {
  killSwitchEngaged: false,
  currentAction: "idle",
  activeZoneId: null,
  currentPath: [],
  nozzleStatus: "idle",
  lastCommand: null,
  lastCommandAt: null,
  lastFeedback: null,
  lastFeedbackAt: null,
  awaitingFeedback: false,
}
if (!globalMemory.hardwareState) globalMemory.hardwareState = hardwareState

export function updateHardwareState(partial: Partial<HardwareState>) {
  Object.assign(hardwareState, partial)
  globalMemory.hardwareState = hardwareState
  return hardwareState
}

// Acreage must come from the SAME source the map and farmer profile read
// (farmer_profile.json), or cross-page numbers disagree (e.g. map shows 2 ac
// while analytics shows the env/default 6). The persisted profile wins.
const persistedFarmerAcres = readFarmerProfile()?.acres
const defaultProfile = buildFarmProfile(
  Number(persistedFarmerAcres ?? process.env.FARM_ACRES ?? 6),
  Number(process.env.FARM_ZONE_SIZE_ACRES ?? 0.25),
)

export let irrigationSettings: IrrigationSettings = globalMemory.irrigationSettings || readIrrigationSettings()
if (!globalMemory.irrigationSettings) globalMemory.irrigationSettings = irrigationSettings

export function updateIrrigationSettings(partial: Partial<IrrigationSettings>) {
  irrigationSettings = {
    ...irrigationSettings,
    ...partial,
    dryThreshold: clamp(Number(partial.dryThreshold ?? irrigationSettings.dryThreshold), 5, 95),
    wetThreshold: clamp(Number(partial.wetThreshold ?? irrigationSettings.wetThreshold), 5, 95),
  }

  if (irrigationSettings.wetThreshold <= irrigationSettings.dryThreshold) {
    irrigationSettings.wetThreshold = Math.min(95, irrigationSettings.dryThreshold + 5)
  }

  writeIrrigationSettings(irrigationSettings)
  globalMemory.irrigationSettings = irrigationSettings

  zones = zones.map(zone => deriveZoneRuntime(zone))
  globalMemory.zones = zones
  return irrigationSettings
}

export let farmProfile: FarmProfile = globalMemory.farmProfile || defaultProfile
if (!globalMemory.farmProfile) globalMemory.farmProfile = farmProfile

const persistedFarmClimate = readFarmClimateStore()
export let farmClimate: FarmClimateRuntime = globalMemory.farmClimate || persistedFarmClimate?.state || createDefaultFarmClimate()
if (!globalMemory.farmClimate) globalMemory.farmClimate = farmClimate

let farmClimateSamples: { temperature: number[]; humidity: number[] } = globalMemory.farmClimateSamples || persistedFarmClimate?.samples || {
  temperature: [],
  humidity: [],
}
if (!globalMemory.farmClimateSamples) globalMemory.farmClimateSamples = farmClimateSamples

function refreshFarmClimateFromDisk() {
  const persisted = readFarmClimateStore()
  if (!persisted) return

  const persistedAt = persisted.state.lastValidAt || 0
  const memoryAt = farmClimate.lastValidAt || 0
  if (persistedAt >= memoryAt) {
    farmClimate = persisted.state
    farmClimateSamples = persisted.samples
    globalMemory.farmClimate = farmClimate
    globalMemory.farmClimateSamples = farmClimateSamples
  }
}

export function getFarmClimate(now = Date.now()): FarmClimateSnapshot {
  refreshFarmClimateFromDisk()
  return buildFarmClimateSnapshot({
    ...farmClimate,
    now,
  })
}

export function getFarmClimatePresentation(
  climate: FarmClimateSnapshot = getFarmClimate(),
): FarmClimatePresentation {
  if (
    climate.fresh &&
    climate.temperature !== null &&
    climate.humidity !== null &&
    climate.vpd !== null
  ) {
    return {
      source: "dht11",
      isLive: true,
      temperature: climate.temperature,
      humidity: climate.humidity,
      vpd: climate.vpd,
      vpdBand: climate.vpdBand,
      lastUpdatedAt: climate.lastValidAt,
      message: "Live reading from the fixed DHT11 climate station.",
    }
  }

  const vpd = Number(
    calculateAirVpd(
      PRESENTATION_CLIMATE_REFERENCE.temperature,
      PRESENTATION_CLIMATE_REFERENCE.humidity,
    ).toFixed(3),
  )

  return {
    source: "reference",
    isLive: false,
    temperature: PRESENTATION_CLIMATE_REFERENCE.temperature,
    humidity: PRESENTATION_CLIMATE_REFERENCE.humidity,
    vpd,
    vpdBand: classifyVpd(vpd),
    lastUpdatedAt: null,
    message: "Calibrated farm reference shown until the live DHT11 feed connects.",
  }
}

/**
 * Updates the one fixed DHT11 station. Soil moisture remains scoped to the
 * incoming zone, but ambient temperature/humidity and VPD are farm-wide.
 */
export function updateFarmClimate(temperature: number, humidity: number) {
  if (!isValidClimateReading(temperature, humidity)) {
    return getFarmClimate()
  }

  refreshFarmClimateFromDisk()

  const maxSamples = FARM_DECISION_CONFIG.dht11SmoothingWindow
  farmClimateSamples.temperature.push(temperature)
  farmClimateSamples.humidity.push(humidity)
  while (farmClimateSamples.temperature.length > maxSamples) farmClimateSamples.temperature.shift()
  while (farmClimateSamples.humidity.length > maxSamples) farmClimateSamples.humidity.shift()

  const now = Date.now()
  farmClimate = {
    rawTemperature: temperature,
    rawHumidity: humidity,
    temperature: Number(median(farmClimateSamples.temperature).toFixed(1)),
    humidity: Number(median(farmClimateSamples.humidity).toFixed(1)),
    lastValidAt: now,
    sampleCount: farmClimateSamples.temperature.length,
  }
  globalMemory.farmClimate = farmClimate
  globalMemory.farmClimateSamples = farmClimateSamples
  writeFarmClimateStore(farmClimate, farmClimateSamples)

  // Compatibility fields are synchronized for older consumers. They are
  // deliberately the same value for every zone because DHT11 is fixed.
  zones = zones.map(zone => deriveZoneRuntime({
    ...zone,
    temperature: farmClimate.temperature ?? zone.temperature,
    humidity: farmClimate.humidity ?? zone.humidity,
  }))
  globalMemory.zones = zones

  return getFarmClimate(now)
}

export let zones: ZoneData[] = globalMemory.zones || generateZones(farmProfile, irrigationSettings)
if (!globalMemory.zones) globalMemory.zones = zones

export let zoneHistory: ZoneHistoryEntry[] = globalMemory.zoneHistory || generateZoneHistory(zones)
if (!globalMemory.zoneHistory) globalMemory.zoneHistory = zoneHistory

export const activityLog: {
  type: "spray" | "alert" | "water"
  zoneId: string
  timestamp: string
}[] = globalMemory.activityLog || readDB().activityLog || []
if (!globalMemory.activityLog) globalMemory.activityLog = activityLog

export function recordActivity(entry: {
  type: "spray" | "alert" | "water"
  zoneId: string
  timestamp?: string
}) {
  const item = {
    type: entry.type,
    zoneId: entry.zoneId,
    timestamp: entry.timestamp || new Date().toISOString(),
  }

  activityLog.unshift(item)
  if (activityLog.length > 200) activityLog.pop()

  const db = readDB()
  db.activityLog.unshift(item)
  writeDB(db)
  globalMemory.activityLog = activityLog
}

export const pendingCommands: Record<string, ("spray" | "water" | "stop")[]> = globalMemory.pendingCommands || {}
if (!globalMemory.pendingCommands) globalMemory.pendingCommands = pendingCommands

export type GlobalHydrateRequest = {
  requestedAt: string
  targetedZones: string[]
  pumpControllerZone: string | null
}

export let globalHydrateRequest: GlobalHydrateRequest | null = globalMemory.globalHydrateRequest || null
if (!globalMemory.globalHydrateRequest) globalMemory.globalHydrateRequest = globalHydrateRequest

export function setGlobalHydrateRequest(request: GlobalHydrateRequest | null) {
  globalHydrateRequest = request
  globalMemory.globalHydrateRequest = request
}

export function enqueueCommand(zoneId: string, command: "spray" | "water" | "stop") {
  if (!pendingCommands[zoneId]) pendingCommands[zoneId] = []
  const queue = pendingCommands[zoneId]
  const last = queue[queue.length - 1]
  if (last !== command) {
    queue.push(command)
  }
}

/**
 * Cancel water commands that have not reached the controller yet. Active pump
 * work is deliberately not interrupted here; it must finish or be stopped by
 * the hardware safety control.
 */
export function clearPendingIrrigationQueue() {
  const clearedZoneIds: string[] = []

  for (const [zoneId, queue] of Object.entries(pendingCommands)) {
    const remaining = queue.filter(command => command !== "water")
    if (remaining.length !== queue.length) clearedZoneIds.push(zoneId)

    if (remaining.length > 0) {
      pendingCommands[zoneId] = remaining
    } else {
      delete pendingCommands[zoneId]
    }
  }

  setGlobalHydrateRequest(null)
  return { clearedZoneIds }
}

/**
 * Move a queued command into the controller's active state. A command leaves
 * `pendingCommands` only when the controller polls it, not merely because the
 * dashboard asked for it.
 */
export function markCommandDispatched(zoneId: string, command: "spray" | "water" | "stop") {
  const now = new Date().toISOString()
  const idx = zones.findIndex(zone => zone.id === zoneId)

  if (idx >= 0) {
    const zone = deriveZoneRuntime(zones[idx])
    if (command === "water") {
      zones[idx] = deriveZoneRuntime({
        ...zone,
        lastIrrigated: now,
        pumpStatus: "on",
        cycle: {
          ...(zone.cycle || createDefaultCycleRuntime()),
          active: true,
          state: "running",
          pumpOn: true,
          phaseStartedAt: Date.now(),
          lastReason: "water_pulse_dispatched",
        },
      })
    } else if (command === "stop") {
      zones[idx] = deriveZoneRuntime({
        ...zone,
        pumpStatus: "off",
        cycle: {
          ...(zone.cycle || createDefaultCycleRuntime()),
          active: false,
          state: "done",
          pumpOn: false,
          phaseStartedAt: Date.now(),
          lastReason: "stop_dispatched",
        },
      })
    } else {
      zones[idx] = deriveZoneRuntime({ ...zone, lastSprayed: now })
    }
  }

  updateHardwareState({
    currentAction: command === "water" ? "hydrate" : command === "spray" ? "spray" : "idle",
    activeZoneId: command === "stop" ? null : zoneId,
    currentPath: command === "stop" ? [] : [zoneId],
    nozzleStatus: command === "stop" ? "closed" : "pending",
    lastCommand: `${command}:${zoneId}`,
    lastCommandAt: now,
    awaitingFeedback: command !== "stop",
  })
}

/**
 * Hand out the next queued command across the whole A1–A4 demo rig, not just
 * whichever zone happens to have a live sensor. The prototype has exactly one
 * physical soil probe (on A1), so /api/sensor's own dispatch-on-report never
 * fires for A2–A4 — their queued "water" commands would sit forever. The
 * bridge polls this endpoint on its own timer (independent of sensor pushes)
 * and paces requests so the single shared pump/servo only ever runs one
 * zone's pulse at a time, in a fixed A1→A4 order.
 */
export function dispatchNextPendingCommand() {
  for (const zoneId of DEMO_CONTROL_ZONE_IDS) {
    const queue = pendingCommands[zoneId]
    if (queue && queue.length > 0) {
      const command = queue.shift() as "spray" | "water" | "stop"
      markCommandDispatched(zoneId, command)
      return { zoneId, command, remainingQueue: queue.length }
    }
  }
  return { zoneId: null, command: null, remainingQueue: 0 }
}

/** Record controller feedback and finish a pulse only after the pump closes. */
export function recordControllerFeedback(
  zoneId: string,
  nozzleStatus: HardwareNozzleStatus,
  feedbackMessage?: string | null,
  currentPath?: string[],
) {
  const now = new Date().toISOString()
  const terminal = nozzleStatus === "closed" || nozzleStatus === "idle" || nozzleStatus === "clogged"
  const queue = pendingCommands[zoneId] || []
  const idx = zones.findIndex(zone => zone.id === zoneId)

  if (idx >= 0 && terminal) {
    const zone = deriveZoneRuntime(zones[idx])
    const moreWaterPulses = queue.includes("water")
    zones[idx] = deriveZoneRuntime({
      ...zone,
      pumpStatus: "off",
      cycle: {
        ...(zone.cycle || createDefaultCycleRuntime()),
        active: moreWaterPulses && nozzleStatus !== "clogged",
        state: nozzleStatus === "clogged" ? "error" : moreWaterPulses ? "cooldown" : "done",
        pumpOn: false,
        phaseStartedAt: Date.now(),
        lastReason: nozzleStatus === "clogged" ? "controller_reported_clog" : moreWaterPulses ? "pulse_complete_next_queued" : "pulse_plan_complete",
      },
    })
  }

  // Chemical records are finalized only after the controller reports that the
  // spray pulse closed. A queued command is deliberately not counted as an
  // application, and a water-only validation is deliberately not counted as a
  // chemical spray.
  if (nozzleStatus === "closed" && hardwareState.currentAction === "spray" && hardwareState.lastCommand === `spray:${zoneId}`) {
    const db = readDB()
    const queuedSprays = db.sprays
      .filter((spray: any) => spray.zoneId === zoneId && spray.applicationStatus === "queued")
      .sort((a: any, b: any) => Date.parse(String(a.queuedAt || a.timestamp)) - Date.parse(String(b.queuedAt || b.timestamp)))
    const spray = queuedSprays[queuedSprays.length - 1]

    if (spray) {
      spray.applicationStatus = "completed"
      spray.completedAt = now

      if (spray.applicationMode === "farmer-confirmed-mix") {
        const detection = spray.detectionId
          ? db.detections.find((item: any) => item.id === spray.detectionId)
          : null
        if (detection && detection.status === "active") {
          detection.status = "treated"
          detection.treatedAt = now
          detection.linkedSprayId = spray.id
        }

        const historyEntry = zoneHistory.find((entry) => entry.zoneId === zoneId)
        if (historyEntry) historyEntry.sprays += 1

        if (idx >= 0) {
          const zone = deriveZoneRuntime(zones[idx])
          const remainingActive = db.detections.filter((item: any) => item.zoneId === zoneId && item.status === "active")
          const nextStatus: ZoneStatus = remainingActive.length > 0
            ? remainingActive.some((item: any) => item.severityLevel === "high")
              ? "critical"
              : "warning"
            : "warning"
          zones[idx] = deriveZoneRuntime({
            ...zone,
            status: nextStatus,
            disease: remainingActive[0]?.disease || zone.disease,
            lastSprayed: now,
          })
        }
      }

      writeDB(db)
      if (spray.applicationMode === "farmer-confirmed-mix") {
        recordActivity({ type: "spray", zoneId, timestamp: now })
      }
    }
  }

  if (nozzleStatus === "closed" && hardwareState.currentAction === "hydrate" && hardwareState.lastCommand === `water:${zoneId}`) {
    recordActivity({ type: "water", zoneId, timestamp: now })
  }

  const moreQueuedCommands = queue.length > 0 && nozzleStatus !== "clogged"
  updateHardwareState({
    nozzleStatus,
    awaitingFeedback: nozzleStatus === "pending" || nozzleStatus === "open",
    lastFeedback: feedbackMessage || (nozzleStatus === "open" ? "Pump opened" : nozzleStatus === "closed" ? "Pump pulse completed" : nozzleStatus === "clogged" ? "Controller reported a nozzle issue" : "Controller idle"),
    lastFeedbackAt: now,
    currentPath: currentPath || (zoneId ? [zoneId] : []),
    currentAction: terminal && !moreQueuedCommands ? "idle" : hardwareState.currentAction,
    activeZoneId: terminal && !moreQueuedCommands ? null : zoneId || hardwareState.activeZoneId,
  })
}

/**
 * Queue discrete irrigation pulses for the physical A1–A4 demo area.
 * The board performs one three-second water pulse for each `water` command.
 */
export function queueIrrigationPulses(
  zoneId: string,
  requestedPulses: number,
  weatherGate?: { allowsStart: boolean; action: string; reason: string },
) {
  const idx = zones.findIndex(zone => zone.id === zoneId)
  if (idx < 0) return { queued: false, reason: "zone_not_found", pulses: 0 }
  if (!isDemoControlZone(zoneId)) {
    return {
      queued: false,
      reason: "outside_demo_control_area",
      pulses: 0,
      message: `The live irrigation pump is demonstrated on ${DEMO_CONTROL_ZONE_IDS.join(", ")}.`,
    }
  }

  const zone = deriveZoneRuntime(zones[idx])
  if (irrigationSettings.ripeningMode) return { queued: false, reason: "ripening_mode", pulses: 0 }
  if (zone.sensor?.hasError) return { queued: false, reason: "sensor_error", pulses: 0 }
  if ((zone.gridColor || "green") === "green") return { queued: false, reason: "grid_green", pulses: 0 }
  if (weatherGate && !weatherGate.allowsStart) {
    return { queued: false, reason: weatherGate.action, message: weatherGate.reason, pulses: 0 }
  }

  // `pulses` is only an ESTIMATE of how many short pulses the closed loop will
  // likely need. We queue exactly ONE "water" command — the controller then
  // runs its own loop (pulse → check soil → repeat) and stops when the zone
  // reaches target. The hardware owns the loop; the app never stacks pulses.
  const pulses = Math.max(1, Math.round(Number(requestedPulses) || 1))
  if (!pendingCommands[zoneId]) pendingCommands[zoneId] = []
  pendingCommands[zoneId].push("water")

  zones[idx] = deriveZoneRuntime({
    ...zone,
    cycle: {
      ...(zone.cycle || createDefaultCycleRuntime()),
      active: true,
      state: "running",
      cycleStartedAt: Date.now(),
      phaseStartedAt: Date.now(),
      totalElapsedMs: 0,
      pumpOn: false,
      targetByGlobalHydrate: false,
      lastReason: "irrigate_to_target_loop",
    },
  })

  updateHardwareState({
    currentAction: "hydrate",
    activeZoneId: zoneId,
    currentPath: [zoneId],
    nozzleStatus: "pending",
    lastCommand: `hydrate:${zoneId}:loop-to-target`,
    lastCommandAt: new Date().toISOString(),
    awaitingFeedback: true,
  })

  return { queued: true, pulses, reason: "ok", pulseMs: IRRIGATION_PULSE_MS }
}

export function stopIrrigationCycle(zoneId: string, reason: string) {
  const idx = zones.findIndex(z => z.id === zoneId)
  if (idx < 0) return

  const current = zones[idx]
  const cycle = current.cycle || createDefaultCycleRuntime()
  const next: IrrigationCycleRuntime = {
    ...cycle,
    active: false,
    state: reason === "sensor_error" ? "error" : "done",
    pumpOn: false,
    targetByGlobalHydrate: false,
    lastReason: reason,
    phaseStartedAt: Date.now(),
  }

  zones[idx] = deriveZoneRuntime({
    ...current,
    cycle: next,
    pumpStatus: "off",
  })

  enqueueCommand(zoneId, "stop")
}

export function startIrrigationCycle(
  zoneId: string,
  targetByGlobalHydrate = false,
  weatherGate?: { allowsStart: boolean; action: string; reason: string },
) {
  const idx = zones.findIndex(z => z.id === zoneId)
  if (idx < 0) return { started: false, reason: "zone_not_found" }
  if (!isDemoControlZone(zoneId)) {
    return { started: false, reason: "outside_demo_control_area" }
  }

  const zone = deriveZoneRuntime(zones[idx])
  if (irrigationSettings.ripeningMode) return { started: false, reason: "ripening_mode" }
  if (zone.sensor?.hasError) return { started: false, reason: "sensor_error" }
  if ((zone.gridColor || "green") === "green") return { started: false, reason: "grid_green" }
  if (weatherGate && !weatherGate.allowsStart) {
    return { started: false, reason: weatherGate.action, message: weatherGate.reason }
  }

  const now = Date.now()
  const nextCycle: IrrigationCycleRuntime = {
    ...(zone.cycle || createDefaultCycleRuntime()),
    active: true,
    state: "running",
    cycleStartedAt: zone.cycle?.cycleStartedAt || now,
    phaseStartedAt: now,
    totalElapsedMs: zone.cycle?.totalElapsedMs || 0,
    pumpOn: true,
    targetByGlobalHydrate,
    lastReason: "started",
  }

  zones[idx] = deriveZoneRuntime({
    ...zone,
    cycle: nextCycle,
    pumpStatus: "on",
  })

  enqueueCommand(zoneId, "water")
  return { started: true, reason: "ok" }
}

export function tickIrrigationCycle(zoneId: string) {
  const idx = zones.findIndex(z => z.id === zoneId)
  if (idx < 0) return

  const now = Date.now()
  const zone = deriveZoneRuntime(zones[idx])
  const cycle = zone.cycle || createDefaultCycleRuntime()

  if (!cycle.active) {
    zones[idx] = zone
    return
  }

  if (irrigationSettings.ripeningMode || zone.sensor?.hasError) {
    stopIrrigationCycle(zoneId, irrigationSettings.ripeningMode ? "ripening_mode" : "sensor_error")
    return
  }

  if (zone.soilMoisture >= irrigationSettings.wetThreshold) {
    stopIrrigationCycle(zoneId, "wet_threshold_reached")
    return
  }

  const cycleStart = cycle.cycleStartedAt || now
  const phaseStart = cycle.phaseStartedAt || now
  const totalElapsedMs = now - cycleStart

  if (totalElapsedMs >= irrigationSettings.maxDurationMs) {
    stopIrrigationCycle(zoneId, "max_duration_reached")
    return
  }

  const phaseElapsed = now - phaseStart

  if (cycle.pumpOn) {
    if (phaseElapsed >= irrigationSettings.cycleOnMs) {
      zones[idx] = deriveZoneRuntime({
        ...zone,
        cycle: {
          ...cycle,
          state: "cooldown",
          pumpOn: false,
          phaseStartedAt: now,
          totalElapsedMs,
          lastReason: "phase_off",
        },
        pumpStatus: "off",
      })
      enqueueCommand(zoneId, "stop")
      return
    }
  } else if (phaseElapsed >= irrigationSettings.cycleOffMs) {
    zones[idx] = deriveZoneRuntime({
      ...zone,
      cycle: {
        ...cycle,
        state: "running",
        pumpOn: true,
        phaseStartedAt: now,
        totalElapsedMs,
        lastReason: "phase_on",
      },
      pumpStatus: "on",
    })
    enqueueCommand(zoneId, "water")
    return
  }

  zones[idx] = deriveZoneRuntime({
    ...zone,
    cycle: {
      ...cycle,
      totalElapsedMs,
    },
  })
}

export function markSensorError(zoneId: string, message: string) {
  const idx = zones.findIndex(z => z.id === zoneId)
  if (idx < 0) return

  zones[idx] = deriveZoneRuntime({
    ...zones[idx],
    sensor: {
      ...(zones[idx].sensor || createDefaultSensorRuntime()),
      hasError: true,
      errorMessage: message,
    },
  })

  stopIrrigationCycle(zoneId, "sensor_error")
}

export function updateSensorRuntime(zoneId: string, moisture: number) {
  const idx = zones.findIndex(z => z.id === zoneId)
  if (idx < 0) return

  const zone = zones[idx]
  const now = Date.now()
  const sensor = zone.sensor || createDefaultSensorRuntime()
  const lastValue = sensor.lastValue

  let unchangedSince = sensor.unchangedSince
  if (lastValue === null || Math.abs(lastValue - moisture) > irrigationSettings.minChangePercent) {
    unchangedSince = now
  } else if (!unchangedSince) {
    unchangedSince = now
  }

  let hasError = false
  let errorMessage: string | null = null

  if (unchangedSince && now - unchangedSince >= irrigationSettings.unchangedSensorMs) {
    hasError = true
    errorMessage = "Sensor Error"
  }

  zones[idx] = deriveZoneRuntime({
    ...zone,
    sensor: {
      hasError,
      errorMessage,
      lastValidAt: now,
      lastValue: moisture,
      unchangedSince,
    },
  })

  if (hasError) {
    stopIrrigationCycle(zoneId, "sensor_error")
  }
}

function deriveZoneRuntime(zone: ZoneData): ZoneData {
  const climate = getFarmClimate()
  const spray = climate.fresh
    ? getSprayWindowStatus(climate.temperature, climate.humidity)
    : getSprayWindowStatus(null, null)
  const gridColor = getGridColorByMoisture(zone.soilMoisture, irrigationSettings)
  const hydrateEligible =
    !irrigationSettings.ripeningMode &&
    !zone.sensor?.hasError &&
    gridColor !== "green"

  return {
    ...zone,
    gridColor,
    dryThreshold: irrigationSettings.dryThreshold,
    wetThreshold: irrigationSettings.wetThreshold,
    hydrateEligible,
    cycle: zone.cycle || createDefaultCycleRuntime(),
    sensor: zone.sensor || createDefaultSensorRuntime(),
    temperature: climate.temperature ?? zone.temperature,
    humidity: climate.humidity ?? zone.humidity,
    vpd: spray.vpd ?? undefined,
    vpdBand: spray.band,
    sprayEnabled: spray.sprayEnabled,
    sprayMessage: spray.message,
    pumpStatus: zone.cycle?.pumpOn ? "on" : "off",
  }
}

zones = zones.map(z => deriveZoneRuntime(z))

export function getHydrationCandidates() {
  const hydrated = zones.map(zone => deriveZoneRuntime(zone))
  zones = hydrated
  globalMemory.zones = zones

  const targeted = hydrated.filter(
    zone =>
      isDemoControlZone(zone.id) &&
      zone.hydrateEligible &&
      (zone.gridColor === "red" || zone.gridColor === "yellow"),
  )
  const ignored = hydrated.filter(zone => zone.gridColor === "green").map(zone => zone.id)

  return {
    targeted,
    ignored,
    disabled: irrigationSettings.ripeningMode || targeted.length === 0,
    reason: irrigationSettings.ripeningMode ? "Ripening mode is active" : targeted.length === 0 ? "All grids are green" : null,
  }
}

export function updateLiveZones() {
  const liveIds = zones.slice(0, Math.min(4, zones.length)).map(zone => zone.id)

  for (const zone of zones) {
    if (!liveIds.includes(zone.id)) continue

    if (zone.status === "healthy") {
      zone.status = "warning"
      zone.soilMoisture = 35
      zone.healthScore = 65
    } else if (zone.status === "warning") {
      zone.status = "critical"
      zone.soilMoisture = 20
      zone.healthScore = 45
    } else {
      zone.status = "healthy"
      zone.soilMoisture = 70
      zone.healthScore = 90
    }
  }

  zones = zones.map(zone => deriveZoneRuntime(zone))
  globalMemory.zones = zones
}

export function updateFarmProfile(acres: number, zoneSizeAcres = 0.25) {
  farmProfile = buildFarmProfile(acres, zoneSizeAcres)
  globalMemory.farmProfile = farmProfile

  const nextZones = generateZones(farmProfile, irrigationSettings)
  const existingMap = new Map(zones.map(zone => [zone.id, zone]))

  zones = nextZones.map(zone => {
    const existing = existingMap.get(zone.id)
    return existing ? deriveZoneRuntime({ ...zone, ...existing, row: zone.row, col: zone.col }) : deriveZoneRuntime(zone)
  })

  globalMemory.zones = zones
  zoneHistory = generateZoneHistory(zones)
  globalMemory.zoneHistory = zoneHistory

  const validZoneIds = new Set(zones.map(zone => zone.id))
  for (const zoneId of Object.keys(pendingCommands)) {
    if (!validZoneIds.has(zoneId)) {
      delete pendingCommands[zoneId]
    }
  }

  return farmProfile
}

/**
 * Clears all disease-detection data (scans, linked chemical spray records,
 * disease-driven activity history) for demo/testing resets. Soil moisture,
 * irrigation state, water-only pump validation records, and the farm layout
 * are untouched — this only undoes what scanning produced.
 */
export function resetDetectionData() {
  const db = readDB()
  db.detections = []
  db.sprays = db.sprays.filter((spray: any) => spray.applicationMode === "water-validation")
  db.activityLog = db.activityLog.filter((entry: any) => entry.type === "water")
  writeDB(db)

  activityLog.length = 0
  activityLog.push(...db.activityLog)
  globalMemory.activityLog = activityLog

  zones = zones.map(zone => {
    const moistureStatus: ZoneStatus =
      zone.soilMoisture < 25 ? "critical" : zone.soilMoisture < 40 ? "warning" : "healthy"

    return deriveZoneRuntime({
      ...zone,
      status: moistureStatus,
      disease: undefined,
      canonicalDisease: undefined,
      mlConfidence: undefined,
      severityScore: undefined,
      severityLevel: undefined,
      lastAnalyzed: undefined,
      activeDetection: undefined,
      cropReview: undefined,
      mlModelId: undefined,
      mlModelVersion: undefined,
      treatmentHistory: [],
    })
  })
  globalMemory.zones = zones

  zoneHistory = zoneHistory.map(entry => ({
    ...entry,
    sprays: 0,
    diseaseHistory: [],
    confidenceHistory: [],
    severityHistory: [],
    timestampHistory: [],
    treatmentHistory: [],
  }))
  globalMemory.zoneHistory = zoneHistory

  return { resetAt: new Date().toISOString(), zoneCount: zones.length }
}
