/**
 * Languages for Translate & dub and Captions, with the name each model wants: the LLM translates into the
 * English name, Chatterbox Multilingual (open TTS) takes "Spanish (es)", HeyGen takes its display names and
 * ElevenLabs Dubbing ISO codes. A language without a value for an engine can't be a target there.
 */
export interface DubLanguage {
  /** ISO 639-1 (or -2) code, also what transcribers take as the spoken language. */
  code: string;
  name: string;
  /** Chatterbox Multilingual's combo value (open engine voice). */
  chatterbox?: string;
  /** HeyGen Translate's output_language. */
  heygen?: string;
  /** ElevenLabs Dubbing's target_lang. */
  eleven?: string;
}

/** cb: Chatterbox speaks it; heygen: HeyGen's name when it isn't the plain name; eleven: ElevenLabs Dubbing has it. */
const L = (code: string, name: string, o: { cb?: boolean; heygen?: string; eleven?: boolean } = {}): DubLanguage => ({
  code,
  name,
  ...(o.cb && { chatterbox: `${name} (${code})` }),
  heygen: o.heygen ?? name,
  ...(o.eleven && { eleven: code }),
});

export const DUB_LANGUAGES: DubLanguage[] = [
  L("en", "English", { cb: true, eleven: true }),
  L("es", "Spanish", { cb: true, eleven: true }),
  L("fr", "French", { cb: true, eleven: true }),
  L("de", "German", { cb: true, eleven: true }),
  L("it", "Italian", { cb: true, eleven: true }),
  L("pt", "Portuguese", { cb: true, eleven: true }),
  L("nl", "Dutch", { cb: true, eleven: true }),
  L("pl", "Polish", { cb: true, eleven: true }),
  L("ru", "Russian", { cb: true, eleven: true }),
  L("tr", "Turkish", { cb: true, eleven: true }),
  L("ar", "Arabic", { cb: true, eleven: true }),
  L("he", "Hebrew", { cb: true, heygen: "Hebrew (Israel)" }),
  L("hi", "Hindi", { cb: true, eleven: true }),
  L("ja", "Japanese", { cb: true, eleven: true }),
  L("ko", "Korean", { cb: true, eleven: true }),
  L("zh", "Chinese", { cb: true, eleven: true }),
  L("ms", "Malay", { cb: true, eleven: true }),
  L("sv", "Swedish", { cb: true, eleven: true }),
  L("da", "Danish", { cb: true, eleven: true }),
  L("no", "Norwegian", { cb: true, heygen: "Norwegian Bokmål (Norway)", eleven: true }),
  L("fi", "Finnish", { cb: true, eleven: true }),
  L("el", "Greek", { cb: true, eleven: true }),
  L("sw", "Swahili", { cb: true, heygen: "Swahili (Kenya)" }),
  L("id", "Indonesian", { eleven: true }),
  L("uk", "Ukrainian", { eleven: true }),
  L("cs", "Czech", { eleven: true }),
  L("ro", "Romanian", { eleven: true }),
  L("vi", "Vietnamese", { heygen: "Vietnamese (Vietnam)", eleven: true }),
  L("ta", "Tamil", { eleven: true }),
  L("fil", "Filipino", { eleven: true }),
  L("hu", "Hungarian", { heygen: "Hungarian (Hungary)", eleven: true }),
  L("bg", "Bulgarian", { eleven: true }),
  L("hr", "Croatian", { eleven: true }),
  L("sk", "Slovak", { eleven: true }),
  L("th", "Thai", { heygen: "Thai (Thailand)" }),
  L("bn", "Bengali", { heygen: "Bengali (India)" }),
];

export const languageByCode = (code: string | undefined): DubLanguage | undefined => DUB_LANGUAGES.find((l) => l.code === code);

/** The dubbing routes a target language can go through. */
export type DubRoute = "open" | "cloud-steps" | "heygen-translate" | "heygen-translate-fast" | "elevenlabs-dubbing";

/** Whether `lang` can be a target on a route (the LLM translates into any of them; the voice is the limit). */
export function supportsTarget(route: DubRoute, lang: DubLanguage): boolean {
  if (route === "open") return !!lang.chatterbox;
  if (route === "elevenlabs-dubbing") return !!lang.eleven;
  if (route === "heygen-translate" || route === "heygen-translate-fast") return !!lang.heygen;
  // Cloud steps: ElevenLabs v4 speaks the translation (it reads any of these), then the voice is converted.
  return true;
}
