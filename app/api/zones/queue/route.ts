import { NextResponse } from "next/server"
import { clearPendingIrrigationQueue, pendingCommands } from "../data"

export async function GET() {
  return NextResponse.json(pendingCommands)
}

export async function POST() {
  const { clearedZoneIds } = clearPendingIrrigationQueue()
  return NextResponse.json({ clearedZoneIds, queue: pendingCommands })
}
