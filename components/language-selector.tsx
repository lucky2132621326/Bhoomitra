"use client"

import { useEffect, useRef, useState } from "react"
import { useLanguage, type Language } from "@/lib/language-context"
import { useTranslation } from "@/lib/use-translation"
import { Globe, Check, ChevronDown } from "lucide-react"

const languages: { code: Language; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिंदी" },
  { code: "mr", label: "Marathi", native: "मराठी" },
  { code: "ta", label: "Tamil", native: "தமிழ்" },
  { code: "te", label: "Telugu", native: "తెలుగు" },
]

/**
 * Compact language dropdown. Closes on outside-click / Escape and highlights
 * the active choice. `align` controls which edge the menu opens from so it can
 * sit cleanly in a header (right) or inside a settings card (left).
 */
export default function LanguageSelector({
  align = "right",
  onChange,
}: {
  align?: "left" | "right"
  onChange?: (lang: Language) => void
}) {
  const { language, setLanguage } = useLanguage()
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = languages.find((l) => l.code === language) || languages[0]

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("language.label")}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base font-medium text-slate-700 shadow-sm transition-colors hover:border-green-300 hover:bg-green-50/60 md:min-h-0 md:text-sm"
      >
        <Globe className="h-4 w-4 text-green-600" />
        <span>{current.native}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-[100] mt-2 w-56 origin-top overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
            {t("language.choose")}
          </div>
          <div className="pb-2">
            {languages.map((lang) => {
              const active = language === lang.code
              return (
                <button
                  key={lang.code}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setLanguage(lang.code)
                    onChange?.(lang.code)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors ${
                    active ? "bg-green-50" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex flex-col leading-tight">
                    <span className={`text-sm font-semibold ${active ? "text-green-700" : "text-slate-800"}`}>
                      {lang.native}
                    </span>
                  </div>
                  {active && <Check className="h-4 w-4 text-green-600" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
