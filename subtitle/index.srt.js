import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import readline from "readline";

const execAsync = promisify(exec);

// ── 설정 ─────────────────────────────────────────────────────
const MUSIC_DIR = "./music";
const WHISPER_MODEL = "base"; // tiny, base, small, medium, large (base가 빠르고 무난함)

const args = process.argv.slice(2);
const AUTO_YES = args.includes("-y"); // -y: 기존 자막 있어도 확인 없이 덮어쓰기

const rl = readline.createInterface({
  input: process.stdin,   // 사용자가 키보드로 치는 것 = 입력
  output: process.stdout, // 터미널 화면에 보이는 것 = 출력
});

// ask: 질문을 보여주고 사용자 입력을 Promise로 돌려주는 함수
// question 매개변수: 화면에 띄울 질문 문자열 (예: "다시 만들까요? (y/N)")
const ask = (question) =>
  new Promise((resolve) => {
    // rl.question은 readline이 기본 제공하는 메서드.
    // 형태: rl.question(질문문자열, 콜백함수)
    // → 질문을 화면에 띄우고, 사용자가 엔터 치면 입력값을 콜백함수에 넘겨서 실행함
    //
    // 여기선 콜백함수 자리에 resolve를 그대로 넣음.
    // 즉 "사용자가 입력하면 그 값으로 resolve를 호출해라" = Promise를 완료시켜라
    rl.question(question, resolve);
  });

// ── mp3 / srt 경로 헬퍼 ────────────────────────────────────────
function findMp3Files(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".mp3"))
    .sort();
}

function srtPathFor(mp3Path) {
  return mp3Path.replace(/\.mp3$/i, ".srt");
}

// ── whisper 실행 (곡 1개) ───────────────────────────────────────
async function runWhisper(mp3Path, outputDir) {
  const command = `python -m whisper "${mp3Path}" --model ${WHISPER_MODEL} --output_format srt --output_dir "${outputDir}"`;
  const { stderr } = await execAsync(command);
  // whisper는 진행 상황을 stderr로 뱉어냅니다.
  if (stderr) console.log(stderr);
}

// ── 기존 자막이 있을 때 진행 여부 확인 ─────────────────────────
async function shouldProcess(mp3Path, srtExists) {
  if (!srtExists) return true;
  if (AUTO_YES) return true;

  const fileName = path.basename(mp3Path);
  const answer = await ask(`⚠️  ${fileName}의 자막이 이미 있습니다. 다시 만들까요? (y/N) `);
  return answer.trim().toLowerCase() === "y";
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(MUSIC_DIR)) {
    console.error(`❌ ${MUSIC_DIR} 폴더가 없습니다.`);
    process.exit(1);
  }

  const mp3Files = findMp3Files(MUSIC_DIR);
  if (mp3Files.length === 0) {
    console.log(`📂 ${MUSIC_DIR}에 mp3 파일이 없습니다.`);
    rl.close();
    return;
  }

  console.log(`🎵 [로컬 무료 AI] 자막 추출을 시작합니다. (${mp3Files.length}곡 발견)`);
  console.log(`⏳ PC 성능에 따라 시간이 걸릴 수 있습니다. 커피 한 잔 드시고 오세요!`);
  if (AUTO_YES) console.log(`🔁 -y 옵션 감지 — 기존 자막이 있어도 확인 없이 덮어씁니다.`);

  const summary = { done: [], skipped: [], failed: [] };

  for (const fileName of mp3Files) {
    const mp3Path = path.join(MUSIC_DIR, fileName);
    const srtPath = srtPathFor(mp3Path);
    const srtExists = fs.existsSync(srtPath);

    console.log(`\n${"=".repeat(50)}`);
    console.log(`🎧 ${fileName}`);

    const proceed = await shouldProcess(mp3Path, srtExists);
    if (!proceed) {
      console.log(`⏭️  스킵 (기존 자막 유지)`);
      summary.skipped.push(fileName);
      continue;
    }

    try {
      await runWhisper(mp3Path, MUSIC_DIR);
      console.log(`✅ 완료: ${path.basename(srtPath)}`);
      summary.done.push(fileName);
    } catch (err) {
      console.error(`❌ 에러 발생 (${fileName}): ${err.message}`);
      summary.failed.push(fileName);
    }
  }

  rl.close();

  console.log(`\n${"=".repeat(50)}`);
  console.log(
    `🎉 작업 완료 — 생성 ${summary.done.length} / 스킵 ${summary.skipped.length} / 실패 ${summary.failed.length}`
  );

  if (summary.done.length > 0) {
    console.log(`\n✅ 생성 완료:`);
    for (const fileName of summary.done) console.log(`  - ${fileName}`);
  }

  if (summary.skipped.length > 0) {
    console.log(`\n⏭️  스킵:`);
    for (const fileName of summary.skipped) console.log(`  - ${fileName}`);
  }

  if (summary.failed.length > 0) {
    console.log(`\n❌ 실패:`);
    for (const fileName of summary.failed) console.log(`  - ${fileName}`);
  }
}

main();
