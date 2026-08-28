import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const START_ALBUM = parseInt(process.env.START_ALBUM || "1");
const END_ALBUM = parseInt(process.env.END_ALBUM || "0");
const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || "10");
const CLAUDE_GENERATE_MODEL = process.env.CLAUDE_GENERATE_MODEL || "claude-sonnet-4-6";
const CLAUDE_REVIEW_MODEL = process.env.CLAUDE_REVIEW_MODEL || "claude-sonnet-4-6";
const CLAUDE_TRANSLATE_MODEL = process.env.CLAUDE_TRANSLATE_MODEL || "claude-sonnet-4-6";
const DEBUG_MODE = process.env.DEBUG_MODE === "true";
const SLEEP_LYRICS_MS = parseInt(process.env.SLEEP_LYRICS_MS || "3000");
const SLEEP_TRANSLATE_MS = parseInt(process.env.SLEEP_TRANSLATE_MS || "3000");

const rules = JSON.parse(fs.readFileSync("./rules/rules.json", "utf-8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 상태 상수 ─────────────────────────────────────────────────
const STATUS = {
  TODO: "todo",
  PROCESSING: "processing",
  LYRICS_DONE: "lyrics_done",
  DONE: "done",
  ERROR: "error",
};

// ── 플래그 변수 ───────────────────────────────────────────────
let currentAlbumNum = -1;

// ── 로그 ─────────────────────────────────────────────────────
let logFilePath = "";
let summaryLog = [];

function initLog(albumNum, albumName) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");
  const safeName = albumName.replace(/\s+/g, "_");
  logFilePath = `./logs/${date}-${time}_${albumNum}_${safeName}.log`;
  fs.mkdirSync("./logs", { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (logFilePath) fs.appendFileSync(logFilePath, line + "\n", "utf-8");
}

// function logDebug(label, content) {
//   const block = `\n${"=".repeat(60)}\n[DEBUG] ${label}\n${"─".repeat(60)}\n${content}\n${"─".repeat(60)}`;
//   if (logFilePath) fs.appendFileSync(logFilePath, block + "\n", "utf-8");
//   if (DEBUG_MODE) console.log(block);
// }

function logDebug(label, content) {
  if (!DEBUG_MODE) return;
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const line = `[${ts}] [DEBUG] ${label}\n${content}\n${"─".repeat(60)}`;
  console.log(line);
  if (logFilePath) fs.appendFileSync(logFilePath, line + "\n", "utf-8");
}

function saveSummary() {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const lines = [
    "",
    "==================== 요약 ====================",
    ...summaryLog,
    `[${ts}] 전체 작업 완료`,
    "==============================================",
  ];
  lines.forEach((line) => {
    console.log(line);
    if (logFilePath) fs.appendFileSync(logFilePath, line + "\n", "utf-8");
  });
}

// ── Claude 가사 생성 ──────────────────────────────────────────
async function generateLyrics(track, albumRules, prevFeedback = "", currentLyrics = "") {
  const systemPrompt = [
    `당신은 Grammy 후보에 오른 인디 팝 아티스트의 전속 작사가입니다.`,
    `아래 앨범 규칙을 엄격히 준수하여 가사를 작성하세요.`,
    `앨범 규칙:\n${albumRules}`,
    rules.lyric_generate_prompt,
  ].join("\n\n");

  const userPrompt = [
    `곡 제목: ${track.title}`,
    `곡 설명: ${track.concept}`,
    currentLyrics ? `[현재 가사 - 아래 피드백을 반영하여 수정하세요]\n${currentLyrics}` : "",
    prevFeedback ? `[수정 요청사항]\n${prevFeedback}` : "",
  ].filter(Boolean).join("\n\n");

  logDebug(`Claude 가사생성 system (${CLAUDE_GENERATE_MODEL})`, systemPrompt);
  logDebug("Claude 가사생성 user prompt", userPrompt);

  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_GENERATE_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = msg.content[0].text.trim();
    logDebug("Claude 가사생성 응답", text);
    return text;
  } catch (err) {
    if (err.status === 429) {
      log(`  ❌ Claude 가사생성 429 사용량 한도 초과. 전체 작업 종료.`);
      log(`  📋 원시 오류: ${err.message || JSON.stringify(err)}`);
      saveSummary();
      process.exit(1);
    }
    throw err;
  }
}

// ── Claude 피드백 ─────────────────────────────────────────────
async function reviewLyrics(track, albumRules, lyrics, prevFeedback = "") {
  const systemPrompt = [
    `당신은 엄격한 가사 검토자입니다. 아래 기준으로 가사를 검토하세요.`,
    `앨범 규칙:\n${albumRules}`,
    `검토 항목: ${rules.lyric_review_checklist}`,
    `응답은 반드시 PASS 또는 REVISION 으로 시작할 것.`,
    `PASS: 문제 없음.`,
    `REVISION: 문제 있음 + 구체적 수정 제안.`,
    `주의: 이전 피드백이 제공될 경우, 네가 이전에 지시한 내용을 스스로 번복하거나 모순되게 지적하지 마라.`,
  ].join("\n");

  const userPrompt = [
    `곡 제목: ${track.title}`,
    `곡 설명: ${track.concept}`,
    prevFeedback ? `[이전 라운드 피드백]\n${prevFeedback}` : "",
    `[검토할 가사]\n${lyrics}`,
  ].filter(Boolean).join("\n\n");

  logDebug(`Claude 피드백 system (${CLAUDE_REVIEW_MODEL})`, systemPrompt);
  logDebug("Claude 피드백 user prompt", userPrompt);

  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_REVIEW_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = msg.content[0].text.trim();
    logDebug("Claude 피드백 응답", text);
    return text;
  } catch (err) {
    if (err.status === 429) {
      log(`  ❌ Claude 피드백 429 사용량 한도 초과. 전체 작업 종료.`);
      log(`  📋 원시 오류: ${err.message || JSON.stringify(err)}`);
      saveSummary();
      process.exit(1);
    }
    throw err;
  }
}

// ── Claude 번역 ───────────────────────────────────────────────
async function translateLyrics(lyrics, albumRules) {
  const systemPrompt = [
    `앨범 규칙:\n${albumRules}`,
    rules.lyric_translate_rule,
  ].join("\n\n");

  logDebug("번역 요청 가사", lyrics);

  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_TRANSLATE_MODEL,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: "user", content: lyrics }],
    });
    const text = msg.content[0].text.trim();
    logDebug("번역 결과", text);
    return text;
  } catch (err) {
    if (err.status === 429) {
      log(`  ❌ Claude 번역 429 사용량 한도 초과. 전체 작업 종료.`);
      log(`  📋 원시 오류: ${err.message || JSON.stringify(err)}`);
      saveSummary();
      process.exit(1);
    }
    throw err;
  }
}

