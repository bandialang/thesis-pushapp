import fs from "node:fs";
import path from "node:path";

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const delimiterIndex = trimmed.indexOf("=");
    if (delimiterIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, delimiterIndex).trim();
    const value = trimmed.slice(delimiterIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function toInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanString(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim();
}

function parseDailySendTimes(value) {
  const raw = cleanString(value, "07:00,15:00") || "07:00,15:00";
  const parts = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const parsed = parts
    .map((item) => {
      const match = item.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) {
        return null;
      }

      const hour = Number.parseInt(match[1], 10);
      const minute = Number.parseInt(match[2], 10);
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
      }

      return { hour, minute, label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
    })
    .filter(Boolean);

  return parsed.length > 0 ? parsed : [{ hour: 7, minute: 0, label: "07:00" }, { hour: 15, minute: 0, label: "15:00" }];
}

export const config = {
  port: toInt(process.env.PORT, 3000),
  timezone: cleanString(process.env.TIMEZONE, "Asia/Seoul") || "Asia/Seoul",
  dailySendTimes: parseDailySendTimes(process.env.DAILY_SEND_TIMES),
  paperCount: toInt(process.env.PAPER_COUNT, 5),
  lookbackDays: toInt(process.env.LOOKBACK_DAYS, 45),
  noRepeatDays: toInt(process.env.NO_REPEAT_DAYS, 14),
  stateFilePath: cleanString(process.env.STATE_FILE_PATH) || path.resolve(process.cwd(), "data", "history.json"),
  authFilePath: cleanString(process.env.AUTH_FILE_PATH) || path.resolve(process.cwd(), "data", "auth.json"),
  kakaoAccessToken: cleanString(process.env.KAKAO_ACCESS_TOKEN),
  kakaoRefreshToken: cleanString(process.env.KAKAO_REFRESH_TOKEN),
  kakaoClientId: cleanString(process.env.KAKAO_CLIENT_ID),
  kakaoClientSecret: cleanString(process.env.KAKAO_CLIENT_SECRET),
  kakaoRedirectUri: cleanString(process.env.KAKAO_REDIRECT_URI),
  kciApiKey: cleanString(process.env.KCI_API_KEY)
};
