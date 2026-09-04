"use client"

import { useState, useEffect, useCallback } from "react"
import { useFarmStore } from "@/store/farmStore"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import SprayWindowTimeline from "@/components/spray-window-timeline"
import {
  Brain,
  Lightbulb,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp,
  Droplets,
  MapPin,
  CloudRain,
  Wind,
  Target,
  Zap,
  X,
  Check,
  Loader2,
  RefreshCw,
  Bug,
  Gauge,
} from "lucide-react"

interface ApiRec {
  id: string
  kind: "treatment" | "irrigation" | "preventive"
  severity: "low" | "moderate" | "high"
  priority: "high" | "medium" | "low"
  type: "urgent" | "important" | "suggestion" | "optimization"
  zone: string
  title: string
  description: string
  confidence: number
  confidenceBasis: string
  action: string
  timing: string
  estimatedImpact: string
  reasoning: string[]
  weatherGated: boolean
  decisionAction: string
  detectionId?: string
  chemical?: string
  dosage?: string
  disease?: string
  spreadLeverage?: number
  scannedAt?: string
}

interface Insights {
  activeCount: number
  treatedCount: number
  resolvedCount: number
  totalDetections: number
  totalSprays: number
  avgDetectionConfidence: number | null
  containmentRate: number | null
  weatherAwareDecisions: number
}

interface Ctx {
  weatherSource: "live" | "cached" | "fallback"
  weatherUsable: boolean
  fungalPressure: { score: number; band: "low" | "moderate" | "high"; drivers: string[] }
  sprayWindow: { safeNow: boolean; nextSafeInHours: number | null; reason: string }
  climateLive: boolean
  climateLastValidAt?: number | null
  weatherFetchedAt?: string | null
  location: string
  locationConfigured: boolean
}

interface RecommendationPayload {
  generatedAt?: string
  recommendations: ApiRec[]
  insights: Insights
  context: Ctx
}

interface SavedRecommendationPayload {
  savedAt: string
  data: RecommendationPayload
}

const RECOMMENDATIONS_CACHE_KEY = "bhoomitra:last-recommendation-plan"
const RECOMMENDATIONS_TIMEOUT_MS = 5_000

function readSavedPlan(): SavedRecommendationPayload | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.sessionStorage.getItem(RECOMMENDATIONS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedRecommendationPayload
    return parsed?.data?.recommendations ? parsed : null
  } catch {
    return null
  }
}

function savePlan(data: RecommendationPayload) {
  if (typeof window === "undefined") return
  const payload: SavedRecommendationPayload = { savedAt: new Date().toISOString(), data }
  window.sessionStorage.setItem(RECOMMENDATIONS_CACHE_KEY, JSON.stringify(payload))
}

const typeColor = (type: string) =>
  type === "urgent"
    ? "text-red-600 bg-red-50"
    : type === "important"
      ? "text-orange-600 bg-orange-50"
      : type === "optimization"
        ? "text-blue-600 bg-blue-50"
        : "text-green-600 bg-green-50"

const typeIcon = (type: string) =>
  type === "urgent" ? (
    <AlertTriangle className="h-4 w-4" />
  ) : type === "important" ? (
    <Clock className="h-4 w-4" />
  ) : type === "optimization" ? (
    <TrendingUp className="h-4 w-4" />
  ) : (
    <Lightbulb className="h-4 w-4" />
  )

const priorityVariant = (p: string) => (p === "high" ? "destructive" : p === "medium" ? "secondary" : "outline")

function formatScanTime(iso?: string) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })
}

