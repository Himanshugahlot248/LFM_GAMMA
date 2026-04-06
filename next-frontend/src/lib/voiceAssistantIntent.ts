/**
 * Classify wake follow-up: product Q&A vs deck generation topic.
 */
export function classifyVoiceIntent(raw: string): "qa" | "deck" {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "deck";

  const lower = t.toLowerCase();

  // Explicit deck commands stay on generation path (check before generic questions)
  if (
    /^(create|make|generate|build)\b/i.test(t) &&
    /(presentation|ppt|powerpoint|deck|slides)\b/i.test(t)
  ) {
    return "deck";
  }
  if (/^(make|give me|i want)\s+(a\s+)?(ppt|presentation|deck|slides)\b/i.test(t)) {
    return "deck";
  }

  // Questions (including LF AI / app questions)
  if (/\?\s*$/.test(t)) return "qa";

  if (
    /^(what|how|why|where|when|who|which|can you|could you|would you|tell me|explain|describe|is there|are there|does it|do you|did you)\b/i.test(
      lower,
    )
  ) {
    return "qa";
  }

  // Product / LF AI vocabulary → Q&A
  if (
    /\b(lf ai|lfai|this app|this project|the app|voice assistant|hey ai|deck preview|export|powerpoint|pptx|share link|username|sign in|sign out|chart|gamma|slide layout|presentation maker)\b/i.test(
      t,
    )
  ) {
    return "qa";
  }

  return "deck";
}
