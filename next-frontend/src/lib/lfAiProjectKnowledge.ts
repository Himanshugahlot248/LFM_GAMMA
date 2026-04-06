/**
 * Ground-truth context for the LF AI voice Q&A assistant.
 * Keep in sync with major product behavior (do not invent features).
 */
export const LF_AI_PROJECT_CONTEXT = `
## LF AI — product overview
LF AI is a web application that turns a natural-language **prompt** into a **presentation deck** with multiple slides. The experience is inspired by tools like Gamma: dark canvas, structured slide layouts, and export to PowerPoint.

## Core flows
- **Home**: User enters a topic/prompt (or uses voice), picks template/theme, slide count, and language, then generates a deck.
- **Editor**: After generation, user edits slides, uses **AI slide editor**, **rich text**, and **Gamma-style layouts** (hero split, title+bullets, stats, three cards, etc.).
- **Preview**: Shared read-only view at \`/preview/[id]\` for a presentation.
- **Export**: Download **.pptx** (native Python export), **PDF**, or open in Google Slides; chart snapshots sync from the deck preview before export when possible.
- **Charts**: User can generate charts, attach them to slides with **drag/resize** placement; position is saved and used in export.
- **Username sessions**: On first visit the app asks for a **username**. **Create account** registers a unique name; **Sign in** loads the same user’s decks/charts. User id is deterministic from the username. Sign out clears the session.
- **Share**: Owner can copy a link, set link access/password, and see **share view analytics** (who opened the link when signed in).
- **Voice assistant**: On home, say **“Hey AI”**, **“Hello AI”**, or **“Wake up AI”** to wake; then speak a **deck topic** OR ask **questions about LF AI** (features, export, charts, etc.). Answers are spoken back when possible.

## Tech stack (high level)
- **Frontend**: Next.js (App Router), React, Tailwind, Recharts for charts.
- **Backend / native PPT**: Python (FastAPI-style routes), SQLite for presentations/slides, python-pptx for Gamma-style PPTX export.

## Limitations / honesty
- The assistant cannot access the user’s private files or live database; it only explains how LF AI works.
- If the user asks for medical/legal advice or unrelated topics, politely steer back to presentations and LF AI features.
`.trim();

export type LocalKnowledgeAnswer = {
  answer: string;
  /** BCP-47 style hint for Web Speech synthesis */
  speakLang: "en" | "hi";
};

/** User asked for the reply to be in Hindi (spoken + text). */
export function userWantsHindiAnswer(raw: string): boolean {
  const n = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (/हिंदी\s*में/u.test(raw)) return true;
  return (
    /\b(in hindi|hindi me|hindi mein|answer in hindi|speak in hindi|reply in hindi|tell me in hindi|explain in hindi|say in hindi|response in hindi)\b/.test(
      n,
    ) || /\bhindi me\b.*\b(bata|batao|bataiye|sunao|sunaye)\b/.test(n)
  );
}

