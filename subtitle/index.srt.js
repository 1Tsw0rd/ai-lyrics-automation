import { exec } from "child_process";
import path from "path";

// 추출할 파일 경로
const targetAudio = "./music/Forever_Friend.mp3"; 
const outputDir = path.dirname(targetAudio);

console.log(`🎵 [로컬 무료 AI] 자막 추출을 시작합니다...`);
console.log(`⏳ PC 성능에 따라 시간이 걸릴 수 있습니다. 커피 한 잔 드시고 오세요!`);

// whisper 명령어 조립 (model: base, 언어: 자동감지, 포맷: srt)
// 모델 종류: tiny, base, small, medium, large (base가 빠르고 무난함)
const command = `python -m whisper "${targetAudio}" --model base --output_format srt --output_dir "${outputDir}"`;

exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`❌ 에러 발생: ${error.message}`);
    return;
  }
  // whisper는 진행 상황을 stderr로 뱉어냅니다.
  if (stderr) {
    console.log(stderr); 
  }
  console.log(`✅ 추출 완료! 저장 위치: ${outputDir}`);
});
