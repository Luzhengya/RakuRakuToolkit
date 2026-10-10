export async function captureScreen(): Promise<string | null> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor' } as any,
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    const w = settings.width ?? 1920;
    const h = settings.height ?? 1080;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, w, h);

    track.stop();
    stream = null;

    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }
}
