"use client"

import { useState } from "react"
import { Camera, CheckCircle2, Clock3, FlaskConical, History, ImageOff, Loader2, ShieldCheck, Sprout, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { usePestText } from "@/components/pest-zone-copy"
import { localeFor } from "@/lib/language-context"
import { zoneState, zoneTrend, type PestZoneObservation, type PestZoneState, type PestZoneTrend } from "@/lib/pest-zone-types"
import { AiSourceBadge } from "@/components/ai-source-badge"
import { GeminiAnalysisPanel } from "@/components/gemini-analysis-panel"

export const zoneLabels: Record<PestZoneState, string> = {
  unmeasured: "Pressure unknown",
  high: "High alert", moderate: "Moderate", low: "Low", clear: "Field checked: clear", recheck: "Needs recheck", untested: "Not checked",
}
export const zoneColours: Record<PestZoneState, string> = {
  unmeasured: "bg-purple-600 text-white border-purple-700",
  high: "bg-red-600 text-white border-red-700",
  moderate: "bg-orange-500 text-slate-950 border-orange-600",
  low: "bg-yellow-300 text-slate-950 border-yellow-400",
  clear: "bg-green-600 text-white border-green-700",
  recheck: "bg-slate-200 text-slate-800 border-slate-400 border-dashed",
  untested: "bg-white text-slate-500 border-slate-200 border-dashed",
}
const trendLabels: Record<PestZoneTrend["status"], string> = {
  first: "First test in this zone", improving: "Improving in photos", worsening: "Higher pressure in photos",
  stable: "Same pressure band", different_pest: "Different pests — compare separately", different_crop: "Different crop — no direct comparison",
  recheck: "No reliable comparison yet", field_clear: "Field checked — no visible pests", not_comparable: "Photos not confirmed comparable",
}

function ActionList({ items }: { items: string[] }) {
  const { text } = usePestText()
  return <ol className="space-y-4">{items.map((item, index) => <li key={item} className="flex gap-3 text-base leading-7 text-slate-700"><span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-sm font-bold text-green-800">{index + 1}</span><span>{text(item)}</span></li>)}</ol>
}

export function PestZoneResult({ observation, observations, onRetake, onView, onConfirmClear, confirming }: {
  observation: PestZoneObservation; observations: PestZoneObservation[]
  onRetake: () => void; onView: (id: string) => void; onConfirmClear: () => void; confirming: boolean
}) {
  const { text, language } = usePestText()
  const [photoFailed, setPhotoFailed] = useState(false)
  const [fieldChecked, setFieldChecked] = useState(false)
  const result = observation.result
  const classifierOnly = result.identificationSource === "classifier"
  const trend = zoneTrend(observation, observations)
  const state = zoneState(observation)
  const latest = observations[0]?.id === observation.id
  const date = (value: string) => new Date(value).toLocaleString(localeFor(language), { dateStyle: "medium", timeStyle: "short" })
  const advice = result.advice

  const speak = () => {
    if (!("speechSynthesis" in window)) return
    const words = [result.summary?.primaryPestName || "Needs recheck", ...(advice?.inspectToday || []), ...(advice?.next48Hours || [])].map(text).join(". ")
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(words)
    utterance.lang = localeFor(language)
    window.speechSynthesis.speak(utterance)
  }

  return <div className="space-y-6 text-base">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{text(latest ? "Latest test" : "Earlier test")}</Badge><Badge variant="outline">{text(result.scan.crop)}</Badge><time className="text-sm text-slate-600" dateTime={result.scan.timestamp}>{date(result.scan.timestamp)}</time>{result.detected && <AiSourceBadge source={result.analysisSource} />}</div>
      <Button onClick={onRetake} className="h-11 rounded-xl bg-green-700 text-base hover:bg-green-800"><Camera className="mr-2 h-5 w-5" />{text("Check this zone again")}</Button>
    </div>

    <section className="grid gap-6 rounded-3xl border border-green-100 bg-white p-4 sm:p-6 lg:grid-cols-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100">
        {observation.photoUrl && !photoFailed ? <>
          <img src={observation.photoUrl} alt={text("Latest photo")} className="h-full w-full object-contain" onError={() => setPhotoFailed(true)} />
          {!!result.image.width && !!result.image.height && !!result.detections.length && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${result.image.width} ${result.image.height}`} preserveAspectRatio="xMidYMid meet">
            {result.detections.map((detection, index) => <rect key={index} x={detection.box.x1} y={detection.box.y1} width={detection.box.width} height={detection.box.height} fill="rgba(22,163,74,.08)" stroke="#16a34a" strokeWidth="3" vectorEffect="non-scaling-stroke" />)}
          </svg>}
          <p className="absolute bottom-2 left-2 right-2 rounded-xl bg-black/75 px-3 py-2 text-sm text-white">{text(classifierOnly ? "Classifier result — location and count unavailable." : result.detected ? "Green boxes mark visible pests." : "No reliable identification from this photo.")}</p>
        </> : <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-500"><ImageOff className="h-9 w-9" /><p>{text(photoFailed ? "Saved photo could not be loaded." : "Photo was not saved for this older test.")}</p></div>}
      </div>
      <div className="flex flex-col justify-center">
        <span className={`w-fit rounded-full border px-3 py-1 text-sm font-bold ${zoneColours[state]}`}>{text(zoneLabels[state])}</span>
        {result.detected && result.summary ? <>
          <p className="mt-5 text-sm font-bold uppercase tracking-widest text-green-700">{text(classifierOnly ? "Classifier result" : "Detected pest")}</p>
          <h3 className="mt-1 text-3xl font-extrabold text-slate-950">{text(result.summary.primaryPestName)}</h3>
          <p className="mt-1 italic text-slate-500">{result.summary.scientificName}</p>
          {!classifierOnly && <><div className="my-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-green-50 p-4"><strong className="block text-3xl text-green-800">{result.summary.visibleCount}</strong><span>{text("visible in this photo")}</span></div>
            <div className="rounded-2xl bg-slate-50 p-4"><strong className="block text-xl">{text(zoneLabels[state])}</strong><span>{text("photo-level pressure")}</span></div>
          </div>
          <div className="flex flex-wrap gap-2">{result.predictions.map((pest) => <Badge key={pest.pestId} variant="outline" className="text-sm">{text(pest.pestName)}: {pest.count}</Badge>)}</div>
          <p className="mt-4 leading-7 text-slate-600">{text("Counts and pressure describe this photo only, not the whole zone.")}</p></>}
          {classifierOnly && <p className="my-5 rounded-2xl bg-purple-50 p-4 leading-7 text-purple-900">{text("Pest count and pressure are unavailable. Take a closer photo to measure visible pests.")}</p>}
          <Button variant="outline" onClick={speak} className="mt-4 h-11 rounded-xl text-base"><Volume2 className="mr-2 h-5 w-5" />{text("Listen to advice")}</Button>
        </> : <>
          <h3 className="mt-4 text-2xl font-bold">{text(observation.fieldNoPestsAt ? "Farmer checked the plants and reported no visible pests." : "No reliable identification from this photo.")}</h3>
          <p className="mt-3 leading-7 text-slate-600">{text(observation.fieldNoPestsAt ? "This is a field observation, not a guarantee that the zone is pest-free." : "A pest may still be present. Retake a clear close-up and inspect the plant again.")}</p>
          {observation.fieldNoPestsAt && <time className="mt-3 text-sm text-green-800">{date(observation.fieldNoPestsAt)}</time>}
          {latest && !observation.legacy && !observation.fieldNoPestsAt && <div className="mt-5 space-y-3 rounded-2xl border border-slate-200 p-4">
            <label className="flex cursor-pointer items-start gap-3 leading-6"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-green-700" checked={fieldChecked} disabled={confirming} onChange={(event) => setFieldChecked(event.target.checked)} /><span>{text("I inspected the plants and found no visible pests")}</span></label>
            <Button variant="outline" className="h-11 w-full text-base" disabled={!fieldChecked || confirming} onClick={onConfirmClear}>{confirming ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}{text("Save field check")}</Button>
          </div>}
        </>}
      </div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5" aria-label={text("Photo comparison")}>
      <p className="text-sm font-semibold text-slate-600">{text("Photo comparison")}</p>
      {trend.previous && <p className="mt-2 text-xl font-bold">{text("Previous")}: {text(zoneLabels[zoneState(trend.previous)])} <span aria-hidden="true">→</span> {text("Now")}: {text(zoneLabels[state])}</p>}
      <p className={`mt-2 font-bold ${trend.status === "improving" ? "text-green-800" : trend.status === "worsening" ? "text-red-800" : "text-slate-700"}`}>{text(trendLabels[trend.status])}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text("Compare the same plants, angle and distance. Photo counts do not measure whole-field severity.")}</p>
    </section>

    {advice && <>
      <section className="rounded-3xl border border-green-100 bg-white p-5 sm:p-6">
        <h3 className="mb-5 flex items-center gap-3 text-2xl font-bold"><Sprout className="text-green-700" />{text("Clear prevention plan")}</h3>
        <div className="grid gap-4 md:grid-cols-3">{[
          { title: "Do today", items: advice.inspectToday, style: "bg-red-50/60 border-red-100", Icon: Clock3 },
          { title: "Next 48 hours", items: advice.next48Hours, style: "bg-amber-50/60 border-amber-100", Icon: Clock3 },
          { title: "Prevent it returning", items: advice.prevention, style: "bg-green-50/60 border-green-100", Icon: ShieldCheck },
        ].map(({ title, items, style, Icon }) => <div key={title} className={`rounded-2xl border p-5 ${style}`}><h4 className="mb-4 flex items-center gap-2 text-lg font-bold"><Icon className="h-5 w-5 shrink-0" />{text(title)}</h4><ActionList items={items} /></div>)}</div>
      </section>

      <section className="rounded-3xl border border-blue-100 bg-white p-5 sm:p-6">
        <h3 className="flex items-center gap-3 text-2xl font-bold"><FlaskConical className="shrink-0 text-blue-600" />{text("Treatment & pesticide guidance")}</h3>
        <p className="mt-2 leading-7 text-slate-600">{text("Begin with the lowest-impact option. Use a pesticide only after field confirmation and a safe weather check.")}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <section className="rounded-2xl border border-green-100 bg-green-50/60 p-5"><h4 className="mb-4 text-lg font-bold">{text("1. Try lower-impact control first")}</h4><ActionList items={advice.biologicalControl} /></section>
          <section className="space-y-4 rounded-2xl border border-amber-100 bg-amber-50/50 p-5 leading-7"><h4 className="text-lg font-bold">{text("2. Spray only when all are true")}</h4><p><strong>{text("Pest confirmed:")}</strong> {text("Check nearby plants, not only this photo.")}</p><p><strong>{text("Action threshold reached:")}</strong> {text(advice.pesticide.trigger)}</p><p><strong>{text("Weather safe:")}</strong> {text("No expected rain and no strong wind during application.")}</p></section>
          <section className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-5 leading-7"><h4 className="text-lg font-bold text-blue-800">{text("3. If spraying is necessary")}</h4>
            {!advice.pesticide.eligible && <p className="font-semibold">{text("Confirm the pest and crop with local extension before choosing a pesticide.")}</p>}
            <p className="font-bold">{text(advice.pesticide.product)}</p>
            <p><strong>{text("Where and when:")}</strong> {text(advice.pesticide.application)}</p><p><strong>{text("How much:")}</strong> {text(advice.pesticide.labelRate)}</p><p><strong>{text("When to recheck:")}</strong> {text(advice.pesticide.interval)}</p>
          </section>
        </div>
        <p className="mt-5 rounded-2xl bg-slate-900 p-5 leading-7 text-white"><strong>{text("Safety:")}</strong> {text(advice.pesticide.safety)} {text(advice.pesticide.resistanceNote)} <strong>{text("Pre-harvest interval:")}</strong> {text(advice.pesticide.preHarvestInterval)}</p>
      </section>
    </>}

    {/* Gemini analysis is purely additive: the ML pest ID and knowledge-base
        advice above are already complete on their own — this only appears
        when the online call actually succeeded and validated. */}
    {result.analysisSource === "gemini" && result.geminiAnalysis && (
      <GeminiAnalysisPanel analysis={result.geminiAnalysis} />
    )}

    <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
      <h3 className="flex items-center gap-3 text-2xl font-bold"><History className="text-green-700" />{text("Zone test history")}</h3><p className="mt-2 text-slate-600">{text("Open any test to view its saved result.")}</p>
      <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">{observations.map((item) => <button type="button" key={item.id} onClick={() => onView(item.id)} aria-current={observation.id === item.id ? "true" : undefined} className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-left transition hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 ${item.id === observation.id ? "border-green-600 bg-green-50" : "border-slate-200"}`}>
        <div><time className="block font-semibold">{date(item.result.scan.timestamp)}</time><span className="text-sm text-slate-600">{text(item.result.scan.crop)} · {text(item.result.summary?.primaryPestName || "Needs recheck")}{item.result.detected && item.result.identificationSource !== "classifier" ? ` · ${item.result.summary?.visibleCount} ${text("visible")}` : ""}</span></div>
        <span className={`rounded-full border px-3 py-1 text-sm font-bold ${zoneColours[zoneState(item)]}`}>{text(zoneLabels[zoneState(item)])}</span>
      </button>)}</div>
    </section>
  </div>
}
