import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

function ensureDirectoryExists(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getEmptyAuthState() {
  return {
    accessToken: config.kakaoAccessToken || "",
    refreshToken: config.kakaoRefreshToken || "",
    expiresIn: null,
    refreshTokenExpiresIn: null,
    updatedAt: null
  };
}

export function loadAuthState() {
  ensureDirectoryExists(config.authFilePath);

  if (!fs.existsSync(config.authFilePath)) {
    return getEmptyAuthState();
  }

  try {
    const raw = fs.readFileSync(config.authFilePath, "utf8");
    const parsed = JSON.parse(raw);

    return {
      ...getEmptyAuthState(),
      ...parsed
    };
  } catch {
    return getEmptyAuthState();
  }
}

export function saveAuthState(authState) {
  ensureDirectoryExists(config.authFilePath);
  fs.writeFileSync(config.authFilePath, `${JSON.stringify(authState, null, 2)}\n`, "utf8");
}

export function updateAuthState(tokenPayload) {
  const current = loadAuthState();
  const next = {
    ...current,
    updatedAt: new Date().toISOString()
  };

  if (tokenPayload.access_token) {
    next.accessToken = tokenPayload.access_token;
  }

  if (tokenPayload.refresh_token) {
    next.refreshToken = tokenPayload.refresh_token;
  }

  if (typeof tokenPayload.expires_in === "number") {
    next.expiresIn = tokenPayload.expires_in;
  }

  if (typeof tokenPayload.refresh_token_expires_in === "number") {
    next.refreshTokenExpiresIn = tokenPayload.refresh_token_expires_in;
  }

  saveAuthState(next);
  return next;
}
