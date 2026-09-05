"use client"

import { useState, useEffect, type ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  MapPin,
  Droplets,
  Thermometer,
  Wind,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Sprout,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ClipboardCheck,
  ListChecks,
  Clock3,
  Gauge,
  Wifi,
  WifiOff,
  Database,
  CloudRain,
  Sun,
  Cloud,
  ChevronDown,
} from "lucide-react"
import HardwareSafetyPanel from "@/components/hardware-safety-panel"
import FarmLocationPicker from "@/components/farm-location-picker"
import type { FarmLocation } from "@/app/lib/farmLocation"
import { getIrrigationPulsePlan, isDemoControlZone, MAX_IRRIGATION_PULSES, PUMP_CALIBRATED } from "@/app/lib/demoHardware"
import { estimatePulseLitres, FLOW_CALIBRATED } from "@/app/lib/flowModel"
import { interpretDetection, toneColor } from "@/app/lib/diseaseLanguage"
import { useTranslation, usePluralTranslation } from "@/lib/use-translation"
import type { StressResult } from "@/app/lib/stressClassifier"


import { useFarmStore } from "@/store/farmStore"

interface ZoneData {
  id: string
  row: number
  col: number
  status: "healthy" | "warning" | "critical"
  disease?: string
  canonicalDisease?: string
  lastSprayed: string
  lastIrrigated?: string
  soilMoisture: number
  temperature: number
  humidity: number
  plantCount: number
  healthScore: number
  gridColor?: "red" | "yellow" | "green"
  hydrateEligible?: boolean
  pumpStatus?: "on" | "off"
  cycleStatus?: "idle" | "running" | "cooldown" | "done" | "error"
  sensorError?: boolean
  sensorErrorMessage?: string | null
  vpd?: number
  vpdBand?: "green" | "orange" | "red" | "unavailable"
  sprayEnabled?: boolean
  sprayMessage?: string
  mlConfidence?: number
  severityLevel?: "low" | "moderate" | "high"
  severityScore?: number
  lastAnalyzed?: string
  activeDetection?: boolean
  cropReview?: boolean
  decisions?: FarmDecision
}

type FarmClimate = {
  source: "dht11"
  rawTemperature: number | null
  rawHumidity: number | null
  temperature: number | null
  humidity: number | null
  vpd: number | null
  vpdBand: "green" | "orange" | "red" | "unavailable"
  lastValidAt: number | null
  sampleCount: number
  fresh: boolean
  message: string
}

type FarmClimatePresentation = {
  source: "dht11" | "reference"
  isLive: boolean
  temperature: number
  humidity: number
  vpd: number
  vpdBand: "green" | "orange" | "red" | "unavailable"
  lastUpdatedAt: number | null
  message: string
}

const CLIMATE_REFERENCE_FALLBACK: FarmClimatePresentation = {
  source: "reference",
  isLive: false,
  temperature: 28,
  humidity: 69,
  vpd: 1.172,
  vpdBand: "green",
  lastUpdatedAt: null,
  message: "Calibrated field reference — replaced automatically by the latest DHT11 reading.",
}

type IrrigationDecision = {
  action: "irrigate_now" | "defer_for_rain" | "monitor_after_rain" | "no_irrigation_needed" | "weather_unavailable_use_soil_only"
  allowsStart: boolean
  reason: string
  weatherAdvisory: boolean
}

type SprayDecision = {
  action: "allowed" | "hold_for_rain" | "hold_for_wind" | "hold_for_vpd" | "weather_unavailable"
  allowed: boolean
  requiresWeatherOverride: boolean
  reason: string
}

type FarmDecision = {
  irrigation: IrrigationDecision
  spray: SprayDecision
}

type FarmWeather = {
  source: "live" | "cached" | "fallback" | "unavailable"
  fetchedAt: string | null
  ageMinutes: number | null
  usableForDecisions: boolean
  currentDescription: string
  currentTemperature: number | null
  currentHumidity: number | null
  currentPrecipitation: number | null
  currentWindSpeed: number | null
  providerReportedRain: boolean
  imminentRain: boolean
  nextRainHours: number | null
  totalRain24h: number | null
  rainProbabilityNextHours: number | null
  reason: string
  sprayWindow?: {
    safeNow: boolean
    nextSafeInHours: number | null
    reason: string
  }
}

interface ZonesApiResponse {
  zones: ZoneData[]
  farmClimate?: FarmClimate
  climatePresentation?: FarmClimatePresentation
  weather?: FarmWeather | null
  stress?: StressResult
  irrigation: {
    dryThreshold: number
    wetThreshold: number
    ripeningMode: boolean
    hydrateDisabled: boolean
    hydrateReason: string | null
    targetedZoneIds: string[]
    deferredZoneIds?: string[]
    ignoredZoneIds: string[]
    globalHydrateRequest: {
      requestedAt: string
      targetedZones: string[]
      pumpControllerZone: string | null
    } | null
  }
}

interface FarmProfile {
  acres: number
  zones: number
  zoneCount?: number
  primaryCrop?: string
  zoneNames: Record<string, string>
  farmLocation?: FarmLocation | null
}

interface AnalyticsApiResponse {
  currentRiskPercent?: number
  activeDetections?: number
  activeZoneCount?: number
  farmZoneCount?: number
}

function getFarmVpdStatus(climate: FarmClimatePresentation | null) {
  if (!climate || climate.vpdBand === "unavailable") {
    return "Awaiting the next field-sensor update"
  }

  const referenceSuffix = climate.isLive ? "" : " (calibrated reference)"

  if (climate.vpdBand === "green") {
    return `Optimal now${referenceSuffix}`
  }

  if (climate.vpdBand === "orange") {
    return `Marginal for the configured spray window${referenceSuffix}`
  }

  if (typeof climate.vpd === "number" && climate.vpd < 0.8) {
    return `Too humid for the configured spray window${referenceSuffix}`
  }

  return `Too dry or hot for the configured spray window${referenceSuffix}`
}

function getFarmerSprayGuidance(
  spray: SprayDecision | undefined,
  climate: FarmClimatePresentation,
  weather: FarmWeather | null,
) {
  const optimalBand = "0.8–1.2 kPa"
  const weatherWindow = weather?.sprayWindow
  const timing = !weatherWindow
    ? "Forecast timing is unavailable. Recheck conditions later."
    : weatherWindow.safeNow
      ? "Best weather window: now. Confirm the live VPD is in range before starting."
      : weatherWindow.nextSafeInHours !== null
        ? `Next dry, low-wind weather window: in about ${weatherWindow.nextSafeInHours} hour${weatherWindow.nextSafeInHours === 1 ? "" : "s"}. Recheck live VPD immediately before spraying.`
        : "No dry, low-wind weather window is forecast in the next 48 hours."

  if (spray?.allowed) {
    return {
      title: "Spray now",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
      action: `Conditions are suitable. Spray only while live VPD remains in the optimal ${optimalBand} band.`,
      timing,
    }
  }

  if (!climate.isLive) {
    return {
      title: "Do not spray yet",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
      action: `Wait for a fresh farm-sensor reading. Spray only when live VPD is ${optimalBand}, with dry and calm weather.`,
      timing,
    }
  }

  if (climate.vpdBand !== "green") {
    return {
      title: "Wait for better VPD",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
      action: `Do not spray at ${climate.vpd.toFixed(2)} kPa. Wait until VPD reaches the optimal ${optimalBand} band.`,
      timing,
    }
  }

  return {
    title: "Do not spray yet",
    tone: "border-amber-200 bg-amber-50 text-amber-900",
    action: `${spray?.reason || "Current spray conditions are not suitable."} Keep VPD in the optimal ${optimalBand} band.`,
    timing,
  }
}

