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

export async function runDailyRecommendation(dateKey = getDateKey(config.timezone)) {
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
    papers: selection.papers
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

function scheduleNextRun(task) {
  const now = new Date();
  let next = null;

  for (const sendTime of config.dailySendTimes) {
    const candidate = new Date(now);
    candidate.setHours(sendTime.hour, sendTime.minute, 0, 0);

    if (candidate > now && (!next || candidate < next)) {
      next = candidate;
    }
  }

  if (!next) {
    const first = config.dailySendTimes[0];
    next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(first.hour, first.minute, 0, 0);
  }

  const delay = next.getTime() - now.getTime();
  console.log(`[scheduler] next send at ${next.toISOString()}`);

  setTimeout(async () => {
    try {
      const result = await task();
      console.log(`[scheduler] sent ${result.selection.papers.length} papers for ${result.selection.dateKey}`);
    } catch (error) {
      console.error("[scheduler] failed:", error);
    } finally {
      scheduleNextRun(task);
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
        const result = await runDailyRecommendation(requestedDateKey);
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

  scheduleNextRun(runDailyRecommendation);
  return server;
}
