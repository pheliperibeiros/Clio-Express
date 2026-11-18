export interface DetectedDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export interface DeviceSetup {
  cameras: DetectedDevice[];
  microphones: DetectedDevice[];
  selectedCamera1Id: string | null;
  selectedCamera2Id: string | null;
  selectedMicrophoneId: string | null;
}

/**
 * Enumerates all video and audio devices with clear human-readable labels
 */
export async function enumerateHardwareDevices(): Promise<{
  cameras: DetectedDevice[];
  microphones: DetectedDevice[];
}> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return { cameras: [], microphones: [] };
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();

    const cameras: DetectedDevice[] = devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || `Câmera ${idx + 1} (${d.deviceId.slice(0, 5)}...)`,
        kind: d.kind,
      }));

    const microphones: DetectedDevice[] = devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || `Microfone ${idx + 1} (${d.deviceId.slice(0, 5)}...)`,
        kind: d.kind,
      }));

    return { cameras, microphones };
  } catch {
    return { cameras: [], microphones: [] };
  }
}

/**
 * Requests initial camera & microphone permission only if not already unlocked
 */
export async function requestMediaPermissions(): Promise<boolean> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }

  try {
    const existingDevices = await navigator.mediaDevices.enumerateDevices();
    const hasLabeledCam = existingDevices.some((d) => d.kind === 'videoinput' && d.label && d.label.length > 0);
    const hasLabeledMic = existingDevices.some((d) => d.kind === 'audioinput' && d.label && d.label.length > 0);
    if (hasLabeledCam && hasLabeledMic) {
      return true;
    }
  } catch {}

  let granted = false;
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    tempStream.getTracks().forEach((track) => track.stop());
    granted = true;
  } catch {
    // If combined request fails (e.g., mic or cam exclusively locked), try individually
    try {
      const vStream = await navigator.mediaDevices.getUserMedia({ video: true });
      vStream.getTracks().forEach((track) => track.stop());
      granted = true;
    } catch {}

    try {
      const aStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      aStream.getTracks().forEach((track) => track.stop());
      granted = true;
    } catch {}
  }

  await new Promise((resolve) => setTimeout(resolve, 100));
  return granted;
}

/**
 * Obtains a camera stream for a specific physical deviceId with exact separation
 */
export async function getCameraStream(deviceId?: string | null): Promise<MediaStream | null> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return null;
  }

  const tryGetStream = async (constraints: MediaStreamConstraints): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      return null;
    }
  };

  // 1. Strict device selection when a specific deviceId is requested
  if (deviceId && deviceId.trim().length > 0) {
    // Attempt 1: Exact deviceId with standard 1080p ideal resolution
    let stream = await tryGetStream({
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    if (stream) return stream;

    // Attempt 2: Exact deviceId without resolution constraints (webcams that don't support 1080p)
    stream = await tryGetStream({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    });
    if (stream) return stream;

    // Attempt 3: Direct deviceId constraint
    stream = await tryGetStream({
      video: { deviceId: { ideal: deviceId } },
      audio: false,
    });
    if (stream) return stream;

    // IMPORTANT: If this specific deviceId failed to open, return null!
    // Never fall back to default camera, otherwise Camera 2 duplicates Camera 1!
    return null;
  }

  // 2. Only if no deviceId was specified, request the default system camera
  return (
    (await tryGetStream({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    })) || (await tryGetStream({ video: true, audio: false }))
  );
}

/**
 * Obtains a microphone stream with exact hardware device separation
 */
export async function getMicrophoneStream(deviceId?: string | null): Promise<MediaStream | null> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return null;
  }

  const tryGetStream = async (constraints: MediaStreamConstraints): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (stream && stream.getAudioTracks().length > 0) {
        stream.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
        return stream;
      }
      return null;
    } catch {
      return null;
    }
  };

  // 1. If a specific, non-default hardware ID is requested
  if (deviceId && deviceId.trim().length > 0 && deviceId !== 'default' && deviceId !== 'communications') {
    // Attempt 1: Exact ID with standard judicial DSP (echoCancellation, noiseSuppression)
    let stream = await tryGetStream({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if (stream) return stream;

    // Attempt 2: Exact ID without DSP (for USB audio interfaces or mixers like Behringer/Focusrite)
    stream = await tryGetStream({
      audio: { deviceId: { exact: deviceId } },
      video: false,
    });
    if (stream) return stream;

    // Attempt 3: Ideal ID
    stream = await tryGetStream({
      audio: { deviceId: { ideal: deviceId } },
      video: false,
    });
    if (stream) return stream;
  }

  // 2. Default system audio with standard DSP
  let stream = await tryGetStream({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  if (stream) return stream;

  // 3. Simple audio true (guaranteed fallback for any driver setup)
  return await tryGetStream({
    audio: true,
    video: false,
  });
}
