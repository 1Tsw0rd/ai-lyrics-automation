# ai-lyrics-automation

[한국어](./README.md) | **English**

```text
┌──────────────────────────────────────────┐
│          AI · CLAUDE · WHISPER           │
│      Music Production Automation         │
└──────────────────────────────────────────┘
```

An AI-assisted music production automation project.

This project uses two types of AI.

* **AI API** — Uses the Claude API to generate lyrics based on album planning data, repeatedly review and revise them, and then translate them into Korean.

  **Lyrics generation demo**
  [demo-lyrics.mp4](./demo/demo-lyrics.mp4)

* **Local AI** — Uses locally installed Whisper to process completed music and extract SRT subtitles.

  **Subtitle extraction demo**
  [demo-subtitle.mp4](./demo/demo-subtitle.mp4)

---

## 1. Requirements

- Node.js: https://nodejs.org/ko/download
- NVM (optional): https://www.nvmnode.com/ko/guide/download.html
- Claude API Key: https://platform.claude.com/

- Python: https://www.python.org/downloads/
- OpenAI Whisper: `pip install -U openai-whisper`
- ffmpeg (required for Whisper audio decoding)
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: https://ffmpeg.org/download.html

### Tech Stack

- Node.js
- Claude API
- Python (for running OpenAI Whisper)
- OpenAI Whisper

---

## 2. Run

```bash
npm install              # install dependencies
npm run lyrics            # generate lyrics
npm run srt               # generate subtitles
npm run srt:y             # overwrite existing subtitles
```

---

## 3. Directory and File Structure

```text
ai-lyrics-automation/
├── .env
├── .env.example
├── .gitignore
├── LICENSE
├── LICENSE-MUSIC
├── README.en.md
├── README.md
├── package.json
│
├── demo/                                  # demo videos
│   ├── demo-lyrics.mp4
│   └── demo-subtitle.mp4
│
├── lyrics/
│   ├── index.claude.js                    # lyrics generation/review/translation
│   ├── album/                             # album planning data and rules
│   │   ├── 1_Sample.json                  # track information and status
│   │   └── 1_Sample.txt                   # album genre, concept, and lyric rules
│   ├── rules/                             # common AI prompt rules
│   │   └── rules.json                     # lyric generation/review/translation rules
│   ├── output/                            # completed lyric results
│   │   └── 1_Sample/                      # album result directory
│   │         └── 1.Rain_on_the_Window.txt # lyric result
│   └── logs/                              # execution logs
│        ├── 2026-08-31-17-21-56_1_Sample_Album.log   # detailed log sample (DEBUG_MODE=true)
│        └── 2026-08-31-18-02-26_1_Sample_Album.log   # normal log sample (DEBUG_MODE=false)
│
└── subtitle/
    ├── index.srt.js                     # MP3 → SRT subtitle extraction
    └── music/                           # MP3 input files and SRT results
        ├── *.mp3
        └── *.srt
```

---

## 4. Architecture

```text
                    ai-lyrics-automation
                             │
              ┌──────────────┴──────────────┐
              │                             │
          lyrics/                        subtitle/
              │                             │
       External Claude API             Local Whisper
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

## 5. Environment Variables

Configure the required values in `.env`.

| Variable | Description |
|---|---|
| `CLAUDE_API_KEY` | Claude API authentication key |
| `ENABLE_THINKING` | Whether to use Claude thinking |
| `CLAUDE_GENERATE_MODEL` | Claude model used for lyric generation |
| `CLAUDE_REVIEW_MODEL` | Claude model used for lyric review |
| `CLAUDE_TRANSLATE_MODEL` | Claude model used for Korean translation |
| `DEBUG_MODE` | Whether to record detailed Claude request/response logs |
| `START_ALBUM` | Album number to start processing from |
| `END_ALBUM` | Album number to stop processing at. `0` processes through the last album |
| `MAX_ROUNDS` | Maximum number of lyric generation/review rounds |
| `SLEEP_LYRICS_MS` | Delay between lyric generation/review API calls (ms) |
| `SLEEP_TRANSLATE_MS` | Delay before the translation API call (ms) |

### Album Processing Range Example

Album files are managed in the format `album_number_album_name.json`.

For example:

```text
7_new_world.json
```

means **album 7**.

If `.env` is set as follows:

```dotenv
START_ALBUM=8
END_ALBUM=10
```

the following are processed:

```text
6_....json
7_....json
8_....json    ← processing target
9_....json    ← processing target
10_....json   ← processing target
11_....json
```

Setting `END_ALBUM=0` processes from the starting album through the last album.

```dotenv
START_ALBUM=8
END_ALBUM=0
```

---

## 6. Lyrics Generation

### Flow

```text
Album / Track information
    ↓