/** Remove Hindi-output phrases so topic keywords still match the right rule. */
function stripHindiIntentForMatching(s: string): string {
  return s
    .replace(
      /\b(in hindi|hindi me|hindi mein|answer in hindi|speak in hindi|reply in hindi|tell me in hindi|explain in hindi|say in hindi|response in hindi)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

const EMPTY_EN =
  "Ask me about LF AI features, or say a topic to create a presentation after you wake the assistant with Hey AI, Hello AI, or Wake up AI.";
const EMPTY_HI =
  "LF AI की सुविधाओं के बारे में पूछें, या Hey AI, Hello AI, या Wake up AI बोलकर जगाने के बाद प्रेज़ेंटेशन का विषय बताएँ।";

const FALLBACK_EN =
  "LF AI turns a topic into slides with charts and exports. Try: export, charts, voice wake phrases, usernames, or sharing. Ask using a short question, or speak a topic after waking the assistant to generate a deck.";
const FALLBACK_HI =
  "LF AI आपके विषय को स्लाइड, चार्ट और एक्सपोर्ट में बदलता है। आज़माएँ: एक्सपोर्ट, चार्ट, आवाज़ से जगाना, यूज़रनेम, या शेयरिंग। छोटा सा प्रश्न पूछें, या सहायक को जगाने के बाद विषय बोलकर डेक बनाएँ।";

type Rule = { test: (s: string) => boolean; reply: string; replyHi: string };

const RULES: Rule[] = [
  {
    test: (s) =>
      /\b(free|cost|pay|paid|openai|api key|subscription|price|money|credit)\b/.test(s),
    reply:
      "This voice help runs entirely on simple built-in answers—no Open A I key or paid A P I is required. You get spoken tips about LF AI for free.",
    replyHi:
      "यह आवाज़ वाली मदद पूरी तरह अंदरूनी जवाबों पर चलती है—कोई Open A I की या पैसे वाली A P I ज़रूरी नहीं। आपको LF AI के बारे में मुफ़्त में सुनने योग्य टिप्स मिलती हैं।",
  },
  {
    test: (s) =>
      /\b(what is lf|what's lf|who are you|what is this app|what does lf ai)\b/.test(s) ||
      (s.includes("lf ai") && /\b(what|who|explain)\b/.test(s)),
    reply:
      "LF AI is a prompt-to-presentation app. You describe a topic, and it builds a slide deck with layouts similar to Gamma. You can edit in the browser and export to PowerPoint or PDF.",
    replyHi:
      "LF AI एक प्रॉम्प्ट से प्रेज़ेंटेशन बनाने वाला ऐप है। आप विषय बताते हैं और यह गामा जैसे लेआउट के साथ स्लाइड डेक बनाता है। आप ब्राउज़र में एडिट कर सकते हैं और PowerPoint या PDF में एक्सपोर्ट कर सकते हैं।",
  },
  {
    test: (s) =>
      /\b(how (do|can|to) (i|you|we))\b/.test(s) && /\b(create|make|generate|start|build)\b/.test(s),
    reply:
      "On the home page, type your topic or use the microphone. Pick a template, slide count, and language, then generate. After that you land in the editor to refine slides.",
    replyHi:
      "होम पेज पर विषय टाइप करें या माइक्रोफ़ोन इस्तेमाल करें। टेम्पलेट, स्लाइड की संख्या और भाषा चुनकर जनरेट करें। उसके बाद आप एडिटर में आकर स्लाइड ठीक कर सकते हैं।",
  },
  {
    test: (s) => /\b(export|download|pptx|powerpoint|ppt\b|\.ppt)\b/.test(s),
    reply:
      "Open your deck in the editor, then use Export for PowerPoint or PDF, or follow the Google Slides flow. Charts are refreshed from the preview so the file matches what you see.",
    replyHi:
      "एडिटर में अपनी डेक खोलें, फिर Export से PowerPoint या PDF चुनें, या Google Slides वाला फ़्लो अपनाएँ। चार्ट प्रीव्यू से ताज़ा होते हैं ताकि फाइल वही दिखे जो आप देखते हैं।",
  },
  {
    test: (s) => /\b(pdf)\b/.test(s),
    reply:
      "You can export your deck as a PDF from the Export options in the editor or share menu, depending on your setup.",
    replyHi:
      "आप अपनी डेक को PDF के रूप में एक्सपोर्ट कर सकते हैं—एडिटर या शेयर मेनू में Export विकल्प से, आपकी सेटअप के अनुसार।",
  },
  {
    test: (s) => /\b(google slides)\b/.test(s),
    reply:
      "Use Export and choose the Google Slides option: you’ll download a PowerPoint file you can upload into Google Slides.",
    replyHi:
      "Export में जाकर Google Slides विकल्प चुनें: आपको एक PowerPoint फाइल मिलेगी जिसे Google Slides में अपलोड किया जा सकता है।",
  },
  {
    test: (s) => /\b(chart|graph|bar chart|line chart)\b/.test(s),
    reply:
      "Generate a chart, then use Add chart on a slide. You can drag and resize it; placement is saved for export. On the home page you can also wake the assistant and ask follow-up questions.",
    replyHi:
      "चार्ट बनाएँ, फिर स्लाइड पर Add chart से जोड़ें। आप इसे खींचकर और आकार बदलकर रख सकते हैं; पोज़िशन एक्सपोर्ट के लिए सेव होती है। होम पर सहायक को जगाकर आगे सवाल भी पूछ सकते हैं।",
  },
  {
    test: (s) =>
      /\b(voice|microphone|speech|talk|listen)\b/.test(s) ||
      /\bhey ai\b/.test(s) ||
      /\bhello ai\b/.test(s) ||
      /\bwake\s+up\s+ai\b/.test(s),
    reply:
      "On the home page, say Hey AI, Hello AI, or Wake up AI to wake the assistant. Then ask about LF AI or speak a topic to generate a new deck. Make sure the browser can use your microphone.",
    replyHi:
      "होम पेज पर Hey AI, Hello AI, या Wake up AI बोलकर सहायक को जगाएँ। फिर LF AI के बारे में पूछें या नई डेक के लिए विषय बोलें। ध्यान रखें कि ब्राउज़र को माइक्रोफ़ोन की अनुमति मिले।",
  },
  {
    test: (s) =>
      /\b(username|sign in|sign out|log ?in|log ?out|account|profile)\b/.test(s),
    reply:
      "Pick a unique username the first time, or sign in with an existing one. Your decks and charts belong to that name on this device. Sign out clears the session.",
    replyHi:
      "पहली बार एक अनोखा यूज़रनेम चुनें, या पुराने नाम से साइन इन करें। आपकी डेक और चार्ट इस डिवाइस पर उसी नाम से जुड़े रहते हैं। साइन आउट से सेशन साफ़ हो जाता है।",
  },
  {
    test: (s) => /\b(share|link|password|analytics|who viewed)\b/.test(s),
    reply:
      "Share lets you copy a preview link, optionally set a password, and view basic analytics about who opened the link when they are signed in.",
    replyHi:
      "शेयर से आप प्रीव्यू लिंक कॉपी कर सकते हैं, चाहें तो पासवर्ड लगा सकते हैं, और देख सकते हैं कि साइन इन उपयोगकर्ताओं ने लिंक कब खोला।",
  },
  {
    test: (s) =>
      /\b(editor|edit slide|ai edit|rich text|bullet)\b/.test(s),
    reply:
      "In the editor you can change titles and bullets, use the A I slide editor, and adjust Gamma-style layouts like hero split or title and bullets.",
    replyHi:
      "एडिटर में आप शीर्षक और बुलेट बदल सकते हैं, A I स्लाइड एडिटर इस्तेमाल कर सकते हैं, और गामा जैसे लेज़ाउट जैसे हीरो स्प्लिट या टाइटल और बुलेट ठीक कर सकते हैं।",
  },
  {
    test: (s) => /\b(template|theme|layout|gamma|hero)\b/.test(s),
    reply:
      "Choose a template on the home page before generating. Slides use layouts such as hero split, title with bullets, stats, and three-card sections.",
    replyHi:
      "जनरेट करने से पहले होम पेज पर टेम्पलेट चुनें। स्लाइड में हीरो स्प्लिट, टाइटल व बुलेट, स्टैट्स और थ्री-कार्ड जैसे लेज़ाउट मिलते हैं।",
  },
  {
    test: (s) => /\b(preview)\b/.test(s),
    reply:
      "Preview opens your deck in read mode. Shared links use a preview URL so others can view without editing.",
    replyHi:
      "प्रीव्यू आपकी डेक को पढ़ने वाले मोड में खोलता है। शेयर लिंक प्रीव्यू यू आर एल से दूसरे बिना एडिट किए देख सकते हैं।",
  },
  {
    test: (s) => /\b(slide count|how many slides|number of slides)\b/.test(s),
    reply:
      "On the home page you choose how many slides to target before generation. You can still edit or add content in the editor afterward.",
    replyHi:
      "होम पेज पर आप जनरेशन से पहले लक्ष्य स्लाइड की संख्या चुनते हैं। बाद में भी एडिटर में सामगली जोड़ या बदल सकते हैं।",
  },
  {
    test: (s) =>
      /\b(languages?|multilingual|french)\b/.test(s) ||
      /\b(hindi|french)\s+(support|generation|language|voice|option)\b/.test(s) ||
      /\b(support|use|choose|pick)\s+(for\s+)?(hindi|french)\b/.test(s) ||
      /\b(hindi|french)\s+for\s+generation\b/.test(s),
    reply:
      "You can pick a language for generation on the home page. Voice recognition follows your selected language where the browser supports it.",
    replyHi:
      "होम पेज पर आप जनरेशन की भाषा चुन सकते हैं। आवाज़ की पहचान उसी भाषा के अनुसार चलती है जहाँ ब्राउज़र इसे समर्थन देता है।",
  },
  {
    test: (s) => /\b(help|features|what can you do|capabilities)\b/.test(s),
    reply:
      "LF AI builds presentations from prompts, supports charts and layouts, exports to PowerPoint and PDF, sharing with optional password, and usernames to separate your work. Say a specific feature to hear more.",
    replyHi:
      "LF AI प्रॉम्प्ट से प्रेज़ेंटेशन बनाता है, चार्ट और लेज़ाउट सहारा देता है, PowerPoint और PDF एक्सपोर्ट, वैकल्पिक पासवर्ड के साथ शेयरिंग, और काम अलग रखने के लिए यूज़रनेम देता है। किसी एक सुविधा का नाम लें तो और सुनें।",
  },
];

/** Free, local-only answers for the voice assistant (no external LLM APIs). */
export function answerFromLocalKnowledge(message: string): LocalKnowledgeAnswer {
  const m = message.toLowerCase().replace(/\s+/g, " ").trim();
  const wantHi = userWantsHindiAnswer(message);

  if (!m) {
    return { answer: wantHi ? EMPTY_HI : EMPTY_EN, speakLang: wantHi ? "hi" : "en" };
  }

  const stripped = stripHindiIntentForMatching(m);
  const mForRules = stripped.length > 0 ? stripped : m;

  for (const rule of RULES) {
    if (rule.test(mForRules)) {
      return { answer: wantHi ? rule.replyHi : rule.reply, speakLang: wantHi ? "hi" : "en" };
    }
  }

  return { answer: wantHi ? FALLBACK_HI : FALLBACK_EN, speakLang: wantHi ? "hi" : "en" };
}
