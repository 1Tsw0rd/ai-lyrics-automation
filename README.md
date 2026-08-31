# ai-lyrics-automation

AI를 이용한 음악 제작 보조 자동화 프로젝트.

이 프로젝트는 두 가지 방식의 AI를 사용한다.

* **AI API** — 앨범별 기획 데이터를 기준으로 Claude API를 이용해 가사를 생성하고, 검토와 수정을 반복한 뒤 한국어 번역까지 처리한다.

  **가사 생성 시연**
  [demo-lyrics.mp4](./demo/demo-lyrics.mp4)

* **로컬 AI** — 완성된 음악을 로컬에 설치된 Whisper로 처리하여 SRT 자막을 추출한다.

  **자막 추출 시연**
  [demo-subtitle.mp4](./demo/demo-subtitle.mp4)

---

## 1. 준비사항

- Node.js: https://nodejs.org/ko/download
- NVM (선택사항): https://www.nvmnode.com/ko/guide/download.html
- Claude API Key: https://platform.claude.com/

- Python: https://www.python.org/downloads/
- OpenAI Whisper: `pip install -U openai-whisper`
- ffmpeg (Whisper 오디오 디코딩에 필요)
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: https://ffmpeg.org/download.html

### 기술 스택

- Node.js
- Claude API
- Python (OpenAI Whisper 실행용)
- OpenAI Whisper

---

## 2. 실행

```bash
npm install              # 의존성 설치
npm run lyrics            # 가사 생성
npm run srt               # 자막 생성
npm run srt:y             # 기존 자막이 있어도 덮어쓰기
```

---

## 3. 디렉터리 및 파일 구조

```text
ai-lyrics-automation/
├── .env
├── .env.example
├── .gitignore
├── LICENSE
├── LICENSE-MUSIC
├── README.md
├── package.json
│
├── demo/                                  # 데모 영상
│   ├── demo-lyrics.mp4
│   └── demo-subtitle.mp4
│
├── lyrics/
│   ├── index.claude.js                    # 가사 자동화 실행 파일
│   ├── album/                             # 앨범별 기획 데이터와 규칙
│   │   ├── 1_Sample.json                  # 트랙 정보와 작업 상태
│   │   └── 1_Sample.txt                   # 앨범별 장르·콘셉트·가사 규칙
│   ├── rules/                             # 공통 AI 프롬프트 규칙
│   │   └── rules.json                     # 가사 생성·검토·번역 규칙
│   ├── output/                            # 완성된 가사 결과물
│   │   └── 1_Sample/                      # 결과물 저장할 앨범 디렉터리
│   │         └── 1.Rain_on_the_Window.txt # 결과물 가사
│   └── logs/                              # 실행 로그
│        └── 2026-08-31-17-21-56_1_Sample_Album.log   # 상세 로그 샘플
│
└── subtitle/
    ├── index.srt.js                     # MP3 → SRT 자막 추출 실행 파일
    └── music/                           # MP3 입력 파일과 SRT 결과 파일
        ├── *.mp3
        └── *.srt
```

---

## 4. 아키텍처

```text
                    ai-lyrics-automation
                             │
              ┌──────────────┴──────────────┐
              │                             │
          lyrics/                        subtitle/
              │                             │
    외부 Claude API                   Local Whisper
              │                             │
   ┌──────────┼──────────┐                  │
   │          │          │                  │
Generate    Review    Translate             │
   │          │          │                  │
   └──────┬───┴──────────┘                  │
          │                                 │
       txt/json                           .srt
```

---

## 5. 환경 변수

`.env`에서 실행에 필요한 값을 설정한다.

| 변수 | 설명 |
|---|---|
| `CLAUDE_API_KEY` | Claude API 인증 키 |
| `ENABLE_THINKING` | Claude thinking 사용 여부 |
| `CLAUDE_GENERATE_MODEL` | 가사 생성에 사용할 Claude 모델 |
| `CLAUDE_REVIEW_MODEL` | 가사 검토에 사용할 Claude 모델 |
| `CLAUDE_TRANSLATE_MODEL` | 한국어 번역에 사용할 Claude 모델 |
| `DEBUG_MODE` | Claude 요청/응답 상세 로그 기록 여부 |
| `START_ALBUM` | 처리를 시작할 앨범 번호 |
| `END_ALBUM` | 처리를 종료할 앨범 번호. `0`이면 마지막 앨범까지 처리 |
| `MAX_ROUNDS` | 가사 생성 및 검토의 최대 반복 횟수 |
| `SLEEP_LYRICS_MS` | 가사 생성/검토 API 호출 사이의 대기 시간(ms) |
| `SLEEP_TRANSLATE_MS` | 번역 API 호출 전 대기 시간(ms) |

### 앨범 처리 범위 예시

앨범 파일은 `앨범번호_앨범이름.json` 형식으로 관리한다.

예를 들어:

```text
7_new_world.json
```

은 **7번 앨범**을 의미한다.

`.env`가 다음과 같다면:

```dotenv
START_ALBUM=8
END_ALBUM=10
```

다음과 같이 처리된다.

```text
6_....json
7_....json
8_....json    ← 작업 대상
9_....json    ← 작업 대상
10_....json   ← 작업 대상
11_....json
```

`END_ALBUM=0`으로 설정하면 시작 앨범부터 마지막 앨범까지 처리한다.

