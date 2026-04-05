import http from "node:http";
import { config } from "./config.js";
import { buildKakaoAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, sendMemoToMe } from "./kakao.js";
import { buildRecommendationMessage, getDailyPaperSelection } from "./papers.js";
import { loadAuthState } from "./auth-state.js";
import { loadState, recordSentSelection } from "./state.js";

function getDateKey(timezone) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getDateTimeParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number.parseInt(part.value, 10)])
  );
}

function getTimeZoneOffsetMs(date, timezone) {
  const parts = getDateTimeParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function getZonedDate(timezone, year, month, day, hour, minute, second = 0) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstPass = new Date(utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timezone));
  return new Date(utcGuess - getTimeZoneOffsetMs(firstPass, timezone));
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getScheduledSlotsForDate(dateKey, timezone) {
  const [year, month, day] = dateKey.split("-").map((value) => Number.parseInt(value, 10));

  return config.dailySendTimes.map((sendTime) => ({
    ...sendTime,
    dateKey,
    slotKey: `${dateKey}T${sendTime.label}`,
    scheduledAt: getZonedDate(timezone, year, month, day, sendTime.hour, sendTime.minute)
  }));
}

export async function runDailyRecommendation({ dateKey = getDateKey(config.timezone), slotKey = null } = {}) {
  const state = loadState();
  const selection = await getDailyPaperSelection({
    count: config.paperCount,
    lookbackDays: config.lookbackDays,
    dateKey,
    noRepeatDays: config.noRepeatDays,
    sentHistory: state.sentHistory
  });

  const message = buildRecommendationMessage(selection);
  const delivery = await sendMemoToMe(message);
  recordSentSelection({
    dateKey: selection.dateKey,
    papers: selection.papers,
    slotKey
  });

  return {
    selection,
    delivery
  };
}

function jsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function textResponse(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

async function runScheduledRecommendation(slot) {
  const result = await runDailyRecommendation({ dateKey: slot.dateKey, slotKey: slot.slotKey });
  console.log(`[scheduler] sent ${result.selection.papers.length} papers for ${slot.slotKey}`);
  return result;
}

async function sendMissedRunsForToday() {
  const now = new Date();
  const todayDateKey = getDateKey(config.timezone);
  const sentRuns = new Set((loadState().sentRuns || []).map((entry) => entry.slotKey));
  const pendingSlots = getScheduledSlotsForDate(todayDateKey, config.timezone)
    .filter((slot) => slot.scheduledAt <= now && !sentRuns.has(slot.slotKey))
    .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());

  for (const slot of pendingSlots) {
    console.log(`[scheduler] recovering missed send for ${slot.slotKey}`);
    try {
      await runScheduledRecommendation(slot);
    } catch (error) {
      console.error(`[scheduler] recovery failed for ${slot.slotKey}:`, error);
    }
  }
}

function scheduleNextRun() {
  const now = new Date();
  const todayDateKey = getDateKey(config.timezone);
  const tomorrowDateKey = addDaysToDateKey(todayDateKey, 1);
  const next = [...getScheduledSlotsForDate(todayDateKey, config.timezone), ...getScheduledSlotsForDate(tomorrowDateKey, config.timezone)]
    .filter((slot) => slot.scheduledAt > now)
    .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime())[0];

  if (!next) {
    throw new Error("No next scheduled run could be determined.");
  }

  const delay = next.scheduledAt.getTime() - now.getTime();
  console.log(`[scheduler] next send at ${next.scheduledAt.toISOString()} (${config.timezone} ${next.slotKey})`);

  setTimeout(async () => {
    try {
      await runScheduledRecommendation(next);
    } catch (error) {
      console.error(`[scheduler] failed for ${next.slotKey}:`, error);
    } finally {
      scheduleNextRun();
    }
  }, delay);
}

export function startServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse(response, 200, { ok: true });
      }

      if (request.method === "GET" && url.pathname === "/auth/status") {
        const authState = loadAuthState();
        return jsonResponse(response, 200, {
          ok: Boolean(authState.accessToken),
          hasAccessToken: Boolean(authState.accessToken),
          hasRefreshToken: Boolean(authState.refreshToken),
          updatedAt: authState.updatedAt
        });
      }

      if (request.method === "GET" && url.pathname === "/oauth/kakao/start") {
        response.writeHead(302, { Location: buildKakaoAuthorizeUrl() });
        return response.end();
      }

      if (request.method === "GET" && url.pathname === "/oauth/kakao/callback") {
        const code = url.searchParams.get("code");
        if (!code) {
          return textResponse(response, 400, "Missing Kakao authorization code.");
        }

        const tokenResponse = await exchangeCodeForToken(code);
        return jsonResponse(response, 200, {
          message: "Copy these tokens into your .env file.",
          tokenResponse
        });
      }

      if (request.method === "POST" && url.pathname === "/oauth/kakao/refresh") {
        const tokenResponse = await refreshAccessToken();
        return jsonResponse(response, 200, {
          ok: true,
          tokenResponse: {
            hasAccessToken: Boolean(tokenResponse.accessToken),
            hasRefreshToken: Boolean(tokenResponse.refreshToken),
            updatedAt: tokenResponse.updatedAt
          }
        });
      }

      if (request.method === "POST" && url.pathname === "/send-now") {
        const requestedDateKey = url.searchParams.get("date") || getDateKey(config.timezone);
        const result = await runDailyRecommendation({ dateKey: requestedDateKey });
        return jsonResponse(response, 200, {
          ok: true,
          dateKey: result.selection.dateKey,
          sentCount: result.selection.papers.length
        });
      }

      if (request.method === "GET" && url.pathname === "/preview") {
        const requestedDateKey = url.searchParams.get("date") || getDateKey(config.timezone);
        const state = loadState();
        const selection = await getDailyPaperSelection({
          count: config.paperCount,
          lookbackDays: config.lookbackDays,
          dateKey: requestedDateKey,
          noRepeatDays: config.noRepeatDays,
          sentHistory: state.sentHistory
        });

        return textResponse(response, 200, buildRecommendationMessage(selection));
      }

      return jsonResponse(response, 404, { error: "Not found" });
    } catch (error) {
      console.error("[server] request failed:", error);
      return jsonResponse(response, 500, {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  server.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    console.log(`[server] preview: http://localhost:${config.port}/preview`);
    console.log(`[server] manual send: curl -X POST http://localhost:${config.port}/send-now`);
    console.log(`[server] no repeat window: ${config.noRepeatDays} days`);
    console.log(`[server] daily send times: ${config.dailySendTimes.map((item) => item.label).join(", ")}`);
    console.log(`[server] auth status: http://localhost:${config.port}/auth/status`);

    if (config.kakaoClientId && config.kakaoRedirectUri) {
      console.log(`[server] kakao auth: http://localhost:${config.port}/oauth/kakao/start`);
      console.log(`[server] kakao redirect uri: ${config.kakaoRedirectUri}`);
    }
  });

  void sendMissedRunsForToday();
  scheduleNextRun();
  return server;
}
