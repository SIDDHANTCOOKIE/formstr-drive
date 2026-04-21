import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;

const FFMPEG_LOAD_TIMEOUT_MS = 15_000;
const THUMBNAIL_TIMEOUT_MS = 10_000;

async function loadFFmpeg(): Promise<FFmpeg> {
    if (ffmpeg) return ffmpeg;

    const instance = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

    const loadPromise = (async () => {
        await instance.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        });
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("FFmpeg load timed out")), FFMPEG_LOAD_TIMEOUT_MS)
    );

    await Promise.race([loadPromise, timeoutPromise]);

    ffmpeg = instance;
    return ffmpeg;
}

export async function extractFrameWithFFmpeg(file: File): Promise<Uint8Array | null> {
    try {
        const ff = await loadFFmpeg();

        await ff.writeFile("input", await fetchFile(file));
        await ff.exec([
            "-i", "input",
            "-ss", "0.01",       // seek to 10ms
            "-frames:v", "1",    // extract one frame
            "-vf", "scale=300:-1", // max width 300, keep aspect ratio
            "thumb.jpg"
        ]);

        const data = await ff.readFile("thumb.jpg");

        // cleanup
        await ff.deleteFile("input");
        await ff.deleteFile("thumb.jpg");

        return data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    } catch {
        return null;
    }
}
export async function generateVideoThumbnail(file: File): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(file);
        let settled = false;

        const cleanup = () => URL.revokeObjectURL(url);

        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            cleanup();
            fn();
        };

        const timeoutId = setTimeout(() => {
            settle(() => reject(new Error("Video thumbnail generation timed out")));
        }, THUMBNAIL_TIMEOUT_MS);

        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";

        video.onloadedmetadata = () => {
            // Some browsers fail exactly at 0 → use tiny offset
            video.currentTime = 0.01;
        };

        video.onseeked = async () => {
            try {
                const canvas = document.createElement("canvas");

                const maxSize = 300;
                const scale = Math.min(
                    maxSize / video.videoWidth,
                    maxSize / video.videoHeight,
                    1
                );

                canvas.width = video.videoWidth * scale;
                canvas.height = video.videoHeight * scale;

                const ctx = canvas.getContext("2d");
                if (!ctx) throw new Error("Failed to get canvas 2D context");
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                const blob = await new Promise<Blob>((res, rej) =>
                    canvas.toBlob((b) => b ? res(b) : rej(new Error("Canvas export failed")), "image/webp", 0.7)
                );

                const buffer = new Uint8Array(await blob.arrayBuffer());
                settle(() => resolve(buffer));
            } catch (err) {
                settle(() => reject(err));
            }
        };

        video.onerror = () => settle(() => reject(new Error("Video loading failed")));
    });
}