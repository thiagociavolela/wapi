import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

export function convertVoiceToOgg(input: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("FFmpeg não está disponível para esta plataforma."));
    const process = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"], { windowsHide: true });
    const output: Buffer[] = []; const errors: Buffer[] = [];
    process.stdout.on("data", (chunk) => output.push(Buffer.from(chunk)));
    process.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
    process.on("error", () => reject(new Error("FFmpeg não está instalado no servidor.")));
    process.on("close", (code) => code === 0 && output.length ? resolve(Buffer.concat(output)) : reject(new Error(Buffer.concat(errors).toString("utf8") || "Não foi possível converter o áudio.")));
    process.stdin.end(input);
  });
}
