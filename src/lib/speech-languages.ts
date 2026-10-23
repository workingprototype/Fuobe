/**
 * Spoken languages: what the open transcribers' ComfyUI nodes take (Qwen3-ASR, ComfyUI-Whisper),
 * and a display name for any ISO code a model lists (the composer's "Spoken language" picker).
 * Plain data, shared by the catalog (the open models' `sourceLanguages`), the ComfyUI provider
 * (src/lib/comfy.ts maps a code to the node's value) and the UI.
 */

/** Languages ComfyUI-QwenASR's subtitle node accepts (besides "auto"), by ISO 639 code. */
export const ASR_LANGUAGES: Record<string, string> = {
  zh: "Chinese", en: "English", yue: "Cantonese", ar: "Arabic", de: "German", fr: "French", es: "Spanish", pt: "Portuguese",
  id: "Indonesian", it: "Italian", ko: "Korean", ru: "Russian", th: "Thai", vi: "Vietnamese", ja: "Japanese", tr: "Turkish",
  hi: "Hindi", ms: "Malay", nl: "Dutch", sv: "Swedish", da: "Danish", fi: "Finnish", pl: "Polish", cs: "Czech", fil: "Filipino",
  tl: "Filipino", fa: "Persian", el: "Greek", hu: "Hungarian", mk: "Macedonian", ro: "Romanian",
};

/**
 * Whisper's 100 languages (openai-whisper tokenizer.LANGUAGES), code → name. ComfyUI-Whisper's language combo
 * offers the same names with a capital first letter ("Haitian creole", "Tagalog").
 */
export const WHISPER_LANGUAGES: Record<string, string> = Object.fromEntries(
  (
    "en english,zh chinese,de german,es spanish,ru russian,ko korean,fr french,ja japanese,pt portuguese,tr turkish,pl polish,ca catalan," +
    "nl dutch,ar arabic,sv swedish,it italian,id indonesian,hi hindi,fi finnish,vi vietnamese,he hebrew,uk ukrainian,el greek,ms malay," +
    "cs czech,ro romanian,da danish,hu hungarian,ta tamil,no norwegian,th thai,ur urdu,hr croatian,bg bulgarian,lt lithuanian,la latin," +
    "mi maori,ml malayalam,cy welsh,sk slovak,te telugu,fa persian,lv latvian,bn bengali,sr serbian,az azerbaijani,sl slovenian,kn kannada," +
    "et estonian,mk macedonian,br breton,eu basque,is icelandic,hy armenian,ne nepali,mn mongolian,bs bosnian,kk kazakh,sq albanian," +
    "sw swahili,gl galician,mr marathi,pa punjabi,si sinhala,km khmer,sn shona,yo yoruba,so somali,af afrikaans,oc occitan,ka georgian," +
    "be belarusian,tg tajik,sd sindhi,gu gujarati,am amharic,yi yiddish,lo lao,uz uzbek,fo faroese,ht haitian creole,ps pashto,tk turkmen," +
    "nn nynorsk,mt maltese,sa sanskrit,lb luxembourgish,my myanmar,bo tibetan,tl tagalog,mg malagasy,as assamese,tt tatar,haw hawaiian," +
    "ln lingala,ha hausa,ba bashkir,jw javanese,su sundanese,yue cantonese"
  )
    .split(",")
    .map((pair) => {
      const i = pair.indexOf(" ");
      const name = pair.slice(i + 1);
      return [pair.slice(0, i), name.charAt(0).toUpperCase() + name.slice(1)];
    }),
);

const NAMES: Record<string, string> = { ...WHISPER_LANGUAGES, ...ASR_LANGUAGES, nb: "Norwegian", jv: "Javanese" };

let display: Intl.DisplayNames | null | undefined;

/** "de" → "German", "yue" → "Cantonese", "jw" → "Javanese": the browser's (or Node's) English name, else the tables', else the code. */
export function spokenLanguageName(code: string): string {
  if (display === undefined) {
    try {
      display = new Intl.DisplayNames(["en"], { type: "language" });
    } catch {
      display = null;
    }
  }
  let name: string | undefined;
  try {
    name = display?.of(code);
  } catch {
    // Not a well-formed language tag (Whisper's "jw").
  }
  return name && name.toLowerCase() !== code.toLowerCase() ? name : (NAMES[code] ?? code);
}

/** A model's spoken-language codes as picker entries, by name (duplicates and aliases of one name dropped). */
export function spokenLanguageOptions(codes: readonly string[]): { code: string; name: string }[] {
  const seen = new Set<string>();
  const out: { code: string; name: string }[] = [];
  for (const code of codes) {
    const name = spokenLanguageName(code);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ code, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/**
 * The code in a model's list that means `value`: the code itself (any case), its base language
 * ("es-MX", "pt_BR", "German (de)"), or its English name ("Spanish", as Assist stores it), also when
 * the list names that language by another code. Undefined when the model doesn't list it.
 */
export function matchSpokenLanguage(value: string, codes: readonly string[]): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  const find = (code: string) => codes.find((c) => c.toLowerCase() === code.toLowerCase());
  const exact = find(v);
  if (exact) return exact;
  const base = /\(([a-z]{2,3})\)\s*$/i.exec(v)?.[1] ?? /^([a-z]{2,3})(?:[-_][a-z0-9]+)+$/i.exec(v)?.[1];
  const byBase = base && find(base);
  if (byBase) return byBase;
  const name = (base || /^[a-z]{2,3}$/i.test(v) ? spokenLanguageName((base ?? v).toLowerCase()) : v).toLowerCase();
  return codes.find((c) => spokenLanguageName(c).toLowerCase() === name);
}