// ── txt 저장 (영어 가사만) ────────────────────────────────────
function saveLyricsTxt(albumDir, track, lyrics) {
  const outputDir = path.join("./output", albumDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const fileName = `${track.id}.${track.title.replace(/\s+/g, "_")}.txt`;
  const filePath = path.join(outputDir, fileName);

  const content = [
    `${track.id}. ${track.title}`,
    track.concept,
    "",
    lyrics,
  ].join("\n");

  fs.writeFileSync(filePath, content, "utf-8");
  log(`  💾 가사 저장 완료: ${fileName}`);
}

// ── txt 업데이트 (한글 번역 추가) ─────────────────────────────
function appendTranslationTxt(albumDir, track, translated) {
  const outputDir = path.join("./output", albumDir);
  const fileName = `${track.id}.${track.title.replace(/\s+/g, "_")}.txt`;
  const filePath = path.join(outputDir, fileName);

  const addition = ["", "====================", "", translated].join("\n");
  fs.appendFileSync(filePath, addition, "utf-8");
  log(`  🌐 번역 추가 완료: ${fileName}`);
}

// ── 앨범 json 업데이트 ────────────────────────────────────────
function updateTrack(albumPath, trackId, fields) {
  const album = JSON.parse(fs.readFileSync(albumPath, "utf-8"));
  const track = album.tracks.find((t) => t.id === trackId);
  if (track) Object.assign(track, fields);
  fs.writeFileSync(albumPath, JSON.stringify(album, null, 2), "utf-8");
}

// ── 트랙 처리 ─────────────────────────────────────────────────
async function processTrack(albumPath, albumDirName, track, albumRules) {
  log(`🎵 [T${track.id}] ${track.title} 시작`);

  if (track.status !== STATUS.LYRICS_DONE) {
    updateTrack(albumPath, track.id, { status: STATUS.PROCESSING });

    let lyrics = "";
    let feedback = "";
    let round = 0;

    while (round < MAX_ROUNDS) {
      round++;
      log(`  🔄 Round ${round}`);

      lyrics = await generateLyrics(track, albumRules, feedback, lyrics);
      log(`  ✍️  가사 생성 완료`);
      await sleep(SLEEP_LYRICS_MS);

      feedback = await reviewLyrics(track, albumRules, lyrics, feedback);
      log(`  💬 Claude 피드백: ${feedback.split("\n")[0]}`);
      await sleep(SLEEP_LYRICS_MS);

      const isPass = feedback.includes("PASS") && !feedback.includes("REVISION");
      if (isPass) {
        log(`  ✅ PASS`);
        break;
      }
    }

    if (!feedback.includes("PASS") || feedback.includes("REVISION")) {
      log(`  ❌ [T${track.id}] MAX_ROUNDS 초과 → error`);
      summaryLog.push(`T${track.id} ${track.title} - Round ${round} - ERROR`);
      updateTrack(albumPath, track.id, { status: STATUS.ERROR });
      return;
    }

    saveLyricsTxt(albumDirName, track, lyrics);
    updateTrack(albumPath, track.id, { status: STATUS.LYRICS_DONE, lyrics });
    summaryLog.push(`T${track.id} ${track.title} - Round ${round} - PASS`);
    track.lyrics = lyrics;
  } else {
    log(`  📄 가사 이미 완성 → 번역만 진행`);
    const albumData = JSON.parse(fs.readFileSync(albumPath, "utf-8"));
    const savedTrack = albumData.tracks.find((t) => t.id === track.id);
    track.lyrics = savedTrack?.lyrics || "";
    if (!track.lyrics) {
      log(`  ❌ [T${track.id}] JSON에 가사 없음 → todo로 초기화`);
      updateTrack(albumPath, track.id, { status: STATUS.TODO });
      return;
    }
  }

  log(`  🌐 번역 시작`);
  await sleep(SLEEP_TRANSLATE_MS);
  const translated = await translateLyrics(track.lyrics, albumRules);
  appendTranslationTxt(albumDirName, track, translated);
  updateTrack(albumPath, track.id, { status: STATUS.DONE });
  log(`  ✅ [T${track.id}] ${track.title} 완료`);
}

// ── 앨범 처리 ─────────────────────────────────────────────────
async function processAlbum(albumPath) {
  const album = JSON.parse(fs.readFileSync(albumPath, "utf-8"));
  const albumDirName = path.basename(albumPath, ".json");
  const albumNum = parseInt(path.basename(albumPath).split("_")[0]);

  initLog(albumNum, album.album);
  log(`\n📀 앨범 작업 시작: ${album.album}`);
  log(`  ✍️  가사 생성 모델: ${CLAUDE_GENERATE_MODEL}`);
  log(`  💬 피드백 모델: ${CLAUDE_REVIEW_MODEL}`);
  log(`  🌐 번역 모델: ${CLAUDE_TRANSLATE_MODEL}`);

  if (currentAlbumNum !== albumNum) {
    currentAlbumNum = albumNum;
    log(`  🔄 앨범 변경 감지`);
  }

  const txtPath = albumPath.replace(".json", ".txt");
  let albumRules = "";
  if (fs.existsSync(txtPath)) {
    albumRules = fs.readFileSync(txtPath, "utf-8");
    log(`  📄 규칙 파일 로드: ${path.basename(txtPath)}`);
  } else if (album.rules) {
    albumRules = album.rules;
    log(`  📄 규칙 JSON에서 로드`);
  } else {
    log(`  ⚠️ 규칙 파일 없음: ${txtPath}`);
  }

  const todoTracks = album.tracks.filter((t) =>
    [STATUS.TODO, STATUS.PROCESSING, STATUS.ERROR, STATUS.LYRICS_DONE].includes(t.status)
  );
  log(`  📋 작업 대상: ${todoTracks.length}곡`);

  for (const track of todoTracks) {
    await processTrack(albumPath, albumDirName, track, albumRules);
  }

  log(`\n✅ 앨범 완료: ${album.album}`);
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const albumDir = "./album";
  const files = fs
    .readdirSync(albumDir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => parseInt(a.split("_")[0]) - parseInt(b.split("_")[0]));

  for (const file of files) {
    const albumNum = parseInt(file.split("_")[0]);
    if (albumNum < START_ALBUM) continue;
    if (END_ALBUM !== 0 && albumNum > END_ALBUM) break;
    await processAlbum(path.join(albumDir, file));
  }

  log("\n🎉 전체 작업 완료");
  saveSummary();
}

main().catch(console.error);
