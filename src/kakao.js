import { config } from "./config.js";
import { loadAuthState, updateAuthState } from "./auth-state.js";

function requireValue(name, value) {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
}

export function buildKakaoAuthorizeUrl() {
  requireValue("KAKAO_CLIENT_ID", config.kakaoClientId);
  requireValue("KAKAO_REDIRECT_URI", config.kakaoRedirectUri);

  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.searchParams.set("client_id", config.kakaoClientId);
  url.searchParams.set("redirect_uri", config.kakaoRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "talk_message");
  return url.toString();
}

export async function exchangeCodeForToken(code) {
  requireValue("KAKAO_CLIENT_ID", config.kakaoClientId);
  requireValue("KAKAO_REDIRECT_URI", config.kakaoRedirectUri);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.kakaoClientId,
    redirect_uri: config.kakaoRedirectUri,
    code
  });

  if (config.kakaoClientSecret) {
    body.set("client_secret", config.kakaoClientSecret);
  }

  const response = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  updateAuthState(payload);
  return payload;
}

export async function refreshAccessToken() {
  requireValue("KAKAO_CLIENT_ID", config.kakaoClientId);

  const authState = loadAuthState();
  const refreshToken = authState.refreshToken || config.kakaoRefreshToken;
  requireValue("KAKAO_REFRESH_TOKEN", refreshToken);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.kakaoClientId,
    refresh_token: refreshToken
  });

  if (config.kakaoClientSecret) {
    body.set("client_secret", config.kakaoClientSecret);
  }

  const response = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return updateAuthState(payload);
}

function getCurrentAccessToken() {
  const authState = loadAuthState();
  return authState.accessToken || config.kakaoAccessToken;
}

async function sendMemoRequest(accessToken, text) {
  requireValue("KAKAO_ACCESS_TOKEN", accessToken);

  const templateObject = {
    object_type: "text",
    text,
    link: {
      web_url: "https://arxiv.org",
      mobile_web_url: "https://arxiv.org"
    },
    button_title: "논문 보러 가기"
  };

  const body = new URLSearchParams({
    template_object: JSON.stringify(templateObject)
  });

  const response = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = await response.json();

  if (response.status === 401) {
    const error = new Error(`Kakao send unauthorized: ${JSON.stringify(payload)}`);
    error.name = "KakaoUnauthorizedError";
    throw error;
  }

  if (!response.ok || payload.result_code !== 0) {
    throw new Error(`Kakao send failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export async function sendMemoToMe(text) {
  try {
    return await sendMemoRequest(getCurrentAccessToken(), text);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "KakaoUnauthorizedError") {
      throw error;
    }

    const refreshed = await refreshAccessToken();
    return sendMemoRequest(refreshed.accessToken, text);
  }
}
