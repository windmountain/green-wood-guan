// Records the canvas straight to a video file at its native 1080×1920,
// so you don't have to screen-record (and fight scaling/cursor/UI).
//
// Realtime: if the machine drops frames, so does the video. Close other
// tabs, or fall back to screen recording with the GUI hidden (H).

const TYPES = [
  'video/mp4;codecs=avc1.640033',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];

export function startRecording(canvas, { fps, mbps }) {
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: mbps * 1_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const ext = recorder.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `green-wood-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  recorder.start();
  return () => recorder.state !== 'inactive' && recorder.stop();
}
