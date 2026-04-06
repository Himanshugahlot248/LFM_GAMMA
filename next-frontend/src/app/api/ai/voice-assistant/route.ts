import { NextRequest } from "next/server";
import { answerFromLocalKnowledge } from "@/lib/lfAiProjectKnowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voice assistant Q&A — **free**, no OpenAI or other paid APIs.
 * Answers use built-in keyword rules in `answerFromLocalKnowledge`.
 */
export async function POST(request: NextRequest) {
  let body: { message?: string } = {};
  try {
    body = (await request.json()) as { message?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const message = String(body.message ?? "").trim();
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const { answer, speakLang } = answerFromLocalKnowledge(message);
  return Response.json({ answer, speakLang, source: "local" as const });
}
