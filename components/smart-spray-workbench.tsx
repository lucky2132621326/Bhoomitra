"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, CloudRain, Droplets, FlaskConical, History, MapPin, RefreshCw, Sprout, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

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
  const [weather, setWeather] = useState<WeatherContext | null>(null)
  const [sprays, setSprays] = useState<SprayRecord[]>([])
  const [selectedZoneId, setSelectedZoneId] = useState("A1")
  const [showHistory, setShowHistory] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const [zoneRes, recRes, sprayRes] = await Promise.all([
        fetch("/api/zones"),
        fetch("/api/recommendations"),
        fetch("/api/spray"),
      ])
      const zonePayload = await zoneRes.json()
      const recommendationPayload = recRes.ok ? await recRes.json() : { recommendations: [] }
      const sprayPayload = sprayRes.ok ? await sprayRes.json() : []

      const nextZones = Array.isArray(zonePayload) ? zonePayload : zonePayload.zones || []
      setZones(nextZones)
      setRecommendations(recommendationPayload.recommendations || [])
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

  const activeZones = zones.filter(zone => zone.activeDetection && zone.disease)
  const activeZoneList = activeZones.map(zone => zone.id).join(", ") || "—"

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
            <p className="text-slate-500">Select an infected zone and review its AI treatment and weather guidance.</p>
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
              <CardDescription>Previously recorded treatment activity.</CardDescription>
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
                              <span className="font-semibold text-slate-800">{isWater ? "Legacy water test" : record.chemical || "Treatment record"}</span>
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
          <>
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
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="bg-slate-50/50 p-6">
                  <div className="mx-auto grid max-w-3xl grid-cols-3 gap-3 sm:grid-cols-6">
                    {zones.map(zone => {
                      const isSelected = zone.id === selectedZoneId
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
                          className={`relative flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border p-2 transition-all ${tone} ${isSelected ? "z-10 scale-[1.04] ring-4 ring-blue-500/40" : "hover:scale-[1.02]"}`}
                        >
                          <span className="text-base font-black">{zone.id}</span>
                          {hasDisease && <span className="rounded-full border border-red-200 bg-white/70 px-1.5 text-[9px] font-bold uppercase text-red-600">{zone.severityLevel || "active"}</span>}
                          {zone.cropReview && <span className="rounded-full border border-violet-200 bg-white/70 px-1.5 text-[9px] font-bold uppercase text-violet-700">review</span>}
                          {isSelected && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">✓</span>}
                        </button>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

            </div>
            <div className="flex h-full flex-col justify-center rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:row-span-2">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><FlaskConical className="h-6 w-6" /></div>
                <div><h4 className="font-bold text-slate-900">Zone {selectedZoneId} treatment</h4><p className="text-sm text-slate-500">Selected zone summary</p></div>
              </div>
              {selectedZone?.activeDetection && selectedZone.disease ? (
                <>
                  <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Detected condition</p>
                    <p className="mt-1 font-bold text-slate-900">{titleCase(selectedZone.canonicalDisease || selectedZone.disease)}</p>
                    <p className="mt-1 text-sm text-slate-600">{selectedZone.severityLevel ? `${selectedZone.severityLevel} severity` : "Severity assessment pending"}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Soil moisture</p><p className="mt-1 font-bold text-slate-900">{Math.round(selectedZone.soilMoisture)}%</p></div>
                    <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Treatment</p><p className="mt-1 font-bold text-slate-900">{selectedRecommendation?.chemical ? "Available" : "Review label"}</p></div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-slate-600">Review the recommended treatment below before taking manual action.</p>
                </>
              ) : (
                <p className="mt-4 text-sm leading-relaxed text-slate-500">No active disease detected in this zone. Scan a clear leaf to receive treatment guidance.</p>
              )}
            </div>
          {/* Farm-level treatment alert completes the left column while the
              Zone Treatment card spans both rows on the right. */}
            <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              {activeZones.length > 0 ? (
                <><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><AlertCircle className="h-6 w-6" /></div><div><h4 className="font-bold text-slate-900">{activeZones.length} zone{activeZones.length === 1 ? "" : "s"} need treatment</h4><p className="text-sm text-slate-500">Active detections in {activeZoneList}. Select a zone to review its AI treatment plan.</p></div></>
              ) : (
                <><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><Sprout className="h-6 w-6" /></div><div><h4 className="font-bold text-slate-900">No active disease detections</h4><p className="text-sm text-slate-500">Scan a leaf on the Detection page to generate a treatment plan here.</p></div></>
              )}
            </div>
          </div>

          {/* Treatment guidance spans the full content width. */}
          {selectedZone?.activeDetection && selectedZone.disease && !selectedZone.cropReview && selectedRecommendation?.chemical && (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="border-slate-200 shadow-sm lg:col-span-3">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-emerald-600" /> Recommended treatment · Zone {selectedZoneId}</CardTitle>
                  <CardDescription>Offline advisory for {titleCase(selectedZone.canonicalDisease || selectedZone.disease)}. A suggestion — confirm the locally registered label before mixing.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Suggested product</p><p className="mt-1 text-lg font-black leading-snug text-slate-900">{selectedRecommendation.chemical}</p></div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Label dosage</p><p className="mt-1 text-base font-semibold leading-snug text-slate-800">{selectedRecommendation.dosage || "Use the dose printed on the registered product label."}</p></div>
                  </div>
                  {selectedRecommendation.timing && <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-900"><Clock className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Timing:</strong> {selectedRecommendation.timing}</span></div>}
                  {selectedRecommendation.reasoning && selectedRecommendation.reasoning.length > 0 && <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Why this recommendation</p><ul className="mt-2 space-y-1.5">{selectedRecommendation.reasoning.map((line, index) => <li key={index} className="flex items-start gap-2 text-sm text-slate-600"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{line}</li>)}</ul></div>}
                  <p className="text-xs text-slate-500">Use this guidance with the registered product label for manual application.</p>
                </CardContent>
              </Card>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  )
}