```dotenv
START_ALBUM=8
END_ALBUM=0
```

---

## 6. 가사 생성

### 흐름

```text
앨범/트랙 정보
    ↓
Claude 가사 생성
    ↓
Claude 가사 검토
    │
    ├─ PASS → Claude 번역 → txt 저장
    │
    └─ REVISION → 피드백 반영 → 다시 생성
```

가사 생성은 `lyrics/index.claude.js`에서 처리한다.

앨범별 규칙과 공통 규칙을 함께 사용하여 Claude에 가사 생성과 검토를 요청한다.

### 앨범 파일

앨범은 `.json`과 `.txt` 파일로 관리한다.

```text
lyrics/album/
├── 1_Sample.json
└── 1_Sample.txt
```

#### `.json`

트랙 정보와 현재 처리 상태를 저장한다.

```json
{
  "id": 1,
  "title": "Rain on the Window",
  "concept": "비 오는 창가 앞, 아무 생각 없이 앉아 있는 상태.",
  "status": "todo"
}
```

#### `.txt`

앨범의 장르, 분위기, 가사 규칙, 트랙별 소재 등을 정의한다.

### 트랙 상태

| 상태 | 설명 |
|---|---|
| `todo` | 작업 대상 |
| `processing` | 현재 작업 중 |
| `lyrics_done` | 가사 생성 및 검토 완료, 번역 대기 |
| `done` | 가사와 번역까지 완료 |
| `error` | 최대 반복 횟수 초과 등으로 작업이 완료되지 않은 트랙 |

프로그램은 `todo`, `processing`, `error`, `lyrics_done` 상태의 트랙을 작업 대상으로 확인한다.

### 생성 및 검토

1. Claude가 앨범 규칙과 트랙 콘셉트를 기준으로 가사를 생성한다.
2. 생성된 가사를 Claude가 검토한다.
3. 검토 결과가 `PASS`이면 번역 단계로 이동한다.
4. `REVISION`이면 피드백을 반영하여 가사를 다시 생성한다.
5. 이 과정을 `MAX_ROUNDS` 횟수까지 반복한다.
6. 최대 횟수 안에 `PASS`가 나오지 않으면 해당 트랙을 `error` 상태로 저장한다.

검토 응답은 다음과 같이 시작한다.

```text
PASS
```

또는

```text
REVISION
```

### 참고사항

Claude에는 `system prompt`와 `user prompt`를 구분하여 전달하며, `REVISION` 발생 시 현재 가사와 이전 피드백을 다음 요청에 함께 전달한다. 번역 단계에서는 최종 가사와 번역 규칙을 전달한다.

**Generate**

```text
System → 앨범 규칙(예: 1_Sample.txt) + 생성 규칙(rules.json > lyric_generate_prompt)
User   → 곡 제목(예: 1_Sample.json > title) + 곡 설명(예: 1_Sample.json > concept)
```

**Review**

```text
System → 앨범 규칙(예: 1_Sample.txt) + 검토 규칙(rules.json > lyric_review_checklist)
User   → 곡 정보(예: 1_Sample.json > title, concept)
         + 현재 가사(예: 1_Sample.json > lyrics)
         + 이전 피드백 (REVISION 이후 Claude 응답)
```

**Translate**

```text
System → 앨범 규칙(예: 1_Sample.txt) + 번역 규칙(rules.json > lyric_translate_rule)
User   → 최종 가사(예: 1_Sample.json > lyrics)
```

### 결과 파일

`PASS`된 가사는 한국어 번역을 추가한 뒤 `lyrics/output/` 아래에 저장한다.

예:

```text
lyrics/output/1_Test/1.Rain_on_the_Window.txt
```

파일에는 영어 가사와 줄별 한국어 번역이 함께 저장된다.

```text
1. Rain on the Window
비 오는 창가 앞, 아무 생각 없이 앉아 있는 상태.

[Verse 1]
Gray light coming through the bus stop glass

...
====================

[Verse 1]
Gray light coming through the bus stop glass
회색빛이 버스 정류장 유리로 스며들고
```

### 로그

실행 로그는 `lyrics/logs/`에 저장한다.

기본적으로 앨범, 트랙, Round, PASS/ERROR, 번역 완료 등의 처리 과정이 기록된다.

`DEBUG_MODE=true`로 설정하면 Claude API 요청과 응답의 상세 내용도 기록한다.

---

## 7. 자막 추출

완성된 MP3를 `subtitle/music/`에 넣고 다음 명령어를 실행한다.

```bash
npm run srt
```

폴더 안의 MP3 파일을 찾아 로컬 Whisper로 SRT 자막을 생성한다.

기존에 같은 이름의 `.srt` 파일이 있으면 다시 생성할지 확인한다.

```text
다시 만들까요? (y/N)
```

- `y` : 다시 생성
- 그 외 입력 : 기존 SRT 유지

확인 없이 기존 SRT를 덮어쓰려면:

```bash
npm run srt:y
```

### 참고사항

> 생성된 SRT는 가사와 다를 수 있으므로 사용 전에 검토가 필요하다.

---

## 8. 라이선스

- Source code: MIT License
- Music / audio: CC BY 4.0

자세한 내용은 `LICENSE`와 `LICENSE-MUSIC`을 참고한다.
