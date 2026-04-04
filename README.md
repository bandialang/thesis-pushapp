# Thesis PushApp

만화, 애니메이션, 텍스트마이닝 관련 논문을 매일 골라서 카카오톡 "나에게 보내기"로 전송하는 간단한 Node.js 서비스입니다.

## 포함 기능

- `arXiv`에서 주제별 최신 논문 후보 수집
- 날짜 기반 시드로 매일 다른 논문 조합 추천
- 최근 발송 이력을 저장해 같은 논문 재등장 방지
- 카카오톡 REST API를 이용한 내 카카오 메시지 발송
- 카카오 액세스 토큰 자동 재발급 시도
- KCI, RISS를 통한 한글 논문 소스 확장
- 수동 미리보기 `/preview`
- 수동 발송 `/send-now`
- 매일 여러 지정 시각 자동 발송

## 빠른 시작

1. `.env.example`를 복사해 `.env`를 만듭니다.
2. 카카오 개발자 콘솔에서 앱을 생성하고 `talk_message` 권한을 설정합니다.
3. `.env`에 `KAKAO_CLIENT_ID`, `KAKAO_REDIRECT_URI`를 채웁니다.
4. 서버 실행:

```bash
npm start
```

5. 브라우저에서 아래 URL을 열어 카카오 인증을 마칩니다.

```text
http://localhost:3000/oauth/kakao/start
```

6. 콜백 응답이 오면 토큰이 `data/auth.json`에 자동 저장됩니다.
7. 아래로 메시지 발송을 시험합니다.

```bash
curl -X POST http://localhost:3000/send-now
```

8. 토큰 상태는 아래에서 확인할 수 있습니다.

```text
http://localhost:3000/auth/status
```

## Railway 배포

항상 켜두는 용도로는 Railway가 가장 간단합니다.

1. GitHub에 이 프로젝트를 올립니다.
2. Railway에서 `New Project`로 GitHub 저장소를 연결합니다.
3. 서비스가 생성되면 `Persistent Service`로 배포합니다.
4. `Volume`을 추가하고 mount path를 `/app/data`로 설정합니다.
5. Railway Variables에 아래 값을 넣습니다.

```text
TIMEZONE=Asia/Seoul
DAILY_SEND_TIMES=07:00,15:00
PAPER_COUNT=5
LOOKBACK_DAYS=45
NO_REPEAT_DAYS=14
STATE_FILE_PATH=/app/data/history.json
AUTH_FILE_PATH=/app/data/auth.json
KAKAO_CLIENT_ID=...
KAKAO_CLIENT_SECRET=...
KAKAO_REDIRECT_URI=https://<your-railway-domain>/oauth/kakao/callback
KAKAO_ACCESS_TOKEN=...
KAKAO_REFRESH_TOKEN=...
```

6. Railway가 발급한 도메인을 카카오 Redirect URI에도 추가합니다.
7. 배포 후 `https://<your-railway-domain>/health`로 서버 상태를 확인합니다.

배포 후에는 `localhost` 대신 Railway 도메인을 써야 합니다.

예:

```text
https://your-app.up.railway.app/oauth/kakao/callback
```

## 환경 변수

- `PORT`: 서버 포트
- `TIMEZONE`: 추천 날짜 계산 기준 타임존
- `DAILY_SEND_TIMES`: 자동 발송 시각 목록. 예: `07:00,15:00`
- `PAPER_COUNT`: 하루 추천 논문 수
- `LOOKBACK_DAYS`: 최근 며칠 내 논문을 후보군으로 볼지
- `NO_REPEAT_DAYS`: 최근 며칠 동안 보낸 논문은 다시 추천하지 않을지
- `STATE_FILE_PATH`: 발송 이력 JSON 저장 위치
- `AUTH_FILE_PATH`: 카카오 토큰 JSON 저장 위치
- `KAKAO_ACCESS_TOKEN`: 메시지 발송용 액세스 토큰
- `KAKAO_REFRESH_TOKEN`: 필요 시 확장용 리프레시 토큰
- `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`, `KAKAO_REDIRECT_URI`: OAuth 인증용 설정
- `KCI_API_KEY`: KCI Open API 인증키

## 참고

- 현재 추천 소스는 `arXiv`입니다.
- 추천 소스는 `arXiv`, `KCI`, `RISS`입니다. 다만 `KCI`는 인증키가 있어야 활성화됩니다.
- 같은 날짜에는 같은 추천이 유지되고, 날짜가 바뀌면 추천이 바뀝니다.
- 최근 `NO_REPEAT_DAYS` 안에 보낸 논문은 우선 제외합니다.
- 후보 풀이 너무 좁으면, 추천 수를 채우기 위해 오래된 논문이 일부 다시 들어올 수 있습니다.
- 액세스 토큰이 만료되면 저장된 리프레시 토큰으로 자동 재발급을 시도합니다.
- 기본 자동 발송 시각은 `07:00`, `15:00`입니다.
- 카카오 메시지 API는 카카오 개발자 설정과 동의 절차가 완료되어야 동작합니다.
