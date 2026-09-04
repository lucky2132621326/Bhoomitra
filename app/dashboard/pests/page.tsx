"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Bug, Camera, ImagePlus, Leaf, Loader2, MapPin, Microscope, RefreshCw, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { usePestText } from "@/components/pest-zone-copy"
import { PestZoneResult, zoneColours, zoneLabels } from "@/components/pest-zone-result"
import { zoneState, type PestZoneObservation, type PestZoneState } from "@/lib/pest-zone-types"

const FALLBACK_ZONES = ["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2", "B3", "B4", "B5", "B6"]
const SUPPORTED_CROPS = ["Paddy", "Rice", "Maize", "Cotton", "Groundnut", "Soybean", "Tomato", "Chilli", "Okra", "Potato", "Mustard", "Sugarcane", "Vegetables"]
type ModelStatus = { model: { ready: boolean; classCount: number } }

export default function PestDetectionPage() {
  const { text, language } = usePestText()
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const scanInFlight = useRef(false)
  const retaking = useRef(false)
  const historyRequest = useRef(0)
  const cropTouched = useRef(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [zone, setZone] = useState("A1")
  const [crop, setCrop] = useState("Paddy")
  const [farmCrop, setFarmCrop] = useState("Paddy")
  const [zones, setZones] = useState(FALLBACK_ZONES)
  const [observations, setObservations] = useState<PestZoneObservation[]>([])
  const [viewId, setViewId] = useState<string | null>(null)
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comparable, setComparable] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const cropOptions = useMemo(() => [...new Set([farmCrop, crop, ...SUPPORTED_CROPS])]
    .filter((item) => item !== (crop === "Rice" ? "Paddy" : "Rice")), [farmCrop, crop])
  const latestByZone = useMemo(() => {
    const result = new Map<string, PestZoneObservation>()
    for (const observation of observations) if (!result.has(observation.result.scan.zoneId)) result.set(observation.result.scan.zoneId, observation)
    return result
  }, [observations])
  const viewed = observations.find((item) => item.id === viewId)
  const zoneHistory = viewed ? observations.filter((item) => item.result.scan.zoneId === viewed.result.scan.zoneId) : []
  const previous = latestByZone.get(zone)

  const refreshHistory = useCallback(async () => {
    const requestId = ++historyRequest.current
    setHistoryLoading(true)
    try {
      const response = await fetch("/api/pest-zones", { cache: "no-store" })
      if (!response.ok) throw new Error("Could not load zone history. Please refresh.")
      const body = await response.json()
      if (!Array.isArray(body.observations)) throw new Error("Invalid zone history")
      if (requestId === historyRequest.current) { setObservations(body.observations); setHistoryError(false) }
    } catch {
      if (requestId === historyRequest.current) setHistoryError(true)
    } finally {
      if (requestId === historyRequest.current) setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void refreshHistory()
    Promise.allSettled([
      fetch("/api/zones").then((response) => response.json()),
      fetch("/api/farmer-profile").then((response) => response.json()),
      fetch("/api/pest-detect").then((response) => response.json()),
    ]).then(([zoneResponse, profileResponse, modelResponse]) => {
      if (!active) return
      if (zoneResponse.status === "fulfilled") {
        const values = Array.isArray(zoneResponse.value) ? zoneResponse.value : zoneResponse.value?.zones
        const ids = Array.isArray(values) ? values.map((item: { id: string }) => item.id).filter(Boolean) : []
        if (ids.length) setZones([...new Set<string>(ids)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
      }
      if (profileResponse.status === "fulfilled") {
        const registeredCrop = profileResponse.value?.profile?.primaryCrop?.trim()
        if (registeredCrop) { setFarmCrop(registeredCrop); if (!cropTouched.current) setCrop(registeredCrop) }
      }
      if (modelResponse.status === "fulfilled") setModelStatus(modelResponse.value)
    })
    return () => { active = false; historyRequest.current++; window.speechSynthesis?.cancel() }
  }, [refreshHistory])

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const openFilePicker = () => {
    if (loading || !inputRef.current) return
    inputRef.current.value = ""
    inputRef.current.click()
  }
  const selectImage = (selected?: File) => {
    if (!selected) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) { setError("Choose a JPG, PNG or WEBP photo."); return }
    if (selected.size > 12 * 1024 * 1024) { setError("Choose a photo smaller than 12 MB."); return }
    setFile(selected); setPreview(URL.createObjectURL(selected)); setError(null); setComparable(false)
  }
  const chooseZone = (id: string, openResult: boolean) => {
    setZone(id); setComparable(false); setError(null)
    const latest = latestByZone.get(id)
    if (latest) { cropTouched.current = true; setCrop(latest.result.scan.crop); if (openResult) setViewId(latest.id) }
  }
  const mergeObservation = (observation: PestZoneObservation) => {
    setObservations((items) => [observation, ...items.filter((item) => item.id !== observation.id)].sort((a, b) => Date.parse(b.result.scan.timestamp) - Date.parse(a.result.scan.timestamp)))
  }

  const runScan = async () => {
    if (!file || scanInFlight.current) return
    scanInFlight.current = true; setLoading(true); setError(null)
    // Capture the selected zone/crop with the file. Controls are locked during inference.
    const form = new FormData()
    form.set("file", file); form.set("zoneId", zone); form.set("crop", crop); form.set("language", language)
    form.set("comparablePhoto", String(comparable))
    try {
      const response = await fetch("/api/pest-detect", { method: "POST", body: form })
      const body = await response.json()
      if (!response.ok || !body.observation) throw new Error(body.error || "The pest check could not be completed.")
      ++historyRequest.current // Ignore a history request that began before this scan saved.
      setHistoryLoading(false)
      mergeObservation(body.observation); setViewId(body.observation.id)
      setFile(null); setPreview(null); setComparable(false)
      toast[body.detected ? "success" : "info"](text(body.detected ? "Check completed and saved to the zone." : "Scan inconclusive. Please recheck the plant."))
      void refreshHistory()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The pest check could not be completed.")
    } finally { scanInFlight.current = false; setLoading(false) }
  }

  const retake = () => {
    if (!viewed) return
    setZone(viewed.result.scan.zoneId)
    setCrop(latestByZone.get(viewed.result.scan.zoneId)?.result.scan.crop || viewed.result.scan.crop)
    cropTouched.current = true; setFile(null); setPreview(null); setComparable(false); setError(null)
    retaking.current = true; setViewId(null)
    window.speechSynthesis?.cancel()
  }
  const confirmClear = async () => {
    if (!viewed || confirming) return
    setConfirming(true)
    try {
      const response = await fetch("/api/pest-zones", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observationId: viewed.id, fieldCheckedNoPests: true }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Could not save field confirmation.")
      ++historyRequest.current; setHistoryLoading(false); mergeObservation(body.observation)
      toast.success(text("Field check saved.")); void refreshHistory()
    } catch (reason) { toast.error(text(reason instanceof Error ? reason.message : "Could not save field confirmation.")) }
    finally { setConfirming(false) }
  }

  return <div className="space-y-7 pb-10" data-no-runtime-translate="true">
    <header className="flex flex-wrap items-start justify-between gap-4 sm:pr-28">
      <div><h1 className="flex items-center gap-3 text-3xl font-extrabold text-[#1a2e1d] md:text-4xl"><Bug className="h-9 w-9 shrink-0 text-green-700" />{text("Pest Detection & Prevention")}</h1><p className="mt-3 max-w-3xl text-lg leading-7 text-slate-600">{text("Select a zone, check a photo, then open the zone for its plan and history.")}</p></div>
      <span className={"rounded-full border px-4 py-2 text-sm font-semibold " + (modelStatus?.model?.ready ? "border-green-200 bg-green-50 text-green-800" : "border-slate-200 bg-white text-slate-600")}>{text(!modelStatus ? "Checking model…" : modelStatus.model?.ready ? "Pest detector ready" : "Pest detector unavailable")}{modelStatus?.model?.ready ? " · " + modelStatus.model.classCount : ""}</span>
    </header>

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(280px,330px)_minmax(0,1fr)]">
      <section className="space-y-4 rounded-3xl border border-green-100 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-xl font-bold"><Camera className="text-green-700" />{text("Check a plant")}</h2><p className="text-base leading-6 text-slate-600">{text("Use one clear close-up. Include the insect and its damage where possible.")}</p>
        <button ref={uploadRef} type="button" disabled={loading} onClick={openFilePicker} className="relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-green-200 bg-green-50/50 p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 disabled:opacity-50">
          {preview ? <><img src={preview} alt={text("Latest photo")} className="h-full w-full object-contain" /><span className="absolute bottom-2 rounded-full bg-black/75 px-3 py-1 text-sm text-white">{text("Tap to change photo")}</span></> : <span className="flex flex-col items-center gap-2 p-4 font-semibold text-green-800"><ImagePlus className="h-8 w-8" />{text("Take or choose a pest photo")}</span>}
        </button>
        <input ref={inputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => selectImage(event.target.files?.[0])} />
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-2 text-sm font-bold"><span className="flex items-center gap-1"><MapPin className="h-4 w-4 text-green-700" />{text("Field zone")}</span><select value={zone} disabled={loading} onChange={(event) => chooseZone(event.target.value, false)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base">{zones.map((id) => <option key={id} value={id}>{text("Zone")} {id}</option>)}</select></label>
          <label className="space-y-2 text-sm font-bold"><span className="flex items-center gap-1"><Leaf className="h-4 w-4 text-green-700" />{text("Crop")}</span><select value={crop} disabled={loading} onChange={(event) => { cropTouched.current = true; setCrop(event.target.value); setComparable(false) }} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base">{cropOptions.map((name) => <option key={name} value={name}>{text(name)}</option>)}</select></label>
        </div>
        {previous && <div className="space-y-2 rounded-xl bg-slate-50 p-3"><label className="flex cursor-pointer items-start gap-2 text-sm leading-6"><input type="checkbox" checked={comparable} disabled={loading} onChange={(event) => setComparable(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-green-700" /><span>{text("Same plants and similar photo distance as the previous test")}</span></label><p className="text-sm leading-5 text-slate-500">{text("Tick only for comparable photos. Otherwise no improvement claim is made.")}</p></div>}
        <Button className="h-12 w-full rounded-xl bg-green-700 text-base font-bold hover:bg-green-800" disabled={loading || !file} onClick={() => void runScan()}>{loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Microscope className="mr-2 h-5 w-5" />}{text(loading ? "Checking photo…" : "Check this photo")}</Button>
        <p className="text-center text-sm leading-6 text-slate-500">{text("Results save automatically to the selected zone.")}</p>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"><p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-5 w-5 shrink-0" />{text("Pest analysis could not run")}</p><p className="mt-2 text-sm leading-6">{text(error)}</p></div>}
      </section>

      <section className="min-w-0 rounded-3xl border border-green-100 bg-white p-5 shadow-sm sm:p-6" aria-label={text("Pest map")}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-2xl font-bold"><MapPin className="text-green-700" />{text("Farm Layout")}</h2><p className="mt-1 text-base text-slate-600">{text("Same farm zones · latest pest check")}</p></div><Button variant="outline" className="h-11 rounded-xl" disabled={historyLoading || loading} onClick={() => void refreshHistory()}><RefreshCw className={"mr-2 h-4 w-4 " + (historyLoading ? "animate-spin" : "")} />{text("Refresh")}</Button></div>
        {historyError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{text("Could not load zone history. Please refresh.")}</p>}
        <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-6" aria-busy={historyLoading}>
          {zones.map((id) => {
            const latest = latestByZone.get(id)
            const state = zoneState(latest)
            const label = !latest && historyError ? "History unavailable" : !latest && historyLoading ? "Loading zone history…" : zoneLabels[state]
            return <button key={id} type="button" disabled={loading || (historyLoading && !latest)} aria-label={text("Zone") + " " + id + ": " + text(label) + ". " + text(latest ? "View result" : "Select zone")} aria-pressed={zone === id} onClick={() => chooseZone(id, true)} className={"flex min-h-32 w-full min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border-2 p-2 text-center shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-green-800 disabled:opacity-60 " + zoneColours[state] + (zone === id ? " ring-4 ring-green-800 ring-offset-2" : "")}><span className="text-2xl font-extrabold">{id}</span><span className="text-sm font-semibold leading-5">{text(label)}</span>{latest && <span className="text-xs font-medium">{new Date(latest.result.scan.timestamp).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" })}</span>}</button>
          })}
        </div>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-3 border-t border-slate-100 pt-5">{(["high", "moderate", "low", "unmeasured", "clear", "recheck", "untested"] as PestZoneState[]).map((state) => <span key={state} className="flex items-center gap-2 text-sm font-medium"><span className={"h-4 w-4 rounded border " + zoneColours[state]} />{text(zoneLabels[state])}</span>)}</div>
        <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-base leading-7 text-slate-600">{text("Colours describe the latest photo, not the whole zone. Green requires a field check; an uncertain photo stays grey.")}</p>
        <p className="mt-4 text-sm text-slate-500">{text("Use a fresh photo of the same plants to track change.")}</p>
      </section>
    </div>

    <Dialog open={Boolean(viewed)} onOpenChange={(open) => { if (!open) { setViewId(null); window.speechSynthesis?.cancel() } }}>
      <DialogContent data-no-runtime-translate="true" showCloseButton={false} overlayClassName="pest-zone-overlay" className="pest-zone-dialog flex max-h-[94dvh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-3xl bg-[#f7fbf7] p-0 sm:max-w-[1280px]" onCloseAutoFocus={(event) => { if (retaking.current) { event.preventDefault(); retaking.current = false; uploadRef.current?.focus(); uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }) } }}>
        <DialogHeader className="shrink-0 border-b border-green-100 bg-white px-5 py-4 sm:px-7"><div className="flex items-center justify-between gap-3"><DialogTitle className="text-2xl">{text("Zone")} {viewed?.result.scan.zoneId} · {text("Zone result & plan")}</DialogTitle><DialogClose asChild><Button variant="ghost" className="h-11 w-11 shrink-0 rounded-full p-0" aria-label={text("Close")}><X className="h-6 w-6" /></Button></DialogClose></div><DialogDescription className="text-base">{text("Counts and pressure describe this photo only, not the whole zone.")}</DialogDescription></DialogHeader>
        <div ref={popupRef} className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {viewed && <PestZoneResult key={viewed.id} observation={viewed} observations={zoneHistory} confirming={confirming} onConfirmClear={() => void confirmClear()} onRetake={retake} onView={(id) => { setViewId(id); popupRef.current?.scrollTo({ top: 0, behavior: "smooth" }); window.speechSynthesis?.cancel() }} />}
        </div>
      </DialogContent>
    </Dialog>
  </div>
}