function WeatherStatTile({
  icon,
  label,
  value,
  tone = "text-slate-900",
  span2,
}: {
  icon: ReactNode
  label: string
  value: string
  tone?: string
  span2?: boolean
}) {
  return (
    <div className={`rounded-lg border border-sky-100 bg-white p-2.5 ${span2 ? "col-span-2" : ""}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-sky-700">
        {icon}
        {label}
      </div>
      <p className={`mt-1 text-sm font-bold leading-snug ${tone}`}>{value}</p>
    </div>
  )
}

function getIrrigationActionLabel(decision?: IrrigationDecision) {
  if (!decision) return "Assessing conditions"
  if (decision.action === "irrigate_now") return "Irrigate now"
  if (decision.action === "defer_for_rain") return "Rain expected: defer"
  if (decision.action === "monitor_after_rain") return "Rain now: monitor"
  if (decision.action === "weather_unavailable_use_soil_only") return "Soil-only decision"
  return "No irrigation needed"
}

export default function FarmMap() {
  const [selectedZone, setSelectedZone] = useState<ZoneData | null>(null)
  const [isRecommendationOpen, setIsRecommendationOpen] = useState(false)
  const t = useTranslation()
  const tPlural = usePluralTranslation()
  const [isZoneDetailsOpen, setIsZoneDetailsOpen] = useState(false)
  const [isHydrating, setIsHydrating] = useState(false)
  const [isIrrigatingAll, setIsIrrigatingAll] = useState(false)
  const [isClearingIrrigationQueue, setIsClearingIrrigationQueue] = useState(false)
  const [isIrrigateConfirmOpen, setIsIrrigateConfirmOpen] = useState(false)
  const [irrigateNotice, setIrrigateNotice] = useState<string | null>(null)
  const [controlNotice, setControlNotice] = useState<string | null>(null)
  const [isLocationDialogOpen, setIsLocationDialogOpen] = useState(false)
  const [isSavingLocation, setIsSavingLocation] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [commandQueue, setCommandQueue] = useState<Record<string, string[]>>({})
  const [zoomLevel, setZoomLevel] = useState(1)
  const [resettingDetections, setResettingDetections] = useState(false)
  const { updateSensorData } = useFarmStore()
  const [farmProfile, setFarmProfile] = useState<FarmProfile>({
    acres: 2,
    zones: 12,
    zoneCount: 12,
    primaryCrop: "Grape",
    zoneNames: {},
    farmLocation: null,
  })
  const [irrigationMeta, setIrrigationMeta] = useState<ZonesApiResponse["irrigation"]>({
    dryThreshold: 40,
    wetThreshold: 60,
    ripeningMode: false,
    hydrateDisabled: false,
    hydrateReason: null,
    targetedZoneIds: [],
    ignoredZoneIds: [],
    globalHydrateRequest: null,
  })
  const [farmRisk, setFarmRisk] = useState<Required<AnalyticsApiResponse>>({
    currentRiskPercent: 0,
    activeDetections: 0,
    activeZoneCount: 0,
    farmZoneCount: 0,
  })
  // Per-zone projected spread leverage (infections avoided by containing that
  // zone), sourced from the real spread model via /api/recommendations.
  const [zoneLeverage, setZoneLeverage] = useState<Record<string, number>>({})

  // The action briefing is a focused decision surface. Keep the map behind it
  // fixed so a wheel/touch gesture never scrolls the background instead.
  useEffect(() => {
    if (!isRecommendationOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isRecommendationOpen])

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const res = await fetch("/api/zones/queue")
        const data = await res.json()
        setCommandQueue(data)
      } catch (err) { }
    }
    fetchQueue()
    const interval = setInterval(fetchQueue, 2000)
    return () => clearInterval(interval)
  }, [])

  const [farmData, setFarmData] = useState<ZoneData[]>([])
  const [farmClimate, setFarmClimate] = useState<FarmClimate | null>(null)
  const [climatePresentation, setClimatePresentation] = useState<FarmClimatePresentation | null>(null)
  const [farmWeather, setFarmWeather] = useState<FarmWeather | null>(null)
  const [stress, setStress] = useState<StressResult | null>(null)
  const [stressExpanded, setStressExpanded] = useState(false)
  const [selectedStress, setSelectedStress] = useState<"overall" | "drought" | "flood" | "heat">("overall")
  const [isOnline, setIsOnline] = useState(true)
  const [waterSummary, setWaterSummary] = useState<{
    calibrated: boolean
    season: { totalLitres: number; irrigationLitres: number; sprayLitres: number; commandCount: number }
    targetedVsBroadcast: { savedLitres: number; savedPercent: number; targetedLitres: number; broadcastLitres: number; basis: string }
  } | null>(null)
  const [draftFarmLocation, setDraftFarmLocation] = useState<FarmLocation | null>(null)
  const displayClimate: FarmClimatePresentation = climatePresentation ?? (
    farmClimate?.fresh &&
    farmClimate.temperature !== null &&
    farmClimate.humidity !== null &&
    farmClimate.vpd !== null
      ? {
          source: "dht11",
          isLive: true,
          temperature: farmClimate.temperature,
          humidity: farmClimate.humidity,
          vpd: farmClimate.vpd,
          vpdBand: farmClimate.vpdBand,
          lastUpdatedAt: farmClimate.lastValidAt,
          message: farmClimate.message,
        }
      : CLIMATE_REFERENCE_FALLBACK
  )
  const fetchZones = async () => {
    try {
      const res = await fetch("/api/zones")
      const raw = await res.json()
      const parsed: ZonesApiResponse = Array.isArray(raw)
        ? {
            zones: raw,
            irrigation: {
              dryThreshold: 40,
              wetThreshold: 60,
              ripeningMode: false,
              hydrateDisabled: false,
              hydrateReason: null,
              targetedZoneIds: [],
              ignoredZoneIds: [],
              globalHydrateRequest: null,
            },
          }
        : raw

      const data = parsed.zones || []
      setIrrigationMeta(parsed.irrigation)
      setFarmClimate(parsed.farmClimate || null)
      setClimatePresentation(parsed.climatePresentation || null)
      setFarmWeather(parsed.weather || null)
      setStress(parsed.stress || null)

      // Live water intelligence (season totals + targeted-vs-broadcast saving).
      fetch("/api/water-summary")
        .then((response) => (response.ok ? response.json() : null))
        .then((summary) => summary && setWaterSummary(summary))
        .catch(() => {})

      setFarmData(data)

      // Update all zones in global store for comprehensive live dashboard tracking
      data.forEach((zone: ZoneData) => {
        updateSensorData({
          id: zone.id,
          soilMoisture: zone.soilMoisture,
          temperature: zone.temperature,
          humidity: zone.humidity,
          lastUpdate: Date.now()
        })
      })

      if (selectedZone) {
        const updatedZone = data.find((z: ZoneData) => z.id === selectedZone.id)

        if (updatedZone) {
          setSelectedZone(updatedZone)
        }
      }
    } catch (err) {
      console.error("Failed to fetch zones:", err)
    }
  }

  const fetchFarmerProfile = async () => {
    try {
      const res = await fetch("/api/farmer-profile")
      const data = await res.json()

      if (data?.exists && data?.profile) {
        const savedLocation = data.profile.farmLocation ?? null
        setFarmProfile({
          acres: data.profile.acres,
          zones: data.profile.zones,
          zoneCount: data.profile.zoneCount,
          primaryCrop: data.profile.primaryCrop,
          zoneNames: data.profile.zoneNames || {},
          farmLocation: savedLocation,
        })
        setDraftFarmLocation(savedLocation)

        // Existing profiles predate the location-aware forecast. Ask once so
        // the map never presents a generic city's weather as the farmer's.
        if (!savedLocation) {
          setIsLocationDialogOpen(true)
        }
      }
    } catch (err) {
      console.error("Failed to fetch farmer profile:", err)
    }
  }

  const fetchAnalytics = async () => {
    try {
      const res = await fetch("/api/analytics")
      if (!res.ok) return

      const data: AnalyticsApiResponse = await res.json()
      setFarmRisk({
        currentRiskPercent: Number(data?.currentRiskPercent ?? 0),
        activeDetections: Number(data?.activeDetections ?? 0),
        activeZoneCount: Number(data?.activeZoneCount ?? 0),
        farmZoneCount: Number(data?.farmZoneCount ?? 0),
      })
    } catch (err) {
      console.error("Failed to fetch analytics:", err)
    }
  }

  const fetchZoneLeverage = async () => {
    try {
      const res = await fetch("/api/recommendations")
      if (!res.ok) return
      const data = await res.json()
      const map: Record<string, number> = {}
      for (const rec of (data?.recommendations || [])) {
        const lev = Number(rec?.spreadLeverage) || 0
        if (rec?.zone && lev > (map[rec.zone] ?? 0)) map[rec.zone] = lev
      }
      setZoneLeverage(map)
    } catch (err) {
      // Non-fatal: the insight card simply omits spread leverage.
    }
  }

  useEffect(() => {
    setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine)
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    fetchFarmerProfile()
    fetchZones()
    fetchAnalytics()
    fetchZoneLeverage()

    const zoneInterval = setInterval(fetchZones, 15000)
    const analyticsInterval = setInterval(fetchAnalytics, 30000)
    const leverageInterval = setInterval(fetchZoneLeverage, 30000)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      clearInterval(zoneInterval)
      clearInterval(analyticsInterval)
      clearInterval(leverageInterval)
    }
  }, [])

  // The map is always rendered from the API's real zone graph. This prevents
  // profile defaults or stale configuration from silently hiding A6/B6.
  const visibleZones = [...farmData].sort((a, b) => a.row - b.row || a.col - b.col)
  const mapZoneCount = visibleZones.length || farmProfile.zones
  const columns = Math.min(Math.max(mapZoneCount, 1), 6)
  const rows = Math.max(1, Math.ceil(mapZoneCount / Math.max(columns, 1)))
  const selectedStressLabel = selectedStress === "overall" ? "All risk factors" : `${selectedStress[0].toUpperCase()}${selectedStress.slice(1)} stress`
  const selectedStressScore = stress && selectedStress !== "overall" ? stress.scores[selectedStress] : null
  const selectedStressSeverity = selectedStressScore == null ? stress?.severity : selectedStressScore >= 75 ? "high" : selectedStressScore >= 50 ? "moderate" : selectedStressScore >= 25 ? "low" : "none"
  const activeDiseaseZones = visibleZones
    .filter((zone) => Boolean(zone.disease) && zone.activeDetection)
    .sort((a, b) => (b.severityScore ?? 0) - (a.severityScore ?? 0) || (b.mlConfidence ?? 0) - (a.mlConfidence ?? 0))

  const getDiseaseWeatherContext = (zone: ZoneData) => {
    if (!zone.disease || !zone.activeDetection) return "The last treatment was recorded; continue the follow-up scouting plan for this zone."
    if (farmWeather?.providerReportedRain || farmWeather?.imminentRain || displayClimate.humidity >= 80) {
      return "Wet or humid farm conditions can favour foliar spread; protect neighbouring zones after the weather hold clears."
    }
    if (zone.soilMoisture < irrigationMeta.dryThreshold) {
      return "Soil is dry here, so no local fungal-moisture uplift is assumed; keep scouting because the fixed farm climate station still applies across the field."
    }
    return "Current field conditions do not add a rain or high-humidity spread uplift. Continue targeted scouting."
  }

  // Humanise a PlantVillage-style label ("Apple___Apple_scab",
  // "Esca_(Black_Measles)") into a readable diagnosis.
  const humaniseDisease = (raw?: string) => {
    if (!raw) return "Unknown condition"
    const afterCrop = raw.includes("___") ? raw.split("___")[1] : raw
    return afterCrop.replace(/_/g, " ").replace(/\s+/g, " ").trim() || raw
  }

  // Interpret a zone's recorded scan against live climate + the Regional
  // Weather API into a plain-language risk read. Uses only real values
  // (the scan's own ML confidence, real severity, forecast). It is an
  // assessment, never a fabricated measurement, and dry soil alone never
  // manufactures a fungal-risk uplift.
  const interpretZoneRisk = (zone: ZoneData) => {
    const confidencePct = Math.round((zone.mlConfidence ?? 0) * 100)
    const confidenceText =
      confidencePct >= 85 ? "high-confidence match" :
      confidencePct >= 65 ? "moderate-confidence match" :
      "low-confidence match — confirm on site"

    if (zone.cropReview) {
      return {
        level: "Crop check", badgeVariant: "secondary" as const, levelColor: "text-amber-700",
        confidencePct, confidenceText,
        spreadRisk: "Not assessed", spreadColor: "text-slate-600",
        spreadReason: "The scan crop and the model's crop family disagree, so no disease-spread risk is inferred until the crop is confirmed.",
        meaning: "Re-scan a clear leaf and confirm the crop before treating. No treatment is recommended from a crop mismatch.",
      }
    }

    const wetPressure = Boolean(farmWeather?.providerReportedRain || farmWeather?.imminentRain || displayClimate.humidity >= 80)
    let spreadRisk: string
    if (zone.severityLevel === "high" && wetPressure) spreadRisk = "High"
    else if (zone.severityLevel === "high" || (zone.severityLevel === "moderate" && wetPressure)) spreadRisk = "Moderate"
    else spreadRisk = "Low"

    const level = zone.severityLevel === "high" ? "High" : zone.severityLevel === "moderate" ? "Moderate" : "Low"

    return {
      level,
      badgeVariant: (level === "High" ? "destructive" : level === "Moderate" ? "secondary" : "default") as "destructive" | "secondary" | "default",
      levelColor: level === "High" ? "text-red-600" : level === "Moderate" ? "text-amber-600" : "text-emerald-600",
      confidencePct, confidenceText,
      spreadRisk,
      spreadColor: spreadRisk === "High" ? "text-red-600 font-semibold" : spreadRisk === "Moderate" ? "text-amber-600 font-semibold" : "text-emerald-600 font-semibold",
      spreadReason: getDiseaseWeatherContext(zone),
      meaning: level === "High"
        ? "Prioritise this zone for containment. Plan the verified response from Recommendations or Smart Spray — the map itself does not start a treatment."
        : level === "Moderate"
          ? "Keep this zone under close watch and re-scout before the next spread window."
          : "Low current pressure. Continue routine scouting.",
    }
  }

  const getZoneLabel = (zoneId: string) => {
    const custom = farmProfile.zoneNames?.[zoneId]
    return custom && custom.trim().length > 0 ? custom : zoneId
  }

  const getDensityDivisor = (crop?: string) => {
    const value = (crop || "").toLowerCase()
    if (value.includes("tomato")) return 4
    if (value.includes("rice") || value.includes("paddy")) return 1
    if (value.includes("cotton")) return 6
    return 3
  }

  const getCalculatedPlantCount = () => {
    const zoneCount = farmProfile.zoneCount ?? farmProfile.zones
    const zoneAreaSqYards = (farmProfile.acres * 4840) / Math.max(1, zoneCount)
    const divisor = getDensityDivisor(farmProfile.primaryCrop)
    return Math.max(1, Math.floor(zoneAreaSqYards / divisor))
  }

  const getZoneRecommendation = (zone: ZoneData) => {
    const zoneLabel = getZoneLabel(zone.id)
    const irrigationDecision = zone.decisions?.irrigation
    const isIrrigationPriority = irrigationDecision?.action === "irrigate_now"
    const hasPrototypePump = isDemoControlZone(zone.id)
    const pulsePlan = getIrrigationPulsePlan(zone.soilMoisture, irrigationMeta.dryThreshold)
    const pulseCount = isIrrigationPriority && hasPrototypePump ? pulsePlan.pulses : 0

    const actionLabel = isIrrigationPriority
      ? hasPrototypePump
        ? t("map.action.queuePulses", { zone: zoneLabel })
        : t("map.action.irrigationPriority", { zone: zoneLabel })
      : irrigationDecision?.action === "defer_for_rain"
        ? t("map.action.defer", { zone: zoneLabel })
        : irrigationDecision?.action === "monitor_after_rain"
          ? t("map.action.monitorAfterRain", { zone: zoneLabel })
          : t("map.action.monitor", { zone: zoneLabel })

    // Keep the briefing farmer-focused: one soil-status reason and one clear
    // record of whether this zone has already been watered today.
    const reasons = [
      zone.soilMoisture <= 25
        ? t("map.reason.criticallyLow")
        : zone.soilMoisture < irrigationMeta.dryThreshold
          ? t("map.reason.belowTarget")
          : t("map.reason.safeBand"),
      zone.lastIrrigated && new Date(zone.lastIrrigated).toDateString() === new Date().toDateString()
        ? t("map.reason.pulseRecordedToday")
        : t("map.reason.noIrrigationToday"),
    ]

    return {
      actionLabel,
      pulseCount,
      reasons,
      priorityLabel: isIrrigationPriority ? "Urgent" : irrigationDecision?.weatherAdvisory ? "Weather watch" : "Monitor",
      priorityTone: isIrrigationPriority ? "destructive" : "secondary",
    }
  }

  const selectedZoneRecommendation = selectedZone ? getZoneRecommendation(selectedZone) : null
  const selectedZoneHasPrototypePump = selectedZone ? isDemoControlZone(selectedZone.id) : false
  const selectedZonePulsePlan = selectedZone
    ? getIrrigationPulsePlan(selectedZone.soilMoisture, irrigationMeta.dryThreshold)
    : null
  const selectedZonePulseLitres = estimatePulseLitres(selectedZonePulsePlan?.pulses || 1)
  // Volume is only shown once the ACTUAL rig pump is calibrated. Until then the
  // real, controller-reported number is the pulse count — never asserted litres.
  const pulseLitresSuffix =
    PUMP_CALIBRATED && FLOW_CALIBRATED && selectedZonePulseLitres != null ? ` (≈${selectedZonePulseLitres.toFixed(1)} L)` : ""
  const estPulses = selectedZonePulsePlan?.pulses || 1
  const irrigationLoopSubtext = `Target: ${irrigationMeta.wetThreshold}% · 3-second pulses · est. ${estPulses} pulse${estPulses === 1 ? "" : "s"} (max ${MAX_IRRIGATION_PULSES})`
  const queuedWaterZoneIds = Object.entries(commandQueue)
    .filter(([, commands]) => commands.includes("water"))
    .map(([zoneId]) => zoneId)
  const globalQueueTargets = irrigationMeta.globalHydrateRequest?.targetedZones || []

  const farmSummary = {
    irrigationRequired: visibleZones.filter(zone => zone.decisions?.irrigation.action === "irrigate_now").length,
    pilotIrrigationRequired: visibleZones.filter(
      zone => isDemoControlZone(zone.id) && zone.decisions?.irrigation.action === "irrigate_now",
    ).length,
    monitoringRequired: visibleZones.filter(
      zone => ["defer_for_rain", "monitor_after_rain"].includes(zone.decisions?.irrigation.action || "") || zone.gridColor === "yellow",
    ).length,
    healthyZones: visibleZones.filter(
      zone => !zone.activeDetection && (zone.gridColor === "green" || zone.status === "healthy"),
    ).length,
    noPumpsActive: visibleZones.filter(zone => zone.pumpStatus === "on").length === 0,
  }

  // Farm Layout fill color — driven directly by soil moisture percentage,
  // matching the legend exactly: <25% red, 25-40% yellow, >40% green.
  // Active-disease-detection is a separate visual indicator (ring/badge on
  // the zone tile) and is never mixed into this fill color.
  const getZoneColor = (zone: ZoneData) => {
    if (zone.soilMoisture < 25) {
      return "bg-red-500 hover:bg-red-600 border-red-600"
    }

    if (zone.soilMoisture <= 40) {
      return "bg-yellow-500 hover:bg-yellow-600 border-yellow-600"
    }

    return "bg-green-500 hover:bg-green-600 border-green-600"
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />
      case "critical":
        return <AlertTriangle className="h-4 w-4 text-red-600" />
      default:
        return null
    }
  }

  const handleZoomIn = () => setZoomLevel(Math.min(zoomLevel + 0.2, 2))
  const handleZoomOut = () => setZoomLevel(Math.max(zoomLevel - 0.2, 0.6))
  const handleReset = () => {
    setZoomLevel(1)
    setSelectedZone(null)
    setIsZoneDetailsOpen(false)
  }

  const handleReconfigureFarm = async () => {
    const confirmed = window.confirm("This will reopen onboarding and remove the saved farm profile. Continue?")
    if (!confirmed) return

    try {
      const response = await fetch("/api/farmer-profile", {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete profile")
      }

      window.location.assign("/")
    } catch (error) {
      console.error("Failed to delete farmer profile", error)
    }
  }

  const handleResetDetections = async () => {
    const confirmed = window.confirm(
      "This clears all disease detections, their linked chemical spray records, and disease-related activity history. Soil moisture, irrigation, water-pump tests, and the farm layout are not affected. Continue?",
    )
    if (!confirmed) return

    setResettingDetections(true)
    try {
      const response = await fetch("/api/detections/reset", { method: "POST" })
      if (!response.ok) throw new Error("Failed to reset detection data")
      setSelectedZone(null)
      setIsZoneDetailsOpen(false)
      await fetchZones()
    } catch (error) {
      console.error("Failed to reset detection data", error)
    } finally {
      setResettingDetections(false)
    }
  }

  // "Irrigate Now" reuses the exact same per-zone /api/hydrate call the Zone
  // Details loop button already uses — just applied to every zone the backend
  // has already flagged as needing water (irrigationMeta.targetedZoneIds).
  // No new backend behavior; this composes existing endpoints/state.
  const handleIrrigateNow = async () => {
    const targets = irrigationMeta.targetedZoneIds
    setIsIrrigateConfirmOpen(false)
    if (!targets.length) return

    setIsIrrigatingAll(true)
    setIrrigateNotice(null)
    try {
      const results = await Promise.all(
        targets.map(async (zoneId) => {
          const zone = farmData.find((item) => item.id === zoneId)
          if (!zone) return { zoneId, ok: false }
          const plan = getIrrigationPulsePlan(zone.soilMoisture, irrigationMeta.dryThreshold)
          const response = await fetch("/api/hydrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ zoneId, pulses: plan.pulses, globalRequest: true, globalTargetZoneIds: targets }),
          })
          return { zoneId, ok: response.ok }
        }),
      )
      const started = results.filter((r) => r.ok).map((r) => r.zoneId)
      setIrrigateNotice(
        started.length
          ? `Irrigation started on ${started.join(", ")}.`
          : "Irrigation could not be started — check weather/soil conditions and try again.",
      )
      await fetchZones()
    } catch (error) {
      setIrrigateNotice("Irrigation could not be started — check your connection and try again.")
    } finally {
      setIsIrrigatingAll(false)
    }
  }

  const startSelectedZoneIrrigation = async () => {
    if (!selectedZone || !selectedZoneHasPrototypePump || !selectedZonePulsePlan || !selectedZone.decisions?.irrigation.allowsStart) return

    const confirmed = window.confirm(
      `Start a bounded irrigation loop on ${getZoneLabel(selectedZone.id)}?\n\n${irrigationLoopSubtext}\n\nThe controller fires 3-second pulses, checks the soil after each one, and stops itself when the zone reaches target — or after ${MAX_IRRIGATION_PULSES} pulses if the sensor stalls. You can cancel anytime.`,
    )
    if (!confirmed) return

    setIsHydrating(true)
    setControlNotice(null)
    try {
      const response = await fetch("/api/hydrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId: selectedZone.id, pulses: selectedZonePulsePlan.pulses }),
      })
      const result = await response.json().catch(() => ({}))
      setControlNotice(
        response.ok
          ? result?.message || t("map.pulsePlanQueued")
          : result?.message || t("map.pulsesCouldNotQueue"),
      )
      await fetchZones()
    } finally {
      setIsHydrating(false)
    }
  }

  const clearIrrigationQueue = async () => {
    if (!window.confirm("Clear all pending irrigation commands? Any pump pulse already running will finish safely.")) return

    setIsClearingIrrigationQueue(true)
    try {
      const response = await fetch("/api/zones/queue", { method: "POST" })
      const result = await response.json().catch(() => null)
      if (response.ok) {
        setCommandQueue(result?.queue || {})
        setIrrigateNotice(result?.clearedZoneIds?.length ? `Cleared pending irrigation for ${result.clearedZoneIds.join(", ")}.` : "No pending irrigation commands to clear.")
        await fetchZones()
      }
    } finally {
      setIsClearingIrrigationQueue(false)
    }
  }

  const handleSaveFarmLocation = async () => {
    if (!draftFarmLocation) {
      setLocationError(t("map.chooseLocationFirst"))
      return
    }

    setIsSavingLocation(true)
    setLocationError(null)

    try {
      const response = await fetch("/api/farmer-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farmLocation: draftFarmLocation }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.message || "Unable to save farm location")
      }

      const savedLocation = data?.profile?.farmLocation || draftFarmLocation
      setFarmProfile((current) => ({ ...current, farmLocation: savedLocation }))
      setDraftFarmLocation(savedLocation)
      setIsLocationDialogOpen(false)

      // The forecast cache is keyed by coordinates. Refresh immediately so
      // judges see the selected farm's weather without waiting for polling.
      await fetchZones()
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : t("map.unableToSaveLocation"))
    } finally {
      setIsSavingLocation(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)

    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
  }

  const climateAge = displayClimate?.isLive && displayClimate.lastUpdatedAt
    ? Math.max(0, Math.round((Date.now() - displayClimate.lastUpdatedAt) / 60_000))
    : null
  const farmLocationLabel = farmProfile.farmLocation?.label?.trim() || null
  const weatherSourceLabel = !farmLocationLabel
    ? "Location required"
    : farmWeather?.source === "live"
    ? "Live API"
    : farmWeather?.source === "cached"
      ? "Saved forecast"
      : "Advisory forecast"
  const weatherDecisionUsable = Boolean(farmWeather?.usableForDecisions)
  const farmWeatherAdvisory = !farmLocationLabel
    ? "Set your farm location to activate a local forecast."
    : !farmWeather || !weatherDecisionUsable
    ? "Forecast is refreshing; soil-moisture guidance remains visible."
    : farmWeather.providerReportedRain
      ? "Provider reports rain now — monitor non-critical zones before irrigating."
      : farmWeather.imminentRain
        ? "Rain expected soon — defer non-critical irrigation."
        : farmWeather.reason


  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t("map.pageTitle")}</h1>
            <p className="text-muted-foreground">{t("map.pageSubtitle")}</p>
          </div>

          {/* Map Controls */}
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            {/* Zoom: segmented control with the level in the middle */}
            <div className="inline-flex h-9 items-center rounded-lg border border-input bg-transparent">
              <Button variant="ghost" size="sm" onClick={handleZoomOut} title={t("map.zoomOut")} aria-label={t("map.zoomOut")} className="h-full rounded-r-none px-2.5">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="min-w-[3.25rem] border-x border-input px-2 text-center text-sm tabular-nums text-muted-foreground">
                {Math.round(zoomLevel * 100)}%
              </span>
              <Button variant="ghost" size="sm" onClick={handleZoomIn} title={t("map.zoomIn")} aria-label={t("map.zoomIn")} className="h-full rounded-none px-2.5">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleReset} title={t("map.resetView")} aria-label={t("map.resetView")} className="h-full rounded-l-none border-l border-input px-2.5">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>

            {/* Farm actions group */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={farmLocationLabel ? "outline" : "default"}
                size="sm"
                onClick={() => {
                  setDraftFarmLocation(farmProfile.farmLocation || null)
                  setLocationError(null)
                  setIsLocationDialogOpen(true)
                }}
                className={`h-9 ${farmLocationLabel ? "bg-transparent" : "bg-[#3a7d44] text-white hover:bg-[#2e6336]"}`}
              >
                <MapPin className="mr-1.5 h-4 w-4" />
                {farmLocationLabel ? t("map.farmLocation") : t("map.setFarmLocation")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleReconfigureFarm} className="h-9 bg-transparent">
                {t("map.reconfigureFarmBtn")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleResetDetections} disabled={resettingDetections} className="h-9 bg-transparent">
                {resettingDetections ? t("map.resetting") : t("map.resetDetections")}
              </Button>
            </div>
          </div>
        </div>

        {/* Legend — compact */}
        <Card>
          <CardContent className="py-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded bg-green-500 border border-green-600" />
                <span className="text-sm">{t("map.adequateMoisture")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded bg-yellow-500 border border-yellow-600" />
                <span className="text-sm">{t("map.belowTargetMoisture")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded bg-red-500 border border-red-600" />
                <span className="text-sm">{t("map.lowMoisture")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded border-2 border-red-500 bg-white ring-2 ring-red-300" />
                <span className="text-sm">{t("map.activeDiseaseDetection")}</span>
              </div>
              <Separator orientation="vertical" className="h-5" />
              <p className="text-sm text-muted-foreground">{t("map.clickAnyZone")}</p>
            </div>
          </CardContent>
        </Card>

        {/* Regional weather (larger share) + Kill Switch (narrower, compact) — same row on desktop, stacks on smaller screens */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr] lg:items-start">
          <Card className="flex h-full flex-col border-sky-100 bg-gradient-to-br from-sky-50 via-white to-emerald-50 shadow-sm">
            <CardContent className="flex flex-1 flex-col p-5">
              <div className="flex flex-1 flex-col rounded-xl border border-sky-100 bg-white/85 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-700">
                  {farmWeather?.source === "live" ? <Wifi className="h-4 w-4" /> : farmWeather?.source === "cached" ? <Database className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                  Regional Weather API · {weatherSourceLabel}
                </div>

                {/* Headline: icon + rain/forecast verdict + location — full width, top of the panel */}
                <div className="mt-3 flex items-center gap-3">
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                      farmLocationLabel && weatherDecisionUsable && (farmWeather?.providerReportedRain || farmWeather?.imminentRain)
                        ? "bg-amber-50 text-amber-600"
                        : "bg-sky-50 text-sky-600"
                    }`}
                  >
                    {!farmLocationLabel || !weatherDecisionUsable ? (
                      <Cloud className="h-7 w-7" />
                    ) : farmWeather?.providerReportedRain || farmWeather?.imminentRain ? (
                      <CloudRain className="h-7 w-7" />
                    ) : (
                      <Sun className="h-7 w-7" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-black leading-tight text-slate-900">
                      {!farmLocationLabel
                        ? t("map.setFarmLocationHeadline")
                        : !weatherDecisionUsable
                        ? t("map.forecastRefresh")
                        : farmWeather?.providerReportedRain
                        ? t("map.rainReportedNow")
                        : farmWeather?.imminentRain
                          ? t("map.rainLikelyIn", { hours: farmWeather.nextRainHours ?? 3 })
                          : farmWeather?.currentDescription || t("map.forecastRefresh")}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-sky-800">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{farmLocationLabel || t("map.locationRequired")}</span>
                    </p>
                  </div>
                </div>

                {/* Detail cards — same grid width as the header above, equal sizing */}
                {farmLocationLabel && farmWeather ? (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                      <WeatherStatTile
                        icon={<Thermometer className="h-3.5 w-3.5" />}
                        label={t("map.temperature")}
                        value={`${farmWeather.currentTemperature ?? displayClimate.temperature}°C`}
                      />
                      <WeatherStatTile
                        icon={<Droplets className="h-3.5 w-3.5" />}
                        label={t("map.humidity")}
                        value={`${farmWeather.currentHumidity ?? displayClimate.humidity}%`}
                      />
                      <WeatherStatTile
                        icon={<Wind className="h-3.5 w-3.5" />}
                        label={t("map.windSpeed")}
                        value={`${farmWeather.currentWindSpeed ?? 0} km/h`}
                      />
                      <WeatherStatTile
                        icon={<CloudRain className="h-3.5 w-3.5" />}
                        label={t("map.rainfall")}
                        value={
                          farmWeather.providerReportedRain
                            ? t("map.rainingNow")
                            : farmWeather.imminentRain
                              ? t("map.expectedIn", { hours: farmWeather.nextRainHours ?? 3 })
                              : t("map.noneExpectedSoon")
                        }
                        tone={farmWeather.providerReportedRain || farmWeather.imminentRain ? "text-amber-700" : "text-slate-900"}
                      />
                      <WeatherStatTile
                        icon={<Clock3 className="h-3.5 w-3.5" />}
                        label={t("map.checked")}
                        value={farmWeather.fetchedAt ? new Date(farmWeather.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                      />
                    </div>

                    <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      {[
                        {
                          label: "Field Stress",
                          value: stress ? "View risks" : "Checking",
                          icon: <AlertTriangle className="h-3.5 w-3.5" />,
                          tone: stress?.severity === "high" ? "text-red-700" : stress?.severity === "moderate" ? "text-amber-700" : "text-slate-900",
                        },
                        { label: "Drought Risk", value: stress?.scores.drought == null ? "Checking" : stress.scores.drought >= 75 ? "High" : stress.scores.drought >= 50 ? "Moderate" : stress.scores.drought >= 25 ? "Low" : "Normal", icon: <Droplets className="h-3.5 w-3.5" />, tone: (stress?.scores.drought ?? 0) >= 50 ? "text-amber-700" : "text-slate-900" },
                        { label: "Flood Risk", value: stress?.scores.flood == null ? "Checking" : stress.scores.flood >= 75 ? "High" : stress.scores.flood >= 50 ? "Moderate" : stress.scores.flood >= 25 ? "Low" : "Normal", icon: <CloudRain className="h-3.5 w-3.5" />, tone: (stress?.scores.flood ?? 0) >= 50 ? "text-blue-700" : "text-slate-900" },
                        { label: "Heat Risk", value: stress?.scores.heat == null ? "Checking" : stress.scores.heat >= 75 ? "High" : stress.scores.heat >= 50 ? "Moderate" : stress.scores.heat >= 25 ? "Low" : "Normal", icon: <Thermometer className="h-3.5 w-3.5" />, tone: (stress?.scores.heat ?? 0) >= 50 ? "text-red-700" : "text-slate-900" },
                      ].map((tile) => (
                        <button key={tile.label} type="button" onClick={() => { setSelectedStress(tile.label === "Drought Risk" ? "drought" : tile.label === "Flood Risk" ? "flood" : tile.label === "Heat Risk" ? "heat" : "overall"); setStressExpanded(true) }} className="text-left transition hover:-translate-y-0.5">
                          <WeatherStatTile icon={tile.icon} label={tile.label} value={tile.value} tone={tile.tone} />
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setStressExpanded(true)}
                      className="mt-2 flex w-full items-center justify-between rounded-lg border border-sky-100 bg-white px-3 py-2 text-left text-xs font-semibold text-sky-800 hover:bg-sky-50"
                      aria-haspopup="dialog"
                    >
                      <span>{isOnline ? (stress?.status === "Online Verified" ? "Online" : "Online · local estimate") : "Offline"} · view full stress details</span>
                      <ChevronDown className="h-4 w-4" />
                    </button>

                    <Dialog open={stressExpanded} onOpenChange={setStressExpanded}>
                      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /> {selectedStress === "overall" ? "Field stress risk details" : `${selectedStress[0].toUpperCase()}${selectedStress.slice(1)} stress details`}</DialogTitle>
                          <DialogDescription>Evidence-based assessment for {farmLocationLabel || "your farm"}, using connected sensors, zone history, irrigation activity, and the Regional Weather API.</DialogDescription>
                        </DialogHeader>
                        {stress && (
                          <div className="space-y-4 text-sm text-slate-700">
                            <div className="flex items-center justify-between rounded-xl border border-sky-100 bg-gradient-to-r from-sky-50 to-emerald-50 px-4 py-3">
                              <div className="flex min-w-0 items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-sky-700" /><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Farm location</p><p className="truncate font-black text-slate-900">{farmLocationLabel || "Location not configured"}</p><p className="text-[10px] text-slate-500">{farmProfile.farmLocation?.source === "device" ? "GPS location · precise for this device" : farmProfile.farmLocation?.source === "search" ? "Searched place · area forecast, not field GPS" : "Set a location for local weather"}</p>{farmProfile.farmLocation && <p className="text-[10px] tabular-nums text-slate-500">{farmProfile.farmLocation.latitude.toFixed(4)}, {farmProfile.farmLocation.longitude.toFixed(4)}</p>}</div></div>
                              <span className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase text-sky-700">{farmWeather?.source === "live" && isOnline ? "Live weather" : "Local estimate"}</span>
                            </div>
                          <div className="grid gap-2 sm:grid-cols-3">
                              <div className="rounded-lg border border-sky-100 bg-sky-50 p-3"><p className="text-[10px] font-bold uppercase text-sky-700">Condition</p><p className="mt-1 text-lg font-black">{selectedStressLabel}</p></div>
                              <div className="rounded-lg border border-sky-100 bg-sky-50 p-3"><p className="text-[10px] font-bold uppercase text-sky-700">Severity</p><p className="mt-1 text-lg font-black">{selectedStressSeverity}</p></div>
                              <div className="rounded-lg border border-sky-100 bg-sky-50 p-3"><p className="text-[10px] font-bold uppercase text-sky-700">Mode</p><p className="mt-1 text-sm font-black">{isOnline ? "Online" : "Offline"}</p></div>
                            </div>
                            <div className="rounded-xl border border-slate-200 p-4">
                              <h3 className="font-black text-slate-900">{selectedStress === "overall" ? "Risk factors" : `${selectedStress[0].toUpperCase()}${selectedStress.slice(1)} risk factors`} <span className="font-normal text-slate-500">· {farmLocationLabel || "your farm"}</span></h3>
                              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                                {[
                                  ["Drought", stress.scores.drought, "Signals: low soil moisture, drying trend, high evaporative demand, or absent rainfall. Effect: wilting, poor nutrient uptake, flower/fruit drop, and yield loss."],
                                  ["Flood / excess water", stress.scores.flood, "Signals: wet soil, rainfall, persistent saturation, or recent irrigation. Effect: oxygen-starved roots, root disease, nutrient leaching, and plant yellowing."],
                                  ["Heat stress", stress.scores.heat, "Signals: high temperature, VPD, heat duration, and dry-soil amplification. Effect: excess water loss, leaf scorching/rolling, pollen failure, and smaller yields."],
                                ].map(([name, score, explanation]) => {
                                  const key = String(name).split(" ")[0].toLowerCase() as "drought" | "flood" | "heat"
                                  const selected = selectedStress === key
                                  return (
                                    <button key={String(name)} type="button" onClick={() => setSelectedStress(key)} aria-pressed={selected} className={`min-h-44 rounded-xl p-4 text-left transition ${selected ? "border-2 border-sky-500 bg-sky-50 shadow-sm" : "border border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50/60"}`}>
                                      <div className="flex items-center justify-between"><span className="font-bold">{name}</span><span className="font-black">{score}/100</span></div>
                                      <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-sky-700">What we’re seeing</p>
                                      <p className="mt-1 text-xs leading-5 text-slate-600">{String(explanation).split(" Effect:")[0].replace("Signals: ", "")}</p>
                                      <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Crop impact</p>
                                      <p className="mt-1 text-xs leading-5 text-slate-600">{String(explanation).split(" Effect: ")[1] || "Monitor the crop and confirm on site."}</p>
                                      {selected && <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-sky-700">Selected</p>}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                            <div className="grid gap-2 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
                              <p><strong>Moisture trend:</strong> {stress.details.moistureTrend}</p>
                              <p><strong>Temperature/VPD:</strong> {stress.details.temperatureVpd}</p>
                              <p><strong>Rain context:</strong> {stress.details.rainContext}</p>
                              <p><strong>Irrigation:</strong> {stress.details.irrigationContext}</p>
                              <p><strong>Sensor coverage:</strong> {stress.data.coveragePercent}% ({stress.data.freshZones}/{stress.data.zonesEvaluated} zones)</p>
                              <p><strong>Last update:</strong> {new Date(stress.lastUpdatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>
                            </div>
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p><strong>Contributing parameters:</strong> {stress.contributors.length ? stress.contributors.join(" · ") : "No elevated stress signals"}</p>{stress.details.limitation && <p className="mt-2"><strong>Limitation:</strong> {stress.details.limitation}</p>}</div>
                          </div>
                        )}
                      </DialogContent>
                    </Dialog>

                    {/* Spray advisory — full width, same grid alignment, grows to fill remaining height */}
                    <div className="mt-2.5 flex flex-1 flex-col justify-center rounded-lg border border-sky-100 bg-white p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-sky-700">
                        <Sprout className="h-3.5 w-3.5" />
                        {t("map.sprayAdvisory")}
                      </div>
                      <p className="mt-1 text-sm font-bold leading-snug text-slate-900">{farmWeatherAdvisory}</p>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 flex-1 text-sm text-slate-600">{farmWeatherAdvisory}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <HardwareSafetyPanel />

            <Card className="border-violet-200 bg-violet-50/40 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="h-5 w-5 text-violet-700" />
                  Hardware queue
                </CardTitle>
                <CardDescription>Commands waiting for the shared pump controller</CardDescription>
              </CardHeader>
              <CardContent className="pt-0 text-sm">
                {queuedWaterZoneIds.length > 0 || globalQueueTargets.length > 0 ? (
                  <div className="rounded-lg border border-violet-200 bg-white p-3">
                    <p className="font-bold text-violet-900">
                      {globalQueueTargets.length > 0 ? "Global irrigation plan" : "Zone irrigation queued"}
                    </p>
                    <p className="mt-1 text-slate-700">
                      {globalQueueTargets.length > 0
                        ? `Pump will irrigate ${globalQueueTargets.length} zone${globalQueueTargets.length === 1 ? "" : "s"}: ${globalQueueTargets.join(", ")}.`
                        : `Pump will irrigate: ${queuedWaterZoneIds.join(", ")}.`}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 border-violet-300 text-violet-800 hover:bg-violet-100"
                      disabled={isClearingIrrigationQueue}
                      onClick={clearIrrigationQueue}
                    >
                      {isClearingIrrigationQueue ? "Clearing…" : "Clear irrigation queue"}
                    </Button>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-violet-200 bg-white/70 p-3 text-slate-600">
                    No irrigation commands are waiting.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Irrigate Now — visually distinct (blue) from the Kill Switch (red) so the two actions are never confused */}
            <Card className="border-blue-200 bg-blue-50/40 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Droplets className="h-5 w-5 text-blue-600" />
                  {t("map.irrigateNow")}
                </CardTitle>
                <CardDescription>{t("map.irrigateNowDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button
                  type="button"
                  className="w-full bg-blue-600 text-white hover:bg-blue-700"
                  disabled={isIrrigatingAll || irrigationMeta.hydrateDisabled || irrigationMeta.targetedZoneIds.length === 0}
                  onClick={() => setIsIrrigateConfirmOpen(true)}
                >
                  <Droplets className="mr-2 h-4 w-4" />
                  {isIrrigatingAll ? t("map.starting") : t("map.irrigateNow")}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  {irrigateNotice
                    ? irrigateNotice
                    : irrigationMeta.hydrateDisabled
                      ? irrigationMeta.hydrateReason || t("map.irrigationOnHold")
                      : irrigationMeta.targetedZoneIds.length > 0
                        ? `Will start bounded pulses on ${irrigationMeta.targetedZoneIds.join(", ")}.`
                        : t("map.allZonesAboveTarget")}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Confirm before triggering irrigation — a simple popup, not a permanent panel */}
        <Dialog open={isIrrigateConfirmOpen} onOpenChange={setIsIrrigateConfirmOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Droplets className="h-5 w-5 text-blue-600" />
                Start irrigation now?
              </DialogTitle>
              <DialogDescription>
                This will immediately start a bounded, 3-second-pulse irrigation loop on{" "}
                {irrigationMeta.targetedZoneIds.join(", ") || "the targeted zones"}. The controller checks soil
                moisture after every pulse and stops automatically once each zone reaches target.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setIsIrrigateConfirmOpen(false)}>
                Cancel
              </Button>
              <Button type="button" className="bg-blue-600 text-white hover:bg-blue-700" onClick={handleIrrigateNow}>
                Yes, irrigate now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ================= FARM LAYOUT ================= */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                {t("map.farmLayout")}
              </div>

              <div className="flex items-center gap-2 text-xs font-semibold text-[#3a7d44]">
                <span className="h-2 w-2 rounded-full bg-[#3a7d44]"></span>
                {t("map.pumpPilotBadge")}
              </div>
            </CardTitle>
            <CardDescription>
              {t("map.layoutSummary", { count: mapZoneCount, rows, columns, acres: farmProfile.acres })}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div
              className="grid gap-2 p-4 bg-muted/30 rounded-lg overflow-auto [--zone-min:60px] md:[--zone-min:0px]"
              style={{
                gridTemplateColumns: `repeat(${Math.max(columns, 1)}, minmax(var(--zone-min), 1fr))`,
                transform: `scale(${zoomLevel})`,
                transformOrigin: "top left",
              }}
            >
              {visibleZones.map((zone) => (
                <div
                  key={zone.id}
                  className={`
  relative aspect-square rounded-lg border-2 cursor-pointer transition-all duration-200
  ${getZoneColor(zone)}
  ${selectedZone?.id === zone.id ? "ring-2 ring-primary ring-offset-2" : ""}
  ${zone.activeDetection && (zone.mlConfidence ?? 0) > 0.7 ? "ring-4 ring-red-400/50" : ""}
                        }
`}
                  onClick={() => {
                    const recommendation = getZoneRecommendation(zone)
                    setSelectedZone(zone)
                    setIsRecommendationOpen(Boolean(recommendation))
                  }}
                >
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-2">
                    <span className="text-[10px] font-bold text-white opacity-80 uppercase leading-none">{getZoneLabel(zone.id)}</span>
                    <span className="text-xs font-black text-white">{zone.soilMoisture}%</span>
                    <span className="text-[9px] text-white/80">{zone.id}</span>
                    {(zone.decisions?.irrigation.action === "defer_for_rain" ||
                      zone.decisions?.irrigation.action === "monitor_after_rain") && (
                      <span
                        title={zone.decisions.irrigation.reason}
                        className="mt-1 rounded bg-white/20 px-1 text-[8px] font-bold uppercase tracking-wide text-white"
                      >
                        {zone.decisions.irrigation.action === "defer_for_rain" ? t("map.rainDefer") : t("map.rainMonitor")}
                      </span>
                    )}
                  </div>

                  {(zone.status !== "healthy" || zone.activeDetection || zone.cropReview) && (
                    <div className="absolute -top-1 -right-1 bg-white rounded-full p-1">
                      {zone.activeDetection ? <AlertTriangle className="h-4 w-4 text-red-600" /> : zone.cropReview ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : getStatusIcon(zone.status)}
                    </div>
                  )}

                  {/* ML Brain Indicator */}
                  {zone.activeDetection && (zone.mlConfidence ?? 0) > 0.7 && (
                    <div className="absolute bottom-1 left-1">
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-md animate-pulse" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ================= FARM ML INTELLIGENCE — full width (Live Operations Snapshot moved to Dashboard) ================= */}
        <Card className="shadow-md border">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                Field risk overview
              </CardTitle>
              <CardDescription>
                Current risk from active diagnoses, soil readings, and the location forecast
              </CardDescription>
            </div>

            {farmData.length > 0 && (() => {
              const risk = Math.max(0, Math.min(100, farmRisk.currentRiskPercent))

              const label =
                risk >= 60
                  ? t("map.highAlert")
                  : risk >= 30
                    ? t("map.monitor")
                    : t("map.stable")

              const style =
                risk >= 60
                  ? "bg-red-100 text-red-700"
                  : risk >= 30
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-green-100 text-green-700"

              return (
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${style}`}>
                  {label}
                </span>
              )
            })()}
          </CardHeader>

          <CardContent>
            {farmData.length > 0 && (
              <div className="space-y-8">

                {/* Farm-wide Active Disease Risk */}
                {(() => {
                  const risk = Math.max(0, Math.min(100, farmRisk.currentRiskPercent))

                  let label = t("map.stable")
                  let color = "text-green-600"

                  if (risk >= 60) {
                    label = t("map.criticalOutbreakRisk")
                    color = "text-red-600"
                  } else if (risk >= 30) {
                    label = t("map.moderateRisk")
                    color = "text-yellow-600"
                  }

                  return (
                    <div className={`mt-3 text-sm font-medium ${color}`}>
                      Overall Status: {label}
                    </div>
                  )
                })()}
                {(() => {
                  const risk = Math.max(0, Math.min(100, farmRisk.currentRiskPercent))
                  const farmZoneCount = farmRisk.farmZoneCount || farmProfile.zones

                  return (
                    <div className="p-6 rounded-xl bg-gradient-to-br from-emerald-50 via-white to-green-50 border shadow-sm">                          <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">
                        Farm-wide Active Disease Risk
                      </span>
                      <span className="text-3xl font-bold tracking-tight">
                        {risk.toFixed(1)}%
                      </span>
                    </div>

                      <p className="mt-2 text-xs text-slate-600">
                        Active detections: {farmRisk.activeDetections} across {farmRisk.activeZoneCount}/{farmZoneCount} zones
                      </p>

                      <div className="mt-3 h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-700 ${risk >= 60
                            ? "bg-red-500"
                            : risk >= 30
                              ? "bg-yellow-500"
                              : "bg-green-500"
                            }`}
                          style={{ width: `${risk}%` }}
                        />
                      </div>
                    </div>
                  )
                })()}

                <div className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-emerald-700" />
                    <h4 className="text-sm font-semibold text-slate-900">{t("map.todaysFarmSummary")}</h4>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-rose-100 bg-rose-50/80 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-rose-600">{t("map.irrigationPilot")}</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{farmSummary.pilotIrrigationRequired} of A1–A4 need water now</p>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">{t("map.monitoring")}</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{farmSummary.monitoringRequired} grids require monitoring</p>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">{t("map.healthyLabel")}</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{farmSummary.healthyZones} healthy grids</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t("map.pumps")}</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">
                        {farmSummary.noPumpsActive ? t("map.noPumpsActive") : t("map.pumpsActive")}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Only real, active classifier records appear here. */}
                {activeDiseaseZones.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-sm font-semibold">{t("map.activeDiseaseDetections")}</h4>
                    <div className="grid gap-4 md:grid-cols-3">
                      {activeDiseaseZones.slice(0, 3).map((zone) => {
                        const severity = zone.severityLevel || "review"
                        const severityTone = severity === "high" ? "text-red-700" : severity === "moderate" ? "text-amber-700" : "text-slate-600"
                        return (
                          <div key={zone.id} className="rounded-lg border bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold uppercase text-muted-foreground">Zone {zone.id}</span>
                              <span className={`text-xs font-bold uppercase ${severityTone}`}>{severity}</span>
                            </div>
                            <div className="mt-1 text-base font-semibold capitalize">{humaniseDisease(zone.canonicalDisease || zone.disease)}</div>
                            <div className="mt-2 text-sm text-muted-foreground">
                              {Math.round((zone.mlConfidence ?? 0) * 100)}% model confidence
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

              </div>
            )}
          </CardContent>
        </Card>

        {isRecommendationOpen && selectedZoneRecommendation && selectedZone && (() => {
          const rec = selectedZoneRecommendation
          const urgent = rec.priorityLabel === "Urgent"
          const watch = rec.priorityLabel === "Weather watch"
          const glowClass = urgent ? "glow-danger" : watch ? "glow-warn" : "glow-brand"
          const accent = urgent ? "var(--glow-danger)" : watch ? "var(--glow-warn)" : "var(--glow-brand)"
          const priorityChip = urgent ? t("map.actNow") : watch ? t("map.watchTheSky") : t("map.steadyMonitor")
          const moisture = selectedZone.soilMoisture
          const target = irrigationMeta.wetThreshold
          const dry = irrigationMeta.dryThreshold
          const belowTarget = Math.max(0, target - moisture)
          const leverage = zoneLeverage[selectedZone.id] ?? 0
          const read = selectedZone.disease
            ? interpretDetection({
                disease: selectedZone.canonicalDisease || selectedZone.disease,
                crop: farmProfile.primaryCrop,
                confidence: selectedZone.mlConfidence,
                cropMatch: selectedZone.cropReview ? "review" : undefined,
              })
            : null
          const briefing = urgent
            ? t("map.briefing.urgent", { zone: getZoneLabel(selectedZone.id), moisture, below: belowTarget, target })
            : watch
              ? t("map.briefing.watch")
              : t("map.briefing.stable", { moisture })
          const moistureTone = moisture < dry ? "#f87171" : moisture < target ? "#fbbf24" : "#34d399"
          const irrigateNow = Boolean(selectedZone.decisions?.irrigation.allowsStart)
          const canSprayNow = Boolean(displayClimate.isLive && selectedZone.decisions?.spray.allowed)
          const sprayVpdHint = !displayClimate.isLive
            ? "Fresh VPD sensor reading needed"
            : canSprayNow
              ? "VPD and weather are safe"
              : displayClimate.vpdBand !== "green"
                ? "Wait for a better VPD"
                : "Wait for safer weather"
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
              onClick={() => setIsRecommendationOpen(false)}
            >
              <div
                className={`surface-command elevated motion-rise ${glowClass} relative w-full max-w-xl overflow-hidden rounded-3xl border border-white/10`}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Priority accent rail */}
                <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, rgba(${accent}/0.9), rgba(${accent}/0.2))` }} />

                <div className="p-5 sm:p-6">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/45">
                        {t("map.actionBriefing", { zone: getZoneLabel(selectedZone.id) })}
                      </p>
                      <h3 className="text-gradient-brand mt-1 text-2xl font-black leading-tight">
                        {irrigateNow ? `Irrigate ${getZoneLabel(selectedZone.id)} now` : rec.actionLabel}
                      </h3>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white"
                      style={{ background: `rgba(${accent}/0.18)`, border: `1px solid rgba(${accent}/0.5)` }}
                    >
                      {priorityChip}
                    </span>
                  </div>

                  {/* Farmer-language verdict */}
                  <p className="mt-3 text-sm leading-relaxed text-white/70">{briefing}</p>

                  <div className={`mt-3 flex items-center gap-2.5 rounded-xl border p-3 ${irrigateNow ? "border-blue-300/40 bg-blue-500/20" : "border-amber-300/30 bg-amber-500/10"}`}>
                    <Droplets className={`h-5 w-5 shrink-0 ${irrigateNow ? "text-blue-300" : "text-amber-200"}`} />
                    <div>
                      <p className="text-base font-black leading-tight text-white">
                        {irrigateNow ? "IRRIGATE NOW" : "DO NOT IRRIGATE NOW"}
                      </p>
                      <p className="mt-0.5 text-xs text-white/75">
                        {irrigateNow
                          ? `Start ${rec.pulseCount} short water pulse${rec.pulseCount === 1 ? "" : "s"} for ${getZoneLabel(selectedZone.id)}.`
                          : selectedZone.decisions?.irrigation.reason || "Soil moisture is currently adequate."}
                      </p>
                    </div>
                  </div>

                  {/* Metric tiles */}
                  <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <div className="glass rounded-2xl p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">{t("map.soilMoistureLabel")}</p>
                      <p className="mt-1 text-xl font-black text-white">
                        {moisture}<span className="text-sm font-semibold text-white/50">%</span>
                      </p>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(3, moisture))}%`, background: moistureTone }} />
                      </div>
                      <p className="mt-1.5 text-[10px] text-white/40">Target {target}%</p>
                    </div>

                    <div className="glass rounded-2xl p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">{t("map.pumpPlan")}</p>
                      <p className="mt-1 text-xl font-black text-white">
                        {rec.pulseCount > 0 ? rec.pulseCount : selectedZoneHasPrototypePump ? "—" : "N/A"}
                        {rec.pulseCount > 0 && <span className="text-sm font-semibold text-white/50"> pulses</span>}
                      </p>
                      <p className="mt-1.5 text-[10px] text-white/40">
                        {rec.pulseCount > 0
                          ? `3-second pulses · max ${MAX_IRRIGATION_PULSES}`
                          : selectedZoneHasPrototypePump
                            ? t("map.reviewBeforePulse")
                            : t("map.mapMonitorZone")}
                      </p>
                    </div>

                    <div className="glass rounded-2xl p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">Spray check</p>
                      <p className={`mt-1 text-lg font-black leading-tight ${canSprayNow ? "text-emerald-300" : "text-rose-300"}`}>
                        {canSprayNow ? "SPRAY NOW" : "DO NOT SPRAY"}
                      </p>
                      <p className="mt-1.5 text-[11px] font-medium text-white/65">
                        {sprayVpdHint}
                      </p>
                      <p className="mt-1 text-[9px] text-white/35">
                        VPD {displayClimate.vpd.toFixed(2)} kPa · ideal 0.8–1.2
                      </p>
                    </div>

                    {leverage > 0 ? (
                      <div className="glass rounded-2xl p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">{t("map.spreadLeverage")}</p>
                        <p className="mt-1 text-xl font-black text-white">
                          ~{leverage.toFixed(1)}<span className="text-sm font-semibold text-white/50"> inf.</span>
                        </p>
                        <p className="mt-1.5 text-[10px] text-white/40">{t("map.avoidedModel")}</p>
                      </div>
                    ) : read ? (
                      <div className="glass rounded-2xl p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">{t("map.diagnosis")}</p>
                        <p className="mt-1 text-sm font-bold leading-tight text-white">{selectedZone.disease}</p>
                        <p className="mt-1.5 text-[10px] text-white/40">{read.confidenceLabel}</p>
                      </div>
                    ) : (
                      <div className="glass rounded-2xl p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">{t("map.gridPump")}</p>
                        <p className="mt-1 text-sm font-bold capitalize leading-tight text-white">
                          {(selectedZone.gridColor || "green")} · {(selectedZone.pumpStatus || "off")}
                        </p>
                        <p className="mt-1.5 text-[10px] text-white/40">{t("map.liveActuatorState")}</p>
                      </div>
                    )}
                  </div>

                  {/* Why this call */}
                  <div className="glass mt-3 rounded-2xl p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">{t("map.whyThisCall")}</p>
                    <ul className="mt-2 space-y-1.5 text-xs text-white/75">
                      {rec.reasons.slice(0, 2).map((reason) => (
                        <li key={reason} className="flex gap-2.5">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `rgb(${accent})` }} />
                          <span className="leading-snug">{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      variant="ghost"
                      className="text-white/70 hover:bg-white/10 hover:text-white"
                      onClick={() => setIsRecommendationOpen(false)}
                    >
                      Close
                    </Button>
                    <Button
                      variant="outline"
                      className="border-white/20 bg-transparent text-white/90 hover:bg-white/10 hover:text-white"
                      onClick={() => {
                        setIsRecommendationOpen(false)
                        setIsZoneDetailsOpen(true)
                      }}
                    >
                      Read more
                    </Button>
                    {selectedZone.activeDetection && (
                      <Button
                        className="bg-brand text-white hover:bg-brand-strong"
                        onClick={() => window.location.assign(`/dashboard/autospray?zone=${encodeURIComponent(selectedZone.id)}`)}
                      >
                        <Sprout className="mr-2 h-4 w-4" />
                        Open spray plan
                      </Button>
                    )}
                    <Button
                      className="bg-blue-600 text-white hover:bg-blue-700"
                      disabled={isHydrating || !selectedZoneHasPrototypePump || !selectedZone.decisions?.irrigation.allowsStart}
                      onClick={startSelectedZoneIrrigation}
                    >
                      <Droplets className="mr-2 h-4 w-4" />
                      {isHydrating ? t("map.startingLoop") : t("map.irrigateNow")}
                    </Button>
                  </div>
                  {controlNotice && <p className="mt-3 text-right text-xs text-white/65">{controlNotice}</p>}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Zone Details — second popup, opened via "Read more" in the Action Briefing */}
        <Dialog open={isZoneDetailsOpen} onOpenChange={setIsZoneDetailsOpen}>
          <DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] overflow-y-auto sm:w-full sm:max-w-xl">
            {selectedZone && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Sprout className="h-5 w-5 text-green-600" />
                    {t("map.zoneDetailsTitle")}
                  </DialogTitle>
                  <DialogDescription>
                    {t("map.zoneDetailsDesc", { label: getZoneLabel(selectedZone.id), id: selectedZone.id })}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                  {/* Status Badge */}
                  <div className="flex items-center justify-between">
                    <Badge
                      variant={
                        selectedZone.activeDetection
                          ? "destructive"
                          : selectedZone.cropReview
                            ? "secondary"
                          : selectedZone.status === "healthy"
                          ? "default"
                          : selectedZone.status === "warning"
                            ? "secondary"
                            : "destructive"
                      }
                      className="capitalize"
                    >
                      {selectedZone.activeDetection ? t("map.diseaseAlert") : selectedZone.cropReview ? t("map.cropCheck") : selectedZone.status}
                    </Badge>
                    <span className="text-sm font-medium text-slate-600">
                      {selectedZone.activeDetection ? t("map.reviewActiveDiagnosis") : t("map.soilBasedStatus")}
                    </span>
                  </div>

                  {/* Disease Info */}
                  {selectedZone.disease && (
                    <div className="p-3 rounded-lg bg-muted/50">
                      <p className={`text-sm font-medium ${selectedZone.activeDetection ? "text-destructive" : selectedZone.cropReview ? "text-amber-700" : "text-slate-600"}`}>{selectedZone.activeDetection ? t("map.activeDiagnosisLabel") : selectedZone.cropReview ? t("map.cropConfirmationNeeded") : t("map.lastTreatedDiagnosis")}</p>
                      <p className="text-sm">{selectedZone.disease}</p>
                    </div>
                  )}

                  <Separator />

                  {/* Sensor Data */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium">{t("map.environmentalData")}</h4>

                    <div className="flex items-center gap-3">
                      <Droplets className="h-4 w-4 text-blue-600" />
                      <div className="flex-1">
                        <p className="text-sm">{t("map.soilMoisture")}</p>
                        <p className="text-lg font-bold">{selectedZone.soilMoisture}%</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded border p-2">
                        <div className="text-slate-500">{t("map.grid")}</div>
                        <div className="font-bold uppercase">{selectedZone.gridColor || "green"}</div>
                      </div>
                      <div className="rounded border p-2">
                        <div className="text-slate-500">{t("map.pump")}</div>
                        <div className="font-bold uppercase">{selectedZone.pumpStatus || "off"}</div>
                      </div>
                      <div className="rounded border p-2">
                        <div className="text-slate-500">{t("map.cycle")}</div>
                        <div className="font-bold uppercase">{selectedZone.cycleStatus || "idle"}</div>
                      </div>
                      <div className="rounded border p-2">
                        <div className="text-slate-500">{t("map.farmVpd")}</div>
                        <div className="font-bold uppercase">
                          {displayClimate.vpd.toFixed(2)} kPa ({displayClimate.vpdBand})
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">
                          Optimal for spraying: 0.8–1.2 kPa · {getFarmVpdStatus(displayClimate)}
                        </div>
                      </div>
                    </div>

                    {(() => {
                      const guidance = getFarmerSprayGuidance(selectedZone.decisions?.spray, displayClimate, farmWeather)
                      return (
                        <div className={`rounded-lg border p-3 text-xs ${guidance.tone}`}>
                          <p className="font-bold">Spray guidance: {guidance.title}</p>
                          <p className="mt-1">{guidance.action}</p>
                          <p className="mt-1.5 font-medium">{guidance.timing}</p>
                        </div>
                      )
                    })()}

                    {selectedZone.sensorError && (
                      <p className="text-xs font-semibold text-red-600">
                        {selectedZone.sensorErrorMessage || t("map.sensorError")}
                      </p>
                    )}

                    <div
                      className={`rounded-xl border-2 p-4 shadow-sm ${selectedZone.decisions?.irrigation.allowsStart
                        ? "border-blue-400 bg-gradient-to-r from-blue-600 to-cyan-600 text-white"
                        : "border-amber-300 bg-amber-50 text-amber-950"
                        }`}
                    >
                      <div className="flex items-center gap-2">
                        <Droplets className="h-5 w-5 shrink-0" />
                        <p className="text-lg font-black leading-tight">
                          Irrigation decision: {getIrrigationActionLabel(selectedZone.decisions?.irrigation)}
                        </p>
                      </div>
                      <p className="mt-2 text-sm font-medium leading-relaxed opacity-95">
                        {selectedZone.decisions?.irrigation.reason || t("map.waitingWeatherDecision")}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <Thermometer className="h-4 w-4 text-orange-600" />
                      <div className="flex-1">
                        <p className="text-sm">{t("map.farmTemperature")}</p>
                        <p className="text-lg font-bold">{displayClimate ? `${displayClimate.temperature}°C` : "—"}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Wind className="h-4 w-4 text-green-600" />
                      <div className="flex-1">
                        <p className="text-sm">{t("map.farmHumidity")}</p>
                        <p className="text-lg font-bold">{displayClimate ? `${displayClimate.humidity}%` : "—"}</p>
                      </div>
                    </div>
                  </div>
                  {selectedZone.disease && selectedZone.activeDetection ? (
                    <>
                      <Separator />
                      {(() => {
                        const risk = interpretZoneRisk(selectedZone)
                        const read = interpretDetection({
                          disease: selectedZone.canonicalDisease || selectedZone.disease,
                          crop: farmProfile.primaryCrop,
                          confidence: selectedZone.mlConfidence,
                          cropMatch: selectedZone.cropReview ? "review" : undefined,
                        })
                        return (
                          <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <h4 className="flex items-center gap-2 text-sm font-semibold">
                                <Gauge className="h-4 w-4 text-slate-600" /> AI Risk Analysis
                              </h4>
                              <Badge variant={risk.badgeVariant} className="capitalize">{risk.level}</Badge>
                            </div>

                            {/* Plain verdict first; confidence is subtext. */}
                            <div>
                              <p className={`text-base font-black capitalize ${toneColor[read.tone].text}`}>{read.verdict}</p>
                              <p className="text-xs text-muted-foreground">{read.confidenceLabel}</p>
                            </div>

                            <div className="text-sm">
                              <span className="text-muted-foreground">{t("map.spreadRisk")}</span>{" "}
                              <span className={risk.spreadColor}>{risk.spreadRisk}</span>
                              <p className="mt-0.5 text-xs text-muted-foreground">{risk.spreadReason}</p>
                            </div>

                            <div className="rounded-lg bg-white/70 p-3 text-sm">
                              <span className="font-semibold text-slate-800">{t("map.whatToDo")}</span>
                              <span className="text-slate-700">{risk.meaning}</span>
                            </div>

                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{t("map.scanned", { date: selectedZone.lastAnalyzed ? formatDate(selectedZone.lastAnalyzed) : t("map.thisSession") })}</span>
                              <span>{t("map.modelAssessment")}</span>
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  ) : (
                    <>
                      <Separator />
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                        <h4 className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                          <CheckCircle className="h-4 w-4 text-emerald-600" /> AI Risk Analysis
                        </h4>
                        <p className="mt-1 text-sm text-emerald-800">{t("map.noActiveDisease")}</p>
                      </div>
                    </>
                  )}

                  {/* Additional Info */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("map.plantCount")}</span>
                      <span className="font-medium">{getCalculatedPlantCount()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("map.cropDensity")}</span>
                      <span className="font-medium">1 plant / {getDensityDivisor(farmProfile.primaryCrop)} sq yd</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("map.lastSprayed")}</span>
                      <span className="font-medium">
                        {formatDate(selectedZone.lastSprayed)}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  {/* Actions */}
                  <div className="space-y-2">
                    <Button
                      className={`w-full ${!selectedZoneHasPrototypePump
                        ? "bg-slate-100 hover:bg-slate-100 text-slate-600 border-slate-200 cursor-not-allowed"
                        : !selectedZone.decisions?.irrigation.allowsStart
                          ? "bg-amber-100 hover:bg-amber-100 text-amber-800 border-amber-200 cursor-not-allowed"
                        : "bg-blue-600 hover:bg-blue-700 text-white"
                        }`}
                      variant={!selectedZoneHasPrototypePump ? "outline" : "default"}
                      size="sm"
                      disabled={isHydrating || !selectedZoneHasPrototypePump || !selectedZone.decisions?.irrigation.allowsStart}
                      onClick={startSelectedZoneIrrigation}
                    >
                      <Droplets className="mr-2 h-4 w-4" />
                      {isHydrating
                        ? t("map.startingLoop")
                        : !selectedZoneHasPrototypePump
                          ? t("map.mapOnlyZone")
                          : !selectedZone.decisions?.irrigation.allowsStart
                            ? getIrrigationActionLabel(selectedZone.decisions?.irrigation)
                            : t("map.startIrrigationLoop")}
                    </Button>
                    {selectedZoneHasPrototypePump && selectedZone.decisions?.irrigation.allowsStart && !isHydrating && (
                      <p className="mt-1 text-center text-[11px] text-slate-500">{irrigationLoopSubtext}</p>
                    )}

                    <Button
                      className="w-full bg-green-600 text-white hover:bg-green-700"
                      size="sm"
                      onClick={() => {
                        window.location.assign(`/dashboard/autospray?zone=${encodeURIComponent(selectedZone.id)}`)
                      }}
                    >
                      <Sprout className="mr-2 h-4 w-4" />
                      Open spray plan
                    </Button>

                    <p className="text-xs text-muted-foreground">
                      {controlNotice || selectedZone.decisions?.spray.reason || t("map.openTankMixCheck")}
                    </p>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        <Dialog
          open={isLocationDialogOpen}
          onOpenChange={(open) => {
            setIsLocationDialogOpen(open)
            if (!open) setLocationError(null)
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-[#3a7d44]" />
                {t("map.setYourFarmLocation")}
              </DialogTitle>
              <DialogDescription>
                {t("map.locationDialogDesc")}
              </DialogDescription>
            </DialogHeader>

            <FarmLocationPicker
              value={draftFarmLocation}
              onChange={(location) => {
                setDraftFarmLocation(location)
                setLocationError(null)
              }}
              fallbackLabel={t("map.currentFarmLocation")}
              disabled={isSavingLocation}
            />

            {locationError && <p className="text-sm font-medium text-red-600">{locationError}</p>}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsLocationDialogOpen(false)}
                disabled={isSavingLocation}
              >
                Set later
              </Button>
              <Button
                type="button"
                onClick={handleSaveFarmLocation}
                disabled={isSavingLocation || !draftFarmLocation}
                className="bg-[#3a7d44] text-white hover:bg-[#2e6336]"
              >
                {isSavingLocation ? t("map.savingLocation") : t("map.saveFarmLocation")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
