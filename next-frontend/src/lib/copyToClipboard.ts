/**
 * Copy text to the clipboard. Tries the Clipboard API first, then a
 * `textarea` + `document.execCommand('copy')` fallback (works on more HTTP / older cases).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const t = String(text ?? "").trim();
  if (!t) return false;

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    /* use fallback */
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
