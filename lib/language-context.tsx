"use client"

import React, { createContext, useContext, useState, useEffect } from "react"

export type Language = "en" | "hi" | "mr" | "ta" | "te"

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
}

export const SUPPORTED_LANGUAGES: Language[] = ["en", "hi", "mr", "ta", "te"]

export const LANGUAGE_STORAGE_KEY = "bhoomitra_language"

/** BCP-47 locales for Intl formatting and speech synthesis. */
export const LOCALE_BY_LANGUAGE: Record<Language, string> = {
  en: "en-IN",
  hi: "hi-IN",
  mr: "mr-IN",
  ta: "ta-IN",
  te: "te-IN",
}

export function localeFor(language: Language): string {
  return LOCALE_BY_LANGUAGE[language] ?? "en-IN"
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as string[]).includes(value)
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Always start at "en" so server and first client render agree; the saved
  // preference is applied after hydration.
  const [language, setLanguageState] = useState<Language>("en")

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
      if (isLanguage(saved)) setLanguageState(saved)
    } catch {
      // Private mode / disabled storage — keep the English default.
    }
  }, [])

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language
    }
  }, [language])

  const setLanguage = (lang: Language) => {
    if (!isLanguage(lang)) return
    setLanguageState(lang)
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
    } catch {
      // Preference simply does not persist when storage is unavailable.
    }
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider")
  }
  return context
}
