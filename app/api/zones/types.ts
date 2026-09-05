export type ZoneStatus =
  | "healthy"
  | "warning"
  | "critical"
  | "uncertain"

export type GridColor = "red" | "yellow" | "green"
export type CycleState = "idle" | "running" | "cooldown" | "done" | "error"
export type VpdBand = "green" | "orange" | "red" | "unavailable"

export interface IrrigationCycleRuntime {
  active: boolean
  state: CycleState
  cycleStartedAt: number | null
  phaseStartedAt: number | null
  totalElapsedMs: number
  pumpOn: boolean
  targetByGlobalHydrate: boolean
  lastReason?: string
}

export interface SensorRuntime {
  hasError: boolean
  errorMessage: string | null
  lastValidAt: number | null
  lastValue: number | null
  unchangedSince: number | null
}

export interface ZoneData {
  id: string
  row: number
  col: number
  status: ZoneStatus
  lastSprayed: string
  lastIrrigated?: string
  soilMoisture: number
  /** Legacy compatibility mirrors of the one fixed DHT11 farm station. */
  temperature: number
  humidity: number
  plantCount: number
  healthScore: number
  gridColor?: GridColor
  dryThreshold?: number
  wetThreshold?: number
  hydrateEligible?: boolean
  sensor?: SensorRuntime
  cycle?: IrrigationCycleRuntime
  vpd?: number
  vpdBand?: VpdBand
  sprayEnabled?: boolean
  sprayMessage?: string
  pumpStatus?: "on" | "off"

  // 🔥 NEW ML FIELDS
  disease?: string
  canonicalDisease?: string
  mlConfidence?: number
  severityScore?: number
  severityLevel?: "low" | "moderate" | "high"
  lastAnalyzed?: string
  activeDetection?: boolean
  /** A scan whose selected crop and model crop family do not agree. */
  cropReview?: boolean
  mlModelId?: string | null
  mlModelVersion?: string | null

  treatmentHistory?: DetectionEvent[]
}

export type DetectionEvent = {
  id: string
  zoneId: string
  disease: string
  canonicalDisease?: string
  confidence: number
  severityLevel: "low" | "moderate" | "high"
  severityScore: number
  recommendedChemical: string
  organicAlternative: string
  dosage: string
  timestamp: string

  status: "active" | "treated" | "resolved"
  treatedAt: string | null
  postSeverityScore: number | null
  linkedSprayId: string | null
  /** Crop selected by the farmer for the photographed leaf. */
  scanCrop?: string
  /** Crop family parsed from the classifier label, when supplied by the model. */
  modelCrop?: string
  /** A mismatch stays visible for review but cannot create a spray recommendation. */
  cropMatch?: "matched" | "review" | "not_applicable"
  modelId?: string | null
  modelVersion?: string | null
  /** Stored filename of the uploaded leaf photo, when one could be saved. */
  photoName?: string | null
}

export interface ZoneHistoryEntry {
  zoneId: string
  moistureHistory: number[]
  temperatureHistory: number[]
  sprays: number

  // 🔥 NEW ML HISTORY
  diseaseHistory: string[]
  confidenceHistory: number[]
  severityHistory: number[]
  timestampHistory: string[]
  treatmentHistory: DetectionEvent[]
}
