"use client"

import { Sparkles, Eye, ListChecks, AlertCircle, CloudRain, Zap, ShieldAlert, Sprout, Clock } from "lucide-react"
import type { GeminiDetectionAnalysis } from "@/app/lib/llmRecommendationEngine"

function Bullets({ items, tone = "emerald" }: { items: string[]; tone?: "emerald" | "amber" }) {
  const dot = tone === "amber" ? "bg-amber-500" : "bg-emerald-500"
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
          <div className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          {item}
        </li>
      ))}
    </ul>
  )
}

/**
 * Renders a validated Gemini detection-time analysis as organized,
 * farmer-friendly sections — never as a raw block of text. Shared by the
 * Disease Detection and Pest Detection result screens (and, once that model
 * ships, nutrient-deficiency results on the same Disease Detection screen).
 *
 * This is purely presentational: the ML diagnosis, confidence, severity, and
 * any chemical/dosage remain whatever the caller already renders elsewhere
 * from the ML/offline recommendation engine — this panel only shows Gemini's
 * own advisory fields, clearly labeled as AI analysis.
 */
export function GeminiAnalysisPanel({ analysis }: { analysis: GeminiDetectionAnalysis }) {
  return (
    <div className="space-y-5 rounded-[2rem] border-2 border-emerald-200 bg-emerald-50/60 p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-emerald-700" />
        <h3 className="text-xl font-black text-emerald-900">AI Analysis</h3>
      </div>

      <p className="text-base font-semibold leading-relaxed text-slate-800">{analysis.summary}</p>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
            <Eye className="h-3.5 w-3.5" /> What the photo shows
          </p>
          <p className="mt-1.5 text-sm text-slate-700">{analysis.visual_analysis}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
            <ListChecks className="h-3.5 w-3.5" /> Symptoms observed
          </p>
          <div className="mt-1.5">
            <Bullets items={analysis.symptoms} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
            <AlertCircle className="h-3.5 w-3.5" /> Likely causes
          </p>
          <div className="mt-1.5">
            <Bullets items={analysis.likely_causes} />
          </div>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
            <CloudRain className="h-3.5 w-3.5" /> Environmental factors
          </p>
          <div className="mt-1.5">
            <Bullets items={analysis.environmental_factors} />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl bg-white/70 p-4">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
          <Zap className="h-3.5 w-3.5" /> What to do now
        </p>
        <p className="text-base font-bold leading-snug text-[#1a2e1d]">{analysis.recommended_action}</p>
        <p className="text-sm text-slate-700">{analysis.treatment}</p>
        <div className="grid gap-3 pt-1 sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <p className="text-sm text-slate-700"><span className="font-bold">Timing: </span>{analysis.timing}</p>
          </div>
          <div className="flex items-start gap-2">
            <CloudRain className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <p className="text-sm text-slate-700"><span className="font-bold">Weather: </span>{analysis.weather_consideration}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
            <Sprout className="h-3.5 w-3.5" /> Prevention
          </p>
          <div className="mt-1.5">
            <Bullets items={analysis.prevention} />
          </div>
        </div>
        <div className="rounded-xl bg-amber-100/80 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">
            <ShieldAlert className="h-3.5 w-3.5" /> Safety notes
          </p>
          <div className="mt-1.5">
            <Bullets items={analysis.safety_notes} tone="amber" />
          </div>
        </div>
      </div>

      <p className="text-xs italic text-emerald-800/70">
        This AI analysis is advisory. The detected issue, confidence, and any chemical or dosage shown above always come from Bhoomitra's ML model — Gemini only explains and adds context around them.
      </p>
    </div>
  )
}
