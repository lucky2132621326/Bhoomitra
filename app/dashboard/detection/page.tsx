"use client"

import { useEffect, useState } from "react"
import { diseaseKnowledge } from "@/app/data/diseaseKnowledge"
import { interpretDetection, toneColor } from "@/app/lib/diseaseLanguage"
import { TELANGANA_OFFLINE_NOTICE } from "@/app/data/telanganaPesticideCatalog"
import { toast } from "sonner"
import { useTranslation } from "@/lib/use-translation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Camera,
  Upload,
  Brain,
  ShieldCheck,
  AlertTriangle,
  Beaker,
  Info,
  ChevronRight,
  Sparkles,
  MapPin,
  Clock,
  FlaskConical,
  Leaf,
  Droplets,
  Zap,
  CheckCircle
} from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const FALLBACK_ZONE_IDS = ["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2", "B3", "B4", "B5", "B6"]
const SUPPORTED_SCAN_CROPS = ["Paddy", "Tomato", "Grape", "Apple", "Potato", "Maize", "Pepper", "Citrus"]

type ScanResult = {
  detectionId: string
  zoneId: string
  disease: string
  confidence: number
  severityLevel: "low" | "moderate" | "high"
  recommendation: any
  recommendationNotice: string
  timestamp: string
  scanCrop?: string
  modelCrop?: string
  cropMatch?: "matched" | "review" | "not_applicable"
}