export default function Recommendations() {
  const { implementedRecords, addImplementationRecord, clearImplementationRecords } = useFarmStore()
  // sessionStorage is only readable after mount — reading it in a lazy
  // useState initializer would make the client's first hydration render
  // diverge from the server's (server always sees no cache), which triggers
  // a hydration mismatch. So these all start deterministically empty and are
  // populated from the cache in the mount effect below.
  const [data, setData] = useState<RecommendationPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadNotice, setLoadNotice] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [implementing, setImplementing] = useState<string | null>(null)
  const [selectedRec, setSelectedRec] = useState<ApiRec | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), RECOMMENDATIONS_TIMEOUT_MS)
    try {
      const res = await fetch("/api/recommendations", { signal: controller.signal })
      if (!res.ok) throw new Error("Recommendation request failed")
      const d = (await res.json()) as RecommendationPayload
      if (!Array.isArray(d.recommendations)) throw new Error("Recommendation response is incomplete")
      setData(d)
      savePlan(d)
      const saved = new Date().toISOString()
      setSavedAt(saved)
      setLoadNotice(null)
    } catch {
      const saved = readSavedPlan()
      if (saved) {
        setData(saved.data)
        setSavedAt(saved.savedAt)
        setLoadNotice("Showing the latest saved farm plan while weather updates. Spray actions stay weather-checked.")
      } else {
        setLoadNotice("Preparing the first saved farm plan. You can retry the update now.")
      }
      if (isRefresh) toast.info("Keeping the latest saved plan while the update retries")
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const saved = readSavedPlan()
    if (saved) {
      setData(saved.data)
      setSavedAt(saved.savedAt)
      setLoadNotice(`Showing the latest saved farm plan from ${new Date(saved.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`)
      setLoading(false)
    }
    load()
  }, [load])

  const recommendations = data?.recommendations || []
  const insights = data?.insights
  const context = data?.context

  const urgent = recommendations.filter((r) => r.type === "urgent")
  const urgentCount = urgent.length
  const importantCount = recommendations.filter((r) => r.type === "important").length
  const priorityTreatment = recommendations.find((recommendation) => recommendation.kind === "treatment")

  const implement = async (rec: ApiRec) => {
    if (rec.kind === "treatment") {
      window.location.assign(`/dashboard/autospray?zone=${encodeURIComponent(rec.zone)}&detection=${encodeURIComponent(rec.detectionId || "")}`)
      return
    }
    if (rec.kind !== "irrigation") {
      setSelectedRec(rec)
      setIsDetailsOpen(true)
      return
    }
    setImplementing(rec.id)
    try {
      const res = await fetch("/api/hydrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId: rec.zone }),
      })

      const result = await res.json().catch(() => ({}))

      if (res.ok) {
        addImplementationRecord({
          id: rec.id,
          title: rec.title,
          description: rec.action,
          timestamp: new Date().toISOString(),
          zone: rec.zone,
          impact: rec.estimatedImpact,
        })
        toast.success(`Water pulse queued for ${rec.zone}`)
        setIsDetailsOpen(false)
        await load(true)
      } else if (res.status === 409) {
        // The decision engine held the action — surface the honest reason.
        const reason = result?.decision?.spray?.reason || result?.decision?.irrigation?.reason || result?.message
        toast.warning("Held by the decision engine", { description: reason || "Conditions are not suitable yet." })
      } else if (res.status === 423) {
        toast.error("Safety kill switch is engaged")
      } else {
        toast.error(result?.message || "Action could not be completed")
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setImplementing(null)
    }
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="flex items-center gap-3 text-3xl font-black text-[#1a2e1d]">
                <Brain className="h-8 w-8 text-green-600" />
                Farm action plan
              </h1>
              <p className="mt-1 text-muted-foreground">Checking field observations, the latest farm-station reading, and local weather.</p>
            </div>
            <Loader2 className="h-6 w-6 animate-spin text-green-600" />
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((index) => (
              <div key={index} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
                <div className="h-5 w-2/3 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-slate-100" />
                <div className="h-10 w-36 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
          {loadNotice && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <span>{loadNotice}</span>
              <Button variant="outline" className="border-amber-300 bg-white" onClick={() => load(true)} disabled={refreshing}>
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                Retry update
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading && false) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        <p className="animate-pulse text-muted-foreground">Fusing detections, sensors, and forecast…</p>
      </div>
    )
  }

  const pressureTone =
    context?.fungalPressure.band === "high"
      ? "text-red-600"
      : context?.fungalPressure.band === "moderate"
        ? "text-amber-600"
        : "text-green-600"

  const renderCard = (rec: ApiRec) => {
    const actionBlocked = rec.kind === "irrigation" && rec.weatherGated
    const actionLabel = rec.kind === "treatment"
        ? rec.weatherGated ? "Review spray safety" : "Open spray plan"
        : rec.kind === "irrigation"
          ? actionBlocked ? "Weather hold" : "Queue water pulse"
          : "Review response"

    return (
    <Card key={rec.id} className="relative shadow-sm transition-all duration-300 hover:shadow-md">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`rounded-lg p-2 ${typeColor(rec.type)}`}>{typeIcon(rec.type)}</div>
            <div className="flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg text-[#1a2e1d]">{rec.title}</CardTitle>
                <Badge variant={priorityVariant(rec.priority) as any} className="capitalize">
                  {rec.priority}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  <MapPin className="mr-1 h-3 w-3" />
                  {rec.zone}
                </Badge>
                {rec.weatherGated && (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-xs text-amber-700">
                    <CloudRain className="mr-1 h-3 w-3" />
                    Weather hold
                  </Badge>
                )}
              </div>
              <CardDescription className="text-base text-slate-600">{rec.description}</CardDescription>
              {rec.scannedAt && formatScanTime(rec.scannedAt) && (
                <p className="mt-1 text-xs text-muted-foreground">Scanned {formatScanTime(rec.scannedAt)}</p>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{rec.confidenceBasis}</span>
              <span className="font-medium">{rec.confidence}%</span>
            </div>
            <Progress value={rec.confidence} className="h-2" />
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Recommended timing</p>
            <p className="text-sm font-medium text-slate-800">{rec.timing}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Estimated impact</p>
            <p className="text-sm font-medium text-slate-800">{rec.estimatedImpact}</p>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Brain className="h-4 w-4 text-green-600" />
            Why this recommendation
          </h4>
          <ul className="space-y-1.5">
            {rec.reasoning.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-green-100 bg-green-50/60 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-green-700">Action</p>
          <p className="mt-0.5 text-sm font-semibold text-[#1a2e1d]">{rec.action}</p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={() => implement(rec)}
            disabled={implementing === rec.id || actionBlocked}
            className="bg-[#3a7d44] text-white hover:bg-[#2e6336]"
          >
            {implementing === rec.id ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : rec.kind === "treatment" ? (
              <Zap className="mr-2 h-4 w-4" />
            ) : (
              <Droplets className="mr-2 h-4 w-4" />
            )}
            {actionLabel}
          </Button>
          <Button
            variant="outline"
            className="bg-transparent"
            onClick={() => {
              setSelectedRec(rec)
              setIsDetailsOpen(true)
            }}
          >
            Details
          </Button>
        </div>
      </CardContent>
    </Card>
    )
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-black text-[#1a2e1d]">
              <Brain className="h-8 w-8 text-green-600" />
              AI Recommendations
            </h1>
            <p className="mt-1 text-muted-foreground">
              A prioritized farm plan built from field observations, the latest station reading, and local weather.
            </p>
          </div>
          <Button variant="outline" onClick={() => load(true)} disabled={refreshing} className="bg-transparent">
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Prescriptive AI: when to act — the 48h spray-window timeline */}
        <SprayWindowTimeline />

        {/* Fusion context strip — makes the "why" visible and honest */}
        {loadNotice && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span>{loadNotice}</span>
            <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Retry update
            </Button>
          </div>
        )}

        {context && (
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-green-100 bg-white p-4 shadow-sm md:grid-cols-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-green-700">Weather feed</p>
              <p className="mt-0.5 text-sm font-bold capitalize text-[#1a2e1d]">
                {context.weatherSource}
                {!context.weatherUsable && <span className="ml-1 text-xs font-normal text-amber-600">(advisory)</span>}
              </p>
              <p className="truncate text-xs text-slate-400">{context.location}</p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
                <Bug className="h-3 w-3" /> Disease pressure
              </p>
              <p className={`mt-0.5 text-sm font-bold capitalize ${pressureTone}`}>
                {context.fungalPressure.band} ({context.fungalPressure.score})
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
                <Wind className="h-3 w-3" /> Spray window
              </p>
              <p className="mt-0.5 text-sm font-bold text-[#1a2e1d]">
                {context.sprayWindow.safeNow
                  ? "Open now"
                  : context.sprayWindow.nextSafeInHours != null
                    ? `~${context.sprayWindow.nextSafeInHours}h`
                    : "Closed"}
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
                <Gauge className="h-3 w-3" /> Farm sensor reference
              </p>
              <p className="mt-0.5 text-sm font-bold text-[#1a2e1d]">{context.climateLive ? "Live now" : "Latest saved reading"}</p>
            </div>
          </div>
        )}

        {priorityTreatment && (
          <Card className="overflow-hidden border-emerald-200 bg-gradient-to-r from-emerald-950 via-[#245f31] to-[#3a7d44] text-white shadow-lg">
            <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">Top containment priority · model projection</p>
                <h2 className="mt-1 text-2xl font-black">{priorityTreatment.title}</h2>
                <p className="mt-1 max-w-3xl text-sm text-emerald-50">{priorityTreatment.action}</p>
                {priorityTreatment.spreadLeverage != null && priorityTreatment.spreadLeverage > 0 && (
                  <p className="mt-2 text-xs font-semibold text-emerald-100">Containing this zone carries ~{priorityTreatment.spreadLeverage.toFixed(1)} projected secondary-infection leverage over the next five days.</p>
                )}
              </div>
              <Button
                className="bg-white text-[#1f582b] hover:bg-emerald-50"
                onClick={() => implement(priorityTreatment)}
              >
                <Zap className="mr-2 h-4 w-4" />
                {priorityTreatment.weatherGated ? "Review spray safety" : "Open spray plan"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Summary cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Recommendations</CardTitle>
              <Brain className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{recommendations.length}</div>
              <p className="text-xs text-muted-foreground">Pending actions</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Urgent Actions</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{urgentCount}</div>
              <p className="text-xs text-muted-foreground">Require immediate attention</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Weather-aware</CardTitle>
              <CloudRain className="h-4 w-4 text-sky-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-sky-700">{insights?.weatherAwareDecisions ?? 0}</div>
              <p className="text-xs text-muted-foreground">Held or timed by forecast</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg diagnosis confidence</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#3a7d44]">
                {insights?.avgDetectionConfidence != null ? `${insights.avgDetectionConfidence}%` : "No scan yet"}
              </div>
              <p className="text-xs text-muted-foreground">Across recorded detections</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="active" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="active">Active ({recommendations.length})</TabsTrigger>
            <TabsTrigger value="urgent">Urgent ({urgentCount})</TabsTrigger>
            <TabsTrigger value="implemented">Implemented ({implementedRecords.length})</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-4">
            {recommendations.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
                <CheckCircle className="mb-4 h-12 w-12 text-green-300" />
                <h3 className="text-lg font-medium text-slate-900">All caught up</h3>
                <p className="max-w-xs text-sm text-slate-500">
                  No active disease detections or irrigation needs right now. New scans and sensor readings appear here automatically.
                </p>
              </div>
            ) : (
              recommendations.map(renderCard)
            )}
          </TabsContent>

          <TabsContent value="urgent" className="space-y-4">
            {urgent.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
                <CheckCircle className="mb-4 h-12 w-12 text-green-300" />
                <h3 className="text-lg font-medium text-slate-900">No urgent actions</h3>
              </div>
            ) : (
              urgent.map(renderCard)
            )}
          </TabsContent>

          <TabsContent value="implemented" className="space-y-4">
            {implementedRecords.length > 0 && (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-400 hover:text-red-500"
                  onClick={() => {
                    clearImplementationRecords()
                    toast.success("Implementation history cleared")
                  }}
                >
                  Clear history
                </Button>
              </div>
            )}
            {implementedRecords.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
                <CheckCircle className="mb-4 h-12 w-12 text-slate-300" />
                <h3 className="text-lg font-medium text-slate-900">No actions implemented yet</h3>
                <p className="max-w-xs text-sm text-slate-500">
                  When you dispatch a spray or start irrigation from a recommendation, it is logged here.
                </p>
              </div>
            ) : (
              implementedRecords.map((rec) => (
                <Card key={rec.id} className="border-slate-200 bg-slate-50">
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-green-50 p-2 text-green-600">
                        <CheckCircle className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-lg">{rec.title}</CardTitle>
                            <Badge variant="outline" className="border-green-600 text-green-600">
                              Done
                            </Badge>
                          </div>
                          <span className="text-xs text-slate-400">
                            {new Date(rec.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <CardDescription>{rec.description}</CardDescription>
                        {rec.zone && (
                          <div className="mt-2 flex items-center gap-2">
                            <Badge variant="secondary">Zone {rec.zone}</Badge>
                            <span className="text-xs text-muted-foreground">Impact: {rec.impact}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="insights" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-green-600" />
                  Operational Metrics
                </CardTitle>
                <CardDescription>
                  Tallied from your real detection and spray history — not estimated accuracy figures.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Active detections</p>
                    <p className="mt-1 text-2xl font-black text-red-600">{insights?.activeCount ?? 0}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Treated</p>
                    <p className="mt-1 text-2xl font-black text-green-600">{insights?.treatedCount ?? 0}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Containment rate</p>
                    <p className="mt-1 text-2xl font-black text-[#1a2e1d]">
                      {insights?.containmentRate != null ? `${insights.containmentRate}%` : "No outcome yet"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Total sprays</p>
                    <p className="mt-1 text-2xl font-black text-[#1a2e1d]">{insights?.totalSprays ?? 0}</p>
                  </div>
                </div>

                {context && (
                  <div className="rounded-xl border border-green-100 bg-green-50/50 p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-green-800">
                      <CloudRain className="h-4 w-4" /> Current environmental context
                    </h4>
                    <div className="grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-slate-500">Disease pressure</p>
                        <p className={`font-bold capitalize ${pressureTone}`}>
                          {context.fungalPressure.band} ({context.fungalPressure.score}/100)
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Spray window</p>
                        <p className="font-bold text-[#1a2e1d]">
                          {context.sprayWindow.safeNow ? "Open now" : context.sprayWindow.reason}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Weather-aware decisions</p>
                        <p className="font-bold text-[#1a2e1d]">{insights?.weatherAwareDecisions ?? 0}</p>
                      </div>
                    </div>
                    {context.fungalPressure.drivers.length > 0 && (
                      <p className="mt-3 text-xs text-slate-500">
                        Drivers: {context.fungalPressure.drivers.join(" · ")}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Details dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedRec && (
            <>
              <DialogHeader>
                <div className="mb-2 flex items-center gap-2">
                  <div className={`rounded-lg p-2 ${typeColor(selectedRec.type)}`}>{typeIcon(selectedRec.type)}</div>
                  <Badge variant={priorityVariant(selectedRec.priority) as any} className="capitalize">
                    {selectedRec.priority} priority
                  </Badge>
                  <Badge variant="secondary">Zone {selectedRec.zone}</Badge>
                  {selectedRec.weatherGated && (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                      Weather hold
                    </Badge>
                  )}
                </div>
                <DialogTitle className="text-2xl">{selectedRec.title}</DialogTitle>
                <DialogDescription className="pt-2 text-base">{selectedRec.description}</DialogDescription>
                {selectedRec.scannedAt && formatScanTime(selectedRec.scannedAt) && (
                  <p className="text-xs text-muted-foreground">Scanned {formatScanTime(selectedRec.scannedAt)}</p>
                )}
              </DialogHeader>

              <div className="grid gap-6 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Target className="h-4 w-4" /> {selectedRec.confidenceBasis}
                    </p>
                    <p className="text-lg font-bold text-[#3a7d44]">{selectedRec.confidence}%</p>
                    <Progress value={selectedRec.confidence} className="h-1.5" />
                  </div>
                  <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4" /> Timing
                    </p>
                    <p className="text-lg font-bold text-slate-800">{selectedRec.timing}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="flex items-center gap-2 font-semibold">
                    <Brain className="h-4 w-4 text-green-600" /> How this was decided
                  </h4>
                  <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4">
                    {selectedRec.reasoning.map((line, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm text-slate-700">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700">
                          {i + 1}
                        </div>
                        <p>{line}</p>
                      </div>
                    ))}
                    <p className="pt-1 text-xs italic text-slate-400">
                      Fused through the same decision engine that gates the irrigation and spray hardware, so the advice and the action always agree.
                    </p>
                  </div>
                </div>
              </div>

              <DialogFooter className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Zap className="h-3 w-3" />
                  {selectedRec.action}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
                    Close
                  </Button>
                  {/* Crop-review and cultural-guidance cards have no queueable
                      action here — the real next step (rescan, structural
                      management) happens outside this dialog, so only
                      treatment/irrigation kinds get a second button. */}
                  {(selectedRec.kind === "treatment" || selectedRec.kind === "irrigation") && (
                    <Button
                      onClick={() => implement(selectedRec)}
                      disabled={implementing === selectedRec.id || (selectedRec.kind === "irrigation" && selectedRec.weatherGated)}
                      className="bg-[#3a7d44] hover:bg-[#2e6336]"
                    >
                      {implementing === selectedRec.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-2 h-4 w-4" />
                      )}
                      {selectedRec.kind === "irrigation"
                        ? selectedRec.weatherGated ? "Weather hold" : "Queue water pulse"
                        : "Open spray plan"}
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
