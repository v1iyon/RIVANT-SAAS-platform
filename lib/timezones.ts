// Общие хелперы для работы с IANA-таймзонами.
//
// Вынесено сюда из app/dashboard/page.tsx — один источник правды для
// списка/группировки/лейблов вместо двух копий (нужен ещё и в
// components/dashboard/onboarding-tour.tsx для обязательного шага
// тайм-зоны в онбординге).

export const FALLBACK_TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Europe/Kyiv", "Europe/Moscow",
  "Africa/Cairo", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo",
  "Asia/Shanghai", "Australia/Sydney", "Pacific/Auckland",
];

export function getAllTimezones(): string[] {
  try {
    // @ts-ignore
    if (typeof Intl.supportedValuesOf === "function") {
      // @ts-ignore
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {}
  return FALLBACK_TIMEZONES;
}

export function getTimezoneOffset(tz: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
    const parts = formatter.formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || "";
  } catch {
    return "";
  }
}

export function formatTimezoneLabel(tz: string): string {
  const offset = getTimezoneOffset(tz);
  const cityName = tz.split("/").pop()?.replace(/_/g, " ") || tz;
  return offset ? `${cityName} (${offset})` : tz;
}

export function groupTimezonesByRegion(zones: string[]): Record<string, string[]> {
  const regionNames: Record<string, string> = {
    Africa: "Africa",
    America: "America",
    Antarctica: "Antarctica",
    Asia: "Asia",
    Atlantic: "Atlantic",
    Australia: "Australia",
    Europe: "Europe",
    Indian: "Indian Ocean",
    Pacific: "Pacific",
    UTC: "UTC",
  };
  const groups: Record<string, string[]> = {};
  for (const tz of zones) {
    const region = tz.split("/")[0];
    const label = regionNames[region] || "Other";
    if (!groups[label]) groups[label] = [];
    groups[label].push(tz);
  }
  const order = ["UTC", "Europe", "Asia", "Africa", "America", "Australia", "Pacific", "Atlantic", "Indian Ocean", "Antarctica", "Other"];
  const sorted: Record<string, string[]> = {};
  for (const key of order) {
    if (groups[key]) sorted[key] = groups[key].sort();
  }
  return sorted;
}

export function getDetectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}