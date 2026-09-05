import { NextResponse } from "next/server"
import { readUsers, sanitizeUser, writeUsers } from "@/app/lib/usersStore"
import { getCurrentUser } from "@/app/lib/session"
import { SUPPORTED_LANGUAGES, type Language } from "@/lib/language-context"

/** Update the signed-in user's own profile (safe fields only). */
export async function PUT(req: Request) {
  const current = getCurrentUser()
  if (!current || current.blocked) {
    return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 })
  }
  if (current.session.isGuest || !current.user) {
    return NextResponse.json(
      { success: false, message: "Guest sessions cannot save a profile. Sign in to continue." },
      { status: 403 }
    )
  }

  try {
    const body = await req.json()
    const users = readUsers()
    const index = users.findIndex((u) => u.id === current.session.id)
    if (index === -1) {
      return NextResponse.json({ success: false, message: "User not found" }, { status: 404 })
    }

    // Only the user's own editable fields — never role, status, or permissions.
    const editable: Record<string, unknown> = {}
    if (typeof body.name === "string" && body.name.trim()) editable.name = body.name.trim()
    if (typeof body.location === "string") editable.location = body.location.trim()
    if (typeof body.language === "string" && SUPPORTED_LANGUAGES.includes(body.language as Language)) {
      editable.language = body.language
    }
    // Email is only settable if the account doesn't already have one (phone signups).
    if (typeof body.email === "string" && body.email.trim() && !users[index].email) {
      editable.email = body.email.trim().toLowerCase()
    }

    users[index] = { ...users[index], ...editable }
    writeUsers(users)

    return NextResponse.json({ success: true, user: sanitizeUser(users[index]) })
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 })
  }
}