Claude lyric generation
    ↓
Claude lyric review
    │
    ├─ PASS → Claude translation → save txt
    │
    └─ REVISION → apply feedback → generate again
```

Lyrics generation is handled by `lyrics/index.claude.js`.

Album-specific rules and common rules are used together when requesting lyric generation and review from Claude.

### Album Files

Albums are managed using `.json` and `.txt` files.

```text
lyrics/album/
├── 1_Sample.json
└── 1_Sample.txt
```

#### `.json`

Stores track information and the current processing status.

> Note: `title` and `concept` are free-text fields defined by the album author. The language used here is passed through as-is into prompts and output files.

```json
{
  "id": 1,
  "title": "Rain on the Window",
  "concept": "비 오는 창가 앞, 아무 생각 없이 앉아 있는 상태.",
  "status": "todo"
}
```

#### `.txt`

Defines the album's genre, mood, lyric rules, and track-specific themes.

### Track Status

| Status | Description |
|---|---|
| `todo` | Processing target |
| `processing` | Currently being processed |
| `lyrics_done` | Lyrics generated and reviewed; waiting for translation |
| `done` | Lyrics and translation completed |
| `error` | The track could not be completed, such as when the maximum number of rounds is exceeded |

The program checks tracks with `todo`, `processing`, `error`, and `lyrics_done` status as processing targets.

### Generation and Review

1. Claude generates lyrics based on the album rules and track concept.
2. Claude reviews the generated lyrics.
3. If the review result is `PASS`, the process moves to translation.
4. If the result is `REVISION`, the feedback is applied and the lyrics are generated again.
5. This process repeats up to `MAX_ROUNDS`.
6. If `PASS` is not reached within the maximum number of rounds, the track is saved with `error` status.

The review response starts with:

```text
PASS
```

or:

```text
REVISION
```

### Notes

Claude requests use separate `system prompt` and `user prompt` messages. When `REVISION` occurs, the current lyrics and previous feedback are included in the next request. During translation, the final lyrics and translation rules are sent.

**Generate**

```text
System → Album rules (e.g. 1_Sample.txt) + generation rules (rules.json > lyric_generate_prompt)
User   → Song title (e.g. 1_Sample.json > title) + song description (e.g. 1_Sample.json > concept)
```

**Review**

```text
System → Album rules (e.g. 1_Sample.txt) + review rules (rules.json > lyric_review_checklist)
User   → Track information (e.g. 1_Sample.json > title, concept)
         + current lyrics (e.g. 1_Sample.json > lyrics)
         + previous feedback (Claude response after REVISION)
```

**Translate**

```text
System → Album rules (e.g. 1_Sample.txt) + translation rules (rules.json > lyric_translate_rule)
User   → final lyrics (e.g. 1_Sample.json > lyrics)
```

### Result Files

Lyrics that pass review are followed by a Korean translation and saved under `lyrics/output/`.

Example:

```text
lyrics/output/1_Test/1.Rain_on_the_Window.txt
```

The file contains the English lyrics and a Korean translation, separated by a divider. The track's `concept` field (written as-is, in whatever language it was entered in the album JSON) appears at the top of the file.

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

### Logs

Execution logs are saved in `lyrics/logs/`.

By default, the logs record the album, track, round, PASS/ERROR, translation completion, and other processing steps.

When `DEBUG_MODE=true`, detailed Claude API requests and responses are also recorded.

---

## 7. Subtitle Extraction

Place the completed MP3 in `subtitle/music/` and run:

```bash
npm run srt
```

The program finds MP3 files in the folder and uses local Whisper to generate SRT subtitles.

If an `.srt` file with the same name already exists, the program asks whether to regenerate it. This prompt is a hardcoded Korean string in the script, so it appears in Korean regardless of your system language:

```text
⚠️  {filename}의 자막이 이미 있습니다. 다시 만들까요? (y/N)
```
*(Translation: "Subtitles for {filename} already exist. Regenerate? (y/N)")*

- `y`: regenerate
- any other input: keep the existing SRT

To overwrite existing SRT files without confirmation:

```bash
npm run srt:y
```

### Note

> Generated SRT files may differ from the lyrics, so they should be reviewed before use.

---

## 8. License

- Source code: MIT License
- Music / audio: CC BY 4.0

See `LICENSE` and `LICENSE-MUSIC` for details.