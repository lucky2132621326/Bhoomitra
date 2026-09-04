"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, CloudRain, Droplets, FlaskConical, History, Loader2, MapPin, RefreshCw, Sprout, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { DEMO_CONTROL_ZONE_IDS } from "@/app/lib/demoHardware"
import { estimatePulseLitres, FLOW_CALIBRATED } from "@/app/lib/flowModel"

type SprayDecision = {
  action: string
  allowed: boolean
  reason: string
}

type Zone = {
  id: string
  status: "healthy" | "warning" | "critical" | "uncertain"
  soilMoisture: number
  disease?: string
  canonicalDisease?: string
  mlConfidence?: number
  severityLevel?: "low" | "moderate" | "high"
  activeDetection?: boolean
  cropReview?: boolean
  decisions?: { spray?: SprayDecision }
}

type Recommendation = {
  id: string
  kind: "treatment" | "irrigation" | "preventive"
  zone: string
  detectionId?: string
  chemical?: string
  dosage?: string
  disease?: string
  weatherGated?: boolean
  action?: string
  timing?: string
  estimatedImpact?: string
  reasoning?: string[]
}

type HardwareState = {
  currentAction?: string
  activeZoneId?: string | null
  nozzleStatus?: string
  lastFeedback?: string | null
  awaitingFeedback?: boolean
}

type WeatherContext = {
  source?: "live" | "cached" | "fallback"
  currentDescription?: string
  currentWindSpeed?: number | null
  currentWindDirection?: number | null
  providerReportedRain?: boolean
  imminentRain?: boolean
  nextRainHours?: number | null
}

type SprayRecord = {
  id: string
  zoneId: string
  disease?: string
  chemical?: string
  dosage?: string
  timestamp: string
  applicationStatus?: string
  applicationMode?: string
  estimatedLitres?: number | null
}

const isUsableNumber = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0
const isNonNegativeNumber = (value: string) => Number.isFinite(Number(value)) && Number(value) >= 0

function titleCase(value?: string) {
  const afterCrop = value && value.includes("___") ? value.split("___")[1] : value
  return String(afterCrop || "").replace(/_/g, " ").trim() || "Unconfirmed diagnosis"
}

function windDirectionLabel(degrees?: number | null) {
  if (!Number.isFinite(degrees)) return "direction updating"
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
  return directions[Math.round((Number(degrees) % 360) / 45) % directions.length]
}

function formatWhen(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })
}

export default function SmartSprayWorkbench() {
  const [zones, setZones] = useState<Zone[]>([])
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [queue, setQueue] = useState<Record<string, string[]>>({})
  const [hardware, setHardware] = useState<HardwareState>({})
  const [weather, setWeather] = useState<WeatherContext | null>(null)
  const [sprays, setSprays] = useState<SprayRecord[]>([])
  const [selectedZoneId, setSelectedZoneId] = useState("A1")
  const [showHistory, setShowHistory] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [waterValidation, setWaterValidation] = useState(true)
  const [tankPrepared, setTankPrepared] = useState(false)
  const [productName, setProductName] = useState("")
  const [labelRate, setLabelRate] = useState("")
  const [rateUnit, setRateUnit] = useState<"g/L" | "ml/L">("g/L")
  const [carrierWater, setCarrierWater] = useState("")
  const [tankCapacity, setTankCapacity] = useState("")
  const [preHarvestDays, setPreHarvestDays] = useState("")
  const [productCostInr, setProductCostInr] = useState("")
  const [waterPh, setWaterPh] = useState("")

  const load = async () => {
    try {
      const [zoneRes, recRes, queueRes, hardwareRes, sprayRes] = await Promise.all([
        fetch("/api/zones"),
        fetch("/api/recommendations"),
        fetch("/api/zones/queue"),
        fetch("/api/hardware/status"),
        fetch("/api/spray"),
      ])
      const zonePayload = await zoneRes.json()
      const recommendationPayload = recRes.ok ? await recRes.json() : { recommendations: [] }
      const queuePayload = queueRes.ok ? await queueRes.json() : {}
      const hardwarePayload = hardwareRes.ok ? await hardwareRes.json() : {}
      const sprayPayload = sprayRes.ok ? await sprayRes.json() : []

      const nextZones = Array.isArray(zonePayload) ? zonePayload : zonePayload.zones || []
      setZones(nextZones)
      setRecommendations(recommendationPayload.recommendations || [])
      setQueue(queuePayload || {})
      setHardware(hardwarePayload || {})
      setWeather(zonePayload.weather || null)
      setSprays(Array.isArray(sprayPayload) ? sprayPayload : [])

      const requestedZone = new URLSearchParams(window.location.search).get("zone")
      if (requestedZone && nextZones.some((zone: Zone) => zone.id === requestedZone)) {
        setSelectedZoneId(requestedZone)
      } else if (!nextZones.some((zone: Zone) => zone.id === selectedZoneId) && nextZones[0]?.id) {
        setSelectedZoneId(nextZones[0].id)
      }
    } catch {
      toast.error("Could not refresh the spray control view")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = window.setInterval(load, 4_000)
    return () => window.clearInterval(interval)
  }, [])

  const selectedZone = zones.find(zone => zone.id === selectedZoneId) || null
  const selectedRecommendation = recommendations.find(rec => rec.kind === "treatment" && rec.zone === selectedZoneId) || null
  useEffect(() => {
    if (selectedRecommendation?.chemical) setProductName(selectedRecommendation.chemical)
  }, [selectedRecommendation?.chemical])

  const sprayDecision = selectedZone?.decisions?.spray
  const weatherAllowsApplication = Boolean(sprayDecision?.allowed)
  const forecastWind = weather?.currentWindSpeed
  const forecastWindDirection = windDirectionLabel(weather?.currentWindDirection)
  const weatherSourceLabel = weather?.source === "live" ? "live" : weather?.source === "cached" ? "last saved" : weather?.source === "fallback" ? "refreshing" : "checking"
  const rainSignal = weather?.providerReportedRain
    ? "Rain reported now"
    : weather?.imminentRain
      ? `Rain likely in ~${weather.nextRainHours ?? 3}h`
      : "No rain in the immediate window"

  // Same underlying decision (sprayDecision) — just read closely enough to
  // give rain holds a distinct, more urgent warning treatment than a
  // routine wind/VPD hold, instead of one flat "not allowed" state.
  const isRainHold = !weatherAllowsApplication && (sprayDecision?.action === "hold_for_rain" || Boolean(weather?.providerReportedRain))
  const weatherSafety = weatherAllowsApplication
    ? {
        badge: "SAFE",
        heading: "Safe to spray",
        icon: CheckCircle2,
        border: "border-emerald-300",
        bg: "bg-emerald-50",
        text: "text-emerald-800",
        chip: "bg-emerald-600",
      }
    : isRainHold
      ? {
          badge: "HOLD",
          heading: "Hold — rain risk",
          icon: CloudRain,
          border: "border-red-300",
          bg: "bg-red-50",
          text: "text-red-800",
          chip: "bg-red-600",
        }
      : {
          badge: "HOLD",
          heading: "Spraying held",
          icon: AlertTriangle,
          border: "border-amber-300",
          bg: "bg-amber-50",
          text: "text-amber-800",
          chip: "bg-amber-600",
        }

  const waterLiters = Number(carrierWater)
  const capacityLiters = Number(tankCapacity)
  const rate = Number(labelRate)
  const hasVerifiedMix = Boolean(productName.trim()) && isUsableNumber(labelRate) && isUsableNumber(carrierWater) && isUsableNumber(tankCapacity) && isNonNegativeNumber(preHarvestDays)
  const productUnit = rateUnit.startsWith("g") ? "g" : "ml"
  const productAmount = hasVerifiedMix ? rate * waterLiters : 0
  const tankLoads = hasVerifiedMix && isUsableNumber(tankCapacity) ? Math.max(1, Math.ceil(waterLiters / capacityLiters)) : 0
  const productPerTank = tankLoads > 0 ? productAmount / tankLoads : 0
  const queuedCommands = queue[selectedZoneId]?.length || 0
  const inPilotControlArea = (DEMO_CONTROL_ZONE_IDS as readonly string[]).includes(selectedZoneId)

  const activeZones = zones.filter(zone => zone.activeDetection && zone.disease)
  const activeZoneList = activeZones.map(zone => zone.id).join(", ") || "—"
  const statusTone = selectedZone?.status === "critical" ? "destructive" : selectedZone?.status === "warning" ? "secondary" : "outline"

  const sendPumpCommand = async () => {
    if (!selectedZone) return
    if (!inPilotControlArea) {
      toast.info("The physical pump is wired to A1–A4. This zone stays visible for planning only.")
      return
    }
    if (!waterValidation && (!hasVerifiedMix || !tankPrepared || !weatherAllowsApplication)) {
      toast.warning("Confirm the product label, rate, PHI, prepared tank, and weather safety before queueing a chemical application.")
      return
    }
    const confirmed = window.confirm(
      waterValidation
        ? `Run one 3-second clean-water pump test on ${selectedZone.id}?`
        : `Queue a chemical application of ${productName.trim()} on ${selectedZone.id}? Confirm the tank is mixed to the verified label rate.`,
    )
    if (!confirmed) return

    setSending(true)
    try {
      const response = await fetch("/api/spray", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zoneId: selectedZone.id,
          detectionId: waterValidation ? undefined : selectedRecommendation?.detectionId,
          disease: selectedRecommendation?.disease || selectedZone.disease || "Manual application",
          chemical: waterValidation ? "Water-only prototype validation" : productName.trim(),
          dosage: waterValidation ? "No chemical added" : `${labelRate} ${rateUnit}`,
          labelRate: waterValidation ? undefined : Number(labelRate),
          rateUnit: waterValidation ? undefined : rateUnit,
          carrierWaterLiters: waterValidation ? undefined : Number(carrierWater),
          tankCapacityLiters: waterValidation ? undefined : Number(tankCapacity),
          tankPrepared: waterValidation ? true : tankPrepared,
          demoWaterOnly: waterValidation,
          preHarvestIntervalDays: waterValidation ? undefined : Number(preHarvestDays),
          inputCostInr: waterValidation || !isUsableNumber(productCostInr) ? undefined : Number(productCostInr),
          waterPh: waterValidation || !isUsableNumber(waterPh) ? undefined : Number(waterPh),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(payload.message || "The command was not queued")
        return
      }
      toast.success(payload.message || "Pump command queued")
      await load()
    } catch {
      toast.error("Could not reach the pump controller")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-black text-slate-900">
              <Zap className="h-8 w-8 text-blue-600" />
              Smart Spray Control
            </h1>
            <p className="text-slate-500">Select an infected zone, review the AI treatment, and run a verified pump command.</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setShowHistory(value => !value)} className="gap-2 bg-white">
              <History className="h-4 w-4" />
              {showHistory ? "View control grid" : "View activity"}
            </Button>
            <Button variant="outline" onClick={load} disabled={loading} className="gap-2 bg-white">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Active detections + weather safety */}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-red-700"><AlertCircle className="h-4 w-4" /> Active Detections</p>
            {activeZones.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {activeZones.map(zone => (
                  <li key={zone.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-800">{titleCase(zone.canonicalDisease || zone.disease)}</span>
                    <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">{zone.id}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-slate-500">No active disease detections right now.</p>
            )}
          </div>
          <div className={`rounded-xl border-2 p-4 ${weatherSafety.border} ${weatherSafety.bg}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-600"><CloudRain className="h-4 w-4" /> Weather Safety</p>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black uppercase text-white ${weatherSafety.chip}`}>
                {weatherSafety.badge}
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${weatherSafety.chip}`}>
                <weatherSafety.icon className="h-5 w-5" />
              </span>
              <p className={`text-xl font-black leading-snug ${weatherSafety.text}`}>{weatherSafety.heading}</p>
            </div>
            <p className="mt-2.5 text-sm text-slate-700">{sprayDecision?.reason || "Loading weather decision"}</p>
            <p className="mt-1 text-xs text-slate-500">wind {forecastWind != null ? `${forecastWind} km/h from ${forecastWindDirection}` : "updating"} · {rainSignal} · {weatherSourceLabel} data</p>
          </div>
        </div>

        {showHistory ? (
          /* Activity log */
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>Spray &amp; pump activity</CardTitle>
              <CardDescription>Real controller records from the pump queue. Water tests and chemical applications are labelled separately.</CardDescription>
            </CardHeader>
            <CardContent>
              {sprays.length > 0 ? (
                <div className="space-y-3">
                  {sprays.slice().reverse().map(record => {
                    const isWater = record.applicationMode === "water-validation"
                    return (
                      <div key={record.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-4">
                        <div className="flex items-center gap-4">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isWater ? "bg-sky-50 text-sky-600" : "bg-emerald-50 text-emerald-600"}`}>
                            {isWater ? <Droplets className="h-5 w-5" /> : <FlaskConical className="h-5 w-5" />}
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-800">{isWater ? "Water pump test" : record.chemical || "Chemical application"}</span>
                              <Badge variant="secondary" className="text-[10px] uppercase">{record.applicationStatus || "queued"}</Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {record.zoneId}</span>
                              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatWhen(record.timestamp)}</span>
                              {!isWater && record.dosage && <span>{record.dosage}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          {typeof record.estimatedLitres === "number" && (
                            <p className="text-lg font-black text-slate-900">≈{record.estimatedLitres.toFixed(1)} L</p>
                          )}
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{isWater ? "Water · est." : "Chemical · est."}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="py-12 text-center text-slate-400">
                  <Sprout className="mx-auto mb-4 h-12 w-12 opacity-20" />
                  No pump activity recorded yet.
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Grid map + status */}
            <div className="space-y-6 lg:col-span-2">
              <Card className="overflow-hidden border-slate-200 shadow-md">
                <CardHeader className="border-b border-slate-100 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle>Farm grid map (12 zones)</CardTitle>
                    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Healthy</span>
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Warning</span>
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-400" /> Infected</span>
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-blue-500" /> Pump pilot</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="bg-slate-50/50 p-6">
                  <div className="mx-auto grid max-w-3xl grid-cols-3 gap-3 sm:grid-cols-6">
                    {zones.map(zone => {
                      const isSelected = zone.id === selectedZoneId
                      const isPilot = (DEMO_CONTROL_ZONE_IDS as readonly string[]).includes(zone.id)
                      const hasDisease = zone.activeDetection && zone.disease
                      const tone = zone.cropReview
                        ? "bg-violet-50 border-violet-300 text-violet-800"
                        : zone.status === "critical"
                          ? "bg-red-100 border-red-300 text-red-800"
                          : zone.status === "warning"
                            ? "bg-amber-100 border-amber-300 text-amber-800"
                            : "bg-emerald-50 border-emerald-200 text-emerald-800"
                      return (
                        <button
                          key={zone.id}
                          onClick={() => setSelectedZoneId(zone.id)}
                          className={`relative flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border p-2 transition-all ${tone} ${isSelected ? "z-10 scale-[1.04] ring-4 ring-blue-500/40" : "hover:scale-[1.02]"} ${isPilot ? "border-blue-400" : ""}`}
                        >
                          <span className="text-base font-black">{zone.id}</span>
                          {hasDisease && <span className="rounded-full border border-red-200 bg-white/70 px-1.5 text-[9px] font-bold uppercase text-red-600">{zone.severityLevel || "active"}</span>}
                          {zone.cropReview && <span className="rounded-full border border-violet-200 bg-white/70 px-1.5 text-[9px] font-bold uppercase text-violet-700">review</span>}
                          {isPilot && !hasDisease && !zone.cropReview && <span className="text-[8px] font-bold uppercase text-blue-600">pilot</span>}
                          {isSelected && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">✓</span>}
                        </button>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Status alert */}
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                {activeZones.length > 0 ? (
                  <>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><AlertCircle className="h-6 w-6" /></div>
                    <div>
                      <h4 className="font-bold text-slate-900">{activeZones.length} zone{activeZones.length === 1 ? "" : "s"} need treatment</h4>
                      <p className="text-sm text-slate-500">Active detections in {activeZoneList}. Select a zone to review its AI treatment plan.</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><Sprout className="h-6 w-6" /></div>
                    <div>
                      <h4 className="font-bold text-slate-900">No active disease detections</h4>
                      <p className="text-sm text-slate-500">Scan a leaf on the Detection page to generate a treatment plan here.</p>
                    </div>
                  </>
                )}
              </div>

              {/* Recommended treatment — uses the wide left space so the
                  product and dosage read cleanly instead of wrapping in the
                  narrow sidebar. */}
              {selectedZone?.activeDetection && selectedZone.disease && !selectedZone.cropReview && selectedRecommendation?.chemical && (
                <Card className="border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-emerald-600" /> Recommended treatment · Zone {selectedZoneId}</CardTitle>
                    <CardDescription>Offline advisory for {titleCase(selectedZone.canonicalDisease || selectedZone.disease)}. A suggestion — confirm the locally registered label before mixing.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Suggested product</p>
                        <p className="mt-1 text-lg font-black leading-snug text-slate-900">{selectedRecommendation.chemical}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Label dosage</p>
                        <p className="mt-1 text-base font-semibold leading-snug text-slate-800">{selectedRecommendation.dosage || "Use the dose printed on the registered product label."}</p>
                      </div>
                    </div>
                    {selectedRecommendation.timing && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-900">
                        <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                        <span><strong>Timing:</strong> {selectedRecommendation.timing}</span>
                      </div>
                    )}
                    {selectedRecommendation.reasoning && selectedRecommendation.reasoning.length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Why this recommendation</p>
                        <ul className="mt-2 space-y-1.5">
                          {selectedRecommendation.reasoning.map((line, index) => (
                            <li key={index} className="flex items-start gap-2 text-sm text-slate-600"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-xs text-slate-500">Enter your verified tank details in the panel on the right, then queue the application once conditions are safe.</p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Treatment specs sidebar */}
            <div className="space-y-6">
              <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Zone {selectedZoneId}</CardTitle>
                    <Badge variant={statusTone as any} className="capitalize">{selectedZone?.status || "loading"}</Badge>
                  </div>
                  <CardDescription>Soil moisture {selectedZone ? `${Math.round(selectedZone.soilMoisture)}%` : "…"} · {inPilotControlArea ? "A1–A4 pump pilot" : "planning only (no pump)"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Diagnosis / treatment specs */}
                  {selectedZone?.cropReview ? (
                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm">
                      <p className="font-bold text-violet-900">Crop confirmation required</p>
                      <p className="mt-1 text-violet-800">This scan&apos;s crop and the model&apos;s crop family disagree. Rescan a clear leaf before any chemical plan — no treatment is offered.</p>
                    </div>
                  ) : selectedZone?.activeDetection && selectedZone.disease ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Diagnosis</p>
                        <p className="mt-1 text-lg font-black text-slate-900">{titleCase(selectedZone.canonicalDisease || selectedZone.disease)}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedZone.severityLevel && <Badge variant={statusTone as any} className="capitalize">{selectedZone.severityLevel} severity</Badge>}
                          {typeof selectedZone.mlConfidence === "number" && <Badge variant="outline">{Math.round(selectedZone.mlConfidence * 100)}% confidence</Badge>}
                        </div>
                      </div>
                      {selectedRecommendation?.chemical ? (
                        <div className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs text-emerald-900">
                          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>Full treatment plan &amp; dosage shown in the <strong>Recommended treatment</strong> card. Enter your verified tank details below to queue it.</span>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">No offline product match — enter a crop-valid product from the label below.</p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-center text-sm text-slate-400">
                      <AlertCircle className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      No active disease in this zone. You can still run a water-only pump test.
                    </div>
                  )}

                  {/* Mode toggle */}
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <Switch id="water-mode" checked={waterValidation} onCheckedChange={setWaterValidation} />
                    <Label htmlFor="water-mode" className="text-sm font-semibold text-slate-800">{waterValidation ? "Water-only pump test" : "Chemical application"}</Label>
                  </div>

                  {waterValidation ? (
                    <div className="rounded-lg border border-sky-100 bg-sky-50/70 p-3">
                      <p className="text-sm font-bold text-sky-900">
                        {FLOW_CALIBRATED ? <>Delivers ≈{estimatePulseLitres(1)?.toFixed(1)} L</> : "Volume: calibration pending"}
                        <span className="ml-1 text-xs font-normal text-sky-700">per 3-second pulse</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-500">Proves the pump actuates. No chemical, no dose claimed. Volume is estimated from the base-pump flow rate, not metered.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2 space-y-1"><Label className="text-xs">Product / active ingredient</Label><Input value={productName} onChange={event => setProductName(event.target.value)} placeholder="Exact label product" /></div>
                        <div className="space-y-1"><Label className="text-xs">Label rate</Label><Input value={labelRate} onChange={event => setLabelRate(event.target.value)} inputMode="decimal" placeholder="from label" /></div>
                        <div className="space-y-1"><Label className="text-xs">Rate unit</Label>
                          <Select value={rateUnit} onValueChange={(value: "g/L" | "ml/L") => setRateUnit(value)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="g/L">g per L</SelectItem><SelectItem value="ml/L">ml per L</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1"><Label className="text-xs">Carrier water (L)</Label><Input value={carrierWater} onChange={event => setCarrierWater(event.target.value)} inputMode="decimal" placeholder="e.g. 5" /></div>
                        <div className="space-y-1"><Label className="text-xs">Tank capacity (L)</Label><Input value={tankCapacity} onChange={event => setTankCapacity(event.target.value)} inputMode="decimal" placeholder="e.g. 5" /></div>
                        <div className="space-y-1"><Label className="text-xs">PHI (days)</Label><Input value={preHarvestDays} onChange={event => setPreHarvestDays(event.target.value)} inputMode="decimal" placeholder="from label" /></div>
                        <div className="space-y-1"><Label className="text-xs">Cost ₹ (optional)</Label><Input value={productCostInr} onChange={event => setProductCostInr(event.target.value)} inputMode="decimal" placeholder="optional" /></div>
                        <div className="space-y-1"><Label className="text-xs">Water pH (optional)</Label><Input value={waterPh} onChange={event => setWaterPh(event.target.value)} inputMode="decimal" placeholder="optional" /></div>
                      </div>
                      <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
                        {hasVerifiedMix ? (
                          <><strong>Tank recipe:</strong> mix {productAmount.toFixed(1)} {productUnit} into {waterLiters.toFixed(1)} L water. {tankLoads > 1 ? `${tankLoads} tanks · ${productPerTank.toFixed(1)} ${productUnit}/tank.` : "One tank load."} PHI {preHarvestDays} day{Number(preHarvestDays) === 1 ? "" : "s"}.</>
                        ) : (
                          <><strong>Tank recipe:</strong> enter product, a non-zero rate, carrier water, tank capacity and PHI to compute the mix. No dose is invented.</>
                        )}
                      </div>
                      <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-white p-3">
                        <Switch id="tank-ok" checked={tankPrepared} onCheckedChange={setTankPrepared} />
                        <Label htmlFor="tank-ok" className="text-xs leading-snug">I confirm the tank is already mixed to the verified label rate.</Label>
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={sendPumpCommand}
                    disabled={sending || !inPilotControlArea || (!waterValidation && (!hasVerifiedMix || !tankPrepared || !weatherAllowsApplication))}
                    className={`w-full ${waterValidation ? "bg-blue-600 hover:bg-blue-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
                  >
                    {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : waterValidation ? <Droplets className="mr-2 h-4 w-4" /> : <Zap className="mr-2 h-4 w-4" />}
                    {!inPilotControlArea ? "Select A1–A4 to control the pump" : waterValidation ? "Run water-pump test" : weatherAllowsApplication ? "Queue confirmed application" : "Weather hold — cannot queue"}
                  </Button>
                  <p className="text-center text-[10px] text-slate-400">One command = one physical 3-second pulse. Volume is estimated (conservative) from the base-pump rated flow — add a flow sensor to meter it exactly.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
