"use client"

import { Sparkles, CloudOff, Cpu } from "lucide-react"
import type { GeminiAnalysisSource } from "@/app/lib/llmRecommendationEngine"

/**
 * Shared source indicator for detection-result screens (Disease/Pest today,
 * nutrient-deficiency once that model lands in the same pipeline). Mirrors
 * the three-state badge already shipped on the Recommendations page, kept as
 * its own small component here so Detection and Pest stay visually
 * consistent with each other without touching the already-tested
 * Recommendations component.
 */
export function AiSourceBadge({ source }: { source?: GeminiAnalysisSource }) {
  if (source === "gemini") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 px-3 py-1.5 text-xs font-bold text-white">
        <Sparkles className="h-3.5 w-3.5" />
        AI-enhanced by Gemini
      </span>
    )
  }
  if (source === "ml-fallback") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900">
        <CloudOff className="h-3.5 w-3.5" />
        Gemini unavailable — ML recommendation shown
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
      <Cpu className="h-3.5 w-3.5" />
      Offline ML model
    </span>
  )
}