export default function DetectionPage() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [zone, setZone] = useState("A1")
  const [zoneOptions, setZoneOptions] = useState(FALLBACK_ZONE_IDS)
  const t = useTranslation()
  const [scanCrop, setScanCrop] = useState("Paddy")
  const [farmCrop, setFarmCrop] = useState("Paddy")
  const [scanError, setScanError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    Promise.all([
      fetch("/api/zones").then((response) => response.json()),
      fetch("/api/farmer-profile").then((response) => response.json()),
    ])
      .then(([zoneResponse, profileResponse]) => {
        if (!active) return
        const zones = Array.isArray(zoneResponse) ? zoneResponse : zoneResponse?.zones
        const ids = Array.isArray(zones)
          ? zones.map((item: { id?: string }) => item.id).filter((id: unknown): id is string => typeof id === "string")
          : []
        if (ids.length > 0) setZoneOptions(ids)

        const profileCrop = profileResponse?.profile?.primaryCrop?.trim()
        if (profileCrop) {
          setFarmCrop(profileCrop)
          setScanCrop(profileCrop)
        }
      })
      .catch(() => {
        // The known 12-zone layout remains usable if a refresh is delayed.
      })

    return () => {
      active = false
    }
  }, [])

  const cropOptions = Array.from(new Set([farmCrop, ...SUPPORTED_SCAN_CROPS].filter(Boolean)))

  const handleUpload = async () => {
    if (!file) return

    // Captured now so the result stays pinned to the zone it was actually
    // scanned for, even if the farmer changes the zone dropdown afterward.
    const scanZoneId = zone

    const formData = new FormData()
    formData.append("zoneId", scanZoneId)
    formData.append("crop", scanCrop)
    formData.append("file", file)

    setLoading(true)
    setScanError(null)

    try {
      // ✅ CALL NEXT.JS BACKEND (NOT FLASK DIRECTLY)
      const response = await fetch("/api/hardwareDetect", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (response.ok && data.success) {
        const recommendation = data.recommendation || null
        setResult({
          detectionId: data.detection.id,
          zoneId: data.detection.zoneId || scanZoneId,
          disease: data.detection.disease,
          confidence: data.detection.confidence,
          severityLevel: data.detection.severityLevel,
          recommendation,
          recommendationNotice: data.recommendationNotice || TELANGANA_OFFLINE_NOTICE,
          timestamp: data.detection.timestamp,
          scanCrop: data.detection.scanCrop || scanCrop,
          modelCrop: data.detection.modelCrop,
          cropMatch: data.detection.cropMatch,
        })

        toast.success(t("detection.analysisComplete", { zone: scanZoneId }))
      } else {
        throw new Error(data?.error || t("detection.scanFailed"))
      }
    } catch (error) {
      console.error("Hardware detect error:", error)
      const message = error instanceof Error ? error.message : t("detection.scanFailed")
      setScanError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const formattedDisease = result?.disease
    ? result.disease.replace(/___/g, " - ").replace(/_/g, " ")
    : null

  const isHealthyResult = (result?.disease || "").toLowerCase().includes("healthy")
  const diseaseParts = result?.disease?.split("___") || []
  const detectedCrop = result?.scanCrop || (diseaseParts.length > 1 ? diseaseParts[0].replace(/_/g, " ") : "Sample")
  const detectedCondition = diseaseParts.length > 1 ? diseaseParts[1].replace(/_/g, " ") : formattedDisease || "Unknown"
  const requiresCropConfirmation = result?.cropMatch === "review"

  // Farmer-language reading: lead with the plain verdict; confidence is subtext.
  const detectionRead = result
    ? interpretDetection({
        disease: result.disease || detectedCondition,
        crop: detectedCrop,
        confidence: result.confidence,
        cropMatch: result.cropMatch,
        isHealthy: isHealthyResult,
      })
    : null

  const knowledge =
    result?.disease && diseaseKnowledge[result.disease]
      ? diseaseKnowledge[result.disease]
      : null

  const severity =
    result?.severityLevel
      ? result.severityLevel.charAt(0).toUpperCase() +
        result.severityLevel.slice(1)
      : null

  // Canonical severity values stay untouched; only the displayed label is localized.
  const severityKeyMap: Record<string, "detection.severity.high" | "detection.severity.moderate" | "detection.severity.low"> = {
    High: "detection.severity.high",
    Moderate: "detection.severity.moderate",
    Low: "detection.severity.low",
  }
  const severityLabel = severity ? t(severityKeyMap[severity] ?? "detection.severity.moderate") : null
  const severityWord = severity ? t(severityKeyMap[severity] ?? "detection.severity.moderate").toLowerCase() : t("detection.severityReview")
  const recommendation = result?.recommendation
  const recommendationName = recommendation
    ? `${recommendation.activeIngredient} ${recommendation.formulation || ""}`.trim()
    : null
  const isCulturalResponse = Boolean(
    recommendationName && /no curative|not applicable|no chemical/i.test(recommendationName),
  )
  const canOpenSprayPlan = Boolean(
    !isHealthyResult && recommendation && !requiresCropConfirmation && !isCulturalResponse,
  )
  const organicSuggestions = recommendation ? [recommendation.organicAlternative] : []

  return (
    <div className="min-h-screen space-y-8 animate-in fade-in duration-700">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-4xl font-extrabold text-[#1a2e1d] flex items-center gap-3">
            <Brain className="text-green-600 h-9 w-9" />
            {t("detection.pageTitle")}
          </h1>
          <p className="text-[#4a634f] mt-2 text-lg font-medium">
            {t("detection.pageSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl shadow-sm border border-green-100">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-sm font-bold text-green-800">{t("detection.modelReady")}</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Upload Card */}
        <Card className={`lg:col-span-4 border-green-100 shadow-xl rounded-[2.5rem] overflow-hidden ${result ? 'lg:sticky lg:top-8' : ''}`}>
          <CardHeader className="bg-green-50/50 pb-8">
            <CardTitle className="text-xl flex items-center gap-2">
              <Camera className="h-5 w-5 text-green-600" />
              {t("detection.sampleAnalysis")}
            </CardTitle>
            <CardDescription>{t("detection.sampleAnalysisDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-8">
            <div className="relative group border-2 border-dashed border-green-200 rounded-3xl max-h-[220px] md:max-h-none aspect-square flex flex-col items-center justify-center bg-green-50/20 hover:bg-green-50/40 transition-all overflow-hidden">
              {preview ? (
                <>
                  <img
                    src={preview}
                    alt={t("detection.previewAlt")}
                    className="object-cover w-full h-full"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button variant="secondary" size="sm" onClick={() => document.getElementById('leaf-upload')?.click()}>
                      {t("detection.changeImage")}
                    </Button>
                  </div>
                </>
              ) : (
                <div 
                  className="flex flex-col items-center cursor-pointer p-6 text-center"
                  onClick={() => document.getElementById('leaf-upload')?.click()}
                >
                  <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center text-green-600 mb-4">
                    <Upload className="h-8 w-8" />
                  </div>
                  <p className="text-sm font-bold text-green-800">{t("detection.uploadHint")}</p>
                  <p className="text-xs text-green-600/60 mt-2">{t("detection.uploadFormats")}</p>
                </div>
              )}
              <input
                id="leaf-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0]
                  if (selected) {
                    setFile(selected)
                    setPreview(URL.createObjectURL(selected))
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-green-600" />
                {t("detection.selectFarmZone")}
              </label>
              <Select value={zone} onValueChange={setZone}>
                <SelectTrigger className="rounded-xl border-green-100 h-12 text-base md:text-sm">
                  <SelectValue placeholder={t("detection.selectZonePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {zoneOptions.map(z => (
                    <SelectItem key={z} value={z}>{t("detection.zoneLabel", { zone: z })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <Leaf className="h-4 w-4 text-green-600" />
                {t("detection.cropInPhoto")}
              </label>
              <Select value={scanCrop} onValueChange={setScanCrop}>
                <SelectTrigger className="rounded-xl border-green-100 h-12 text-base md:text-sm">
                  <SelectValue placeholder={t("detection.selectCropPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {cropOptions.map((crop) => (
                    <SelectItem key={crop} value={crop}>{crop}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">{t("detection.registeredCropNote", { crop: farmCrop })}</p>
            </div>

            <Button
              onClick={handleUpload}
              disabled={!file || !scanCrop || loading}
              className="w-full h-14 rounded-2xl bg-green-600 hover:bg-green-700 text-lg font-bold shadow-lg shadow-green-200 transition-all active:scale-95"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  {t("detection.processing")}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  {t("detection.analyzeButton")}
                </div>
              )}
            </Button>
            {scanError && <p className="text-sm font-medium text-red-600">{scanError}</p>}
          </CardContent>
        </Card>

        {/* Results Section */}
        <div className="lg:col-span-8">
          {result ? (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
              <Card className="border-green-100 shadow-2xl rounded-[2.5rem] overflow-hidden">
                <div className={`h-2 w-full ${severity === "High" ? "bg-red-500" : severity === "Moderate" ? "bg-orange-500" : "bg-green-500"}`}></div>
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <Badge 
                      variant={severity === "High" ? "destructive" : severity === "Moderate" ? "warning" as any : "default"}
                      className="px-4 py-1 rounded-full uppercase tracking-widest font-black text-[10px]"
                    >
                      {severity === "High" ? t("detection.alertActionRequired") : severity === "Moderate" ? t("detection.monitoringRequired") : t("detection.systemNormal")}
                    </Badge>
                    <div
                      className="max-w-[17rem] break-all text-right text-xs font-bold text-slate-400"
                      title={result.detectionId || undefined}
                    >
                      {t("detection.scanRecord", { id: result.detectionId || "—" })}
                    </div>
                  </div>
                  <CardTitle className={`text-3xl font-black mt-4 capitalize leading-tight ${detectionRead ? toneColor[detectionRead.tone].text : "text-slate-800"}`}>
                    {detectionRead ? t(detectionRead.verdictCode, detectionRead.verdictParams) : detectedCondition}
                  </CardTitle>
                  <CardDescription className="text-base font-medium">
                    {t("detection.onCrop", { crop: detectedCrop })} · <span className="text-slate-400">{detectionRead ? t(detectionRead.confidenceCode, detectionRead.confidenceParams) : ""}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{t("detection.matchStrength")}</p>
                      <p className="mt-1 text-lg font-black capitalize text-slate-800">
                        {result.confidence >= 0.85 ? t("detection.strong") : result.confidence >= 0.65 ? t("detection.moderate") : t("detection.weak")}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Progress value={result.confidence * 100} className="h-1.5 flex-1 bg-slate-200" />
                        <span className="text-[11px] font-semibold text-slate-400">{(result.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{t("detection.severityLevel")}</p>
                      <p className={`text-2xl font-black mt-1 ${severity === "High" ? "text-red-600" : severity === "Moderate" ? "text-orange-600" : "text-green-600"}`}>
                        {isHealthyResult ? t("detection.healthy") : severityLabel}
                      </p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{t("detection.scanContext")}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <MapPin className="h-5 w-5 text-green-600" />
                        <div>
                          <p className="text-lg font-black text-slate-800">{detectedCrop}</p>
                          <p className="text-xs font-bold text-slate-500">{t("detection.zoneLabel", { zone: result.zoneId })}</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{t("detection.scannedAt")}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Clock className="h-5 w-5 text-green-600" />
                        <p className="text-sm font-black text-slate-800">{new Date(result.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                    </div>
                  </div>

                  {requiresCropConfirmation && (
                    <Card className="border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-bold text-amber-950">{t("detection.cropCheckRequired")}</p>
                      <p className="mt-1 text-sm text-amber-900">{t("detection.cropMismatchNote", { selected: result.scanCrop ?? "—", model: result.modelCrop ?? "—" })}</p>
                    </Card>
                  )}

                  <Separator className="bg-slate-100" />

                  <div className="space-y-6">
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                      <Beaker className="h-5 w-5 text-green-600" />
                      {t("detection.ipmProtocol")}
                    </h3>
                    
                    <div className="grid md:grid-cols-2 gap-6">
                      {/* Knowledge Base */}
                      <div className="space-y-4">
                        <div className="p-6 bg-green-50/50 rounded-3xl border border-green-100 h-full">
                          <h4 className="font-bold text-green-800 flex items-center gap-2 mb-3">
                            <Info className="h-4 w-4" />
                            {t("detection.diseaseInsight")}
                          </h4>
                          <div className="text-sm text-green-900/70 leading-relaxed italic">
                            {knowledge ? (
                              <div className="space-y-2">
                                <p><span className="font-bold">{t("detection.impact")}</span> {knowledge.scientificInsights.impact}</p>
                                <p><span className="font-bold">{t("detection.transmission")}</span> {knowledge.scientificInsights.transmission}</p>
                                <p><span className="font-bold">{t("detection.triggers")}</span> {knowledge.scientificInsights.environmentalTriggers}</p>
                              </div>
                            ) : (
                              isHealthyResult
                                ? t("detection.noDiseasePattern")
                                : t("detection.modelIdentified", { condition: detectedCondition, severity: severityWord })
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Pesticide Recommendation */}
                      <div className="space-y-4">
                        {requiresCropConfirmation ? (
                          <div className="flex h-full flex-col items-center justify-center rounded-[2rem] bg-amber-950 p-6 text-center text-white shadow-xl">
                            <AlertTriangle className="mb-4 h-10 w-10 text-amber-300" />
                            <p className="font-bold">{t("detection.cropConfirmationRequired")}</p>
                            <p className="mt-1 text-xs text-amber-100">{t("detection.cropConfirmationNote")}</p>
                          </div>
                        ) : recommendation ? (
                            <div className="p-6 bg-slate-900 text-white rounded-[2rem] shadow-xl relative overflow-hidden h-full">
                              <div className="absolute top-0 right-0 p-6 opacity-10">
                                <FlaskConical className="h-24 w-24" />
                              </div>
                              <h4 className="font-bold text-green-400 flex items-center gap-2 mb-4">
                                <ShieldCheck className="h-4 w-4" />
                                {isCulturalResponse ? t("detection.fieldResponsePlan") : t("detection.recommendedTreatment")}
                              </h4>
                              <p className="text-2xl font-black mb-1">{recommendationName}</p>
                              <Badge variant="outline" className="border-green-800 text-green-400 mb-6">{recommendation.category}</Badge>

                              {isCulturalResponse ? (
                                <div className="space-y-3 text-sm">
                                  <div className="rounded-xl border border-amber-300/30 bg-amber-100/10 p-3">
                                    <p className="font-bold text-amber-200">{t("detection.immediateFieldResponse")}</p>
                                    <p className="mt-1 text-slate-100">{recommendation.organicAlternative}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("detection.whyNoSpray")}</p>
                                    <p className="mt-1 text-slate-100">{recommendation.safetyNote}</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="grid grid-cols-2 gap-4 text-xs">
                                  <div className="space-y-1">
                                    <p className="text-slate-400 flex items-center gap-1"><Droplets className="h-3 w-3" /> {t("detection.labelRate")}</p>
                                    <p className="font-bold">{recommendation.dosage}</p>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-slate-400 flex items-center gap-1"><Clock className="h-3 w-3" /> {t("detection.labelInterval")}</p>
                                    <p className="font-bold">{recommendation.sprayInterval}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                        ) : (
                          <div className="p-6 bg-green-900 text-white rounded-[2rem] flex flex-col items-center justify-center text-center h-full">
                            <Leaf className="h-10 w-10 text-green-400 mb-4" />
                            <p className="font-bold">{isHealthyResult ? t("detection.routineCropCare") : t("detection.fieldVerificationRequired")}</p>
                            <p className="text-xs text-green-100 opacity-60 mt-1">{isHealthyResult ? t("detection.routineCropCareNote") : t("detection.noPrescriptionNote")}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <Card className="bg-amber-50 border-amber-200 rounded-2xl p-5">
                    <p className="text-xs font-bold text-amber-900 leading-relaxed">
                      {result?.recommendationNotice || TELANGANA_OFFLINE_NOTICE} {t("detection.manualConfirmationNote")}
                    </p>
                  </Card>

                  <div className="grid gap-3">
                    <Button
                      className="h-12 bg-[#3a7d44] text-white hover:bg-[#2e6336]"
                      onClick={() => {
                        const path = canOpenSprayPlan
                          ? `/dashboard/autospray?zone=${encodeURIComponent(result.zoneId)}&detection=${encodeURIComponent(result.detectionId)}`
                          : `/dashboard/recommendations?zone=${encodeURIComponent(result.zoneId)}&detection=${encodeURIComponent(result.detectionId)}`
                        window.location.assign(path)
                      }}
                    >
                      {canOpenSprayPlan ? t("detection.openSprayPlan") : t("detection.reviewFieldResponse")}
                    </Button>
                  </div>

                   {/* Secondary Actions */}
                   <div className="grid md:grid-cols-2 gap-4">
                    {knowledge && knowledge.farmerGuidance.immediateActions.length > 0 && (
                      <Card className="bg-amber-50 border-amber-100 rounded-2xl p-5">
                        <h4 className="font-black text-[10px] text-amber-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <Zap className="h-3 w-3" /> {t("detection.immediateActions")}
                        </h4>
                        <ul className="space-y-2">
                          {knowledge.farmerGuidance.immediateActions.map((action, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs font-bold text-amber-900">
                              <CheckCircle className="h-3 w-3 text-amber-500 mt-0.5" />
                              {action}
                            </li>
                          ))}
                        </ul>
                      </Card>
                    )}
                    <Card className="bg-slate-50 border-none rounded-2xl p-5">
                      <h4 className="font-black text-[10px] text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Leaf className="h-3 w-3" /> {t("detection.organicAlternatives")}
                      </h4>
                      <ul className="space-y-3">
                        {organicSuggestions.slice(0, 4).map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs font-bold text-slate-600">
                            <ChevronRight className="h-3 w-3 text-green-600 mt-0.5" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </Card>
                    <div className="bg-green-100/50 rounded-2xl p-5 flex flex-col justify-center border border-green-200">
                      <p className="text-xs font-bold text-green-800 leading-relaxed text-center">
                        {t("detection.loggedToHistory")}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="h-full min-h-[220px] md:min-h-[500px] flex flex-col items-center justify-center text-center p-6 md:p-12 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
              <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center text-slate-200 mb-6">
                <Brain className="h-12 w-12" />
              </div>
              <h3 className="text-2xl font-black text-slate-300">{t("detection.awaitingSample")}</h3>
              <p className="text-slate-400 mt-3 max-w-sm font-medium">
                {t("detection.awaitingSampleNote")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
