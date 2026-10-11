'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import type { CallToken } from '@smartcode/shared';
import type { Participant, Room } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';

type Phase = 'connecting' | 'live' | 'error';

/** One person's tile: their camera (or shared screen) and, for others, their audio. */
function Tile({
  participant,
  local,
  version,
}: {
  participant: Participant;
  local: boolean;
  version: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void import('livekit-client').then(({ Track }) => {
      const camera = participant.getTrackPublication(Track.Source.Camera)?.track;
      const screen = participant.getTrackPublication(Track.Source.ScreenShare)?.track;
      const mic = participant.getTrackPublication(Track.Source.Microphone)?.track;
      if (camera && videoRef.current) camera.attach(videoRef.current);
      if (screen && screenRef.current) screen.attach(screenRef.current);
      if (mic && audioRef.current && !local) mic.attach(audioRef.current);
    });
  }, [participant, local, version]);

  const sharing = participant.isScreenShareEnabled;
  const cameraOn = participant.isCameraEnabled;
  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: '#101828',
        borderRadius: 2,
        overflow: 'hidden',
        aspectRatio: '16 / 9',
        minHeight: 140,
        outline: participant.isSpeaking ? '3px solid #1A73E8' : 'none',
      }}
    >
      {sharing && (
        <video
          ref={screenRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
      {!sharing && cameraOn && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={local}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: local ? 'scaleX(-1)' : undefined,
          }}
        />
      )}
      {!sharing && !cameraOn && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <Typography variant="h4" sx={{ color: '#fff', opacity: 0.85 }}>
            {(participant.name ?? '?').trim().charAt(0).toUpperCase()}
          </Typography>
        </Box>
      )}
      <audio ref={audioRef} autoPlay />
      <Typography
        variant="caption"
        sx={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          color: '#fff',
          bgcolor: 'rgba(0,0,0,.55)',
          px: 1,
          borderRadius: 1,
        }}
      >
        {local ? 'You' : (participant.name ?? 'Guest')}
        {sharing ? ' · sharing screen' : ''}
        {!participant.isMicrophoneEnabled ? ' · muted' : ''}
      </Typography>
    </Box>
  );
}

/**
 * A call window for one channel: audio, video and screen sharing through the call service. The server issues a
 * short-lived token for this channel's room only.
 */
export function CallDialog({
  channelId,
  channelName,
  video,
  announce,
  onClose,
}: {
  channelId: string;
  channelName: string;
  video: boolean;
  announce: boolean;
  onClose: () => void;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [phase, setPhase] = useState<Phase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [, setTick] = useState(0);
  const bump = useCallback(() => {
    setVersion((v) => v + 1);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let room: Room | null = null;
    (async () => {
      try {
        const [{ Room: LiveRoom, RoomEvent }, call] = await Promise.all([
          import('livekit-client'),
          apiFetch<CallToken>(`/collab/channels/${channelId}/call`, {
            method: 'POST',
            body: JSON.stringify({ video, announce }),
          }),
        ]);
        if (cancelled) return;
        room = new LiveRoom({ adaptiveStream: true, dynacast: true });
        setRoom(room);
        for (const event of [
          RoomEvent.ParticipantConnected,
          RoomEvent.ParticipantDisconnected,
          RoomEvent.TrackSubscribed,
          RoomEvent.TrackUnsubscribed,
          RoomEvent.TrackMuted,
          RoomEvent.TrackUnmuted,
          RoomEvent.LocalTrackPublished,
          RoomEvent.LocalTrackUnpublished,
          RoomEvent.ActiveSpeakersChanged,
        ]) {
          room.on(event, bump);
        }
        room.on(RoomEvent.Disconnected, () => {
          if (!cancelled) onClose();
        });
        await room.connect(call.url, call.token);
        await room.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
        if (video) await room.localParticipant.setCameraEnabled(true).catch(() => undefined);
        if (cancelled) return;
        setPhase('live');
        bump();
      } catch (e) {
        if (cancelled) return;
        setError(problemText(e, 'The call could not start. Check your connection and try again.'));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
      void room?.disconnect();
    };
    // The call is set up once per dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const me = room?.localParticipant;
  const people = room ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())] : [];

  async function toggle(kind: 'mic' | 'camera' | 'screen') {
    if (!me) return;
    try {
      if (kind === 'mic') await me.setMicrophoneEnabled(!me.isMicrophoneEnabled);
      if (kind === 'camera') await me.setCameraEnabled(!me.isCameraEnabled);
      if (kind === 'screen') await me.setScreenShareEnabled(!me.isScreenShareEnabled);
    } catch {
      setError(
        kind === 'screen'
          ? 'Screen sharing did not start. Allow screen sharing in your browser and try again.'
          : 'The browser did not allow that device. Check the permission in the address bar.',
      );
    }
    bump();
  }

  return (
    <Dialog open fullScreen onClose={onClose} aria-label={`Call in ${channelName}`}>
      <Box
        sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: '#0B1220', color: '#fff' }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" component="h2" sx={{ flex: 1 }} noWrap>
            {channelName}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.75 }}>
            {phase === 'connecting' ? 'Connecting…' : `${people.length} in the call`}
          </Typography>
        </Box>
        {error && (
          <Alert
            severity={phase === 'error' ? 'error' : 'warning'}
            sx={{ mx: 2 }}
            onClose={phase === 'error' ? undefined : () => setError(null)}
          >
            {error}
          </Alert>
        )}
        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            p: 2,
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fit, minmax(280px, 1fr))' },
            alignContent: 'start',
          }}
        >
          {people.map((p) => (
            <Tile key={p.identity} participant={p} local={p === me} version={version} />
          ))}
        </Box>
        <Box sx={{ p: 2, display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            color="inherit"
            disabled={phase !== 'live'}
            onClick={() => void toggle('mic')}
          >
            {me?.isMicrophoneEnabled ? 'Mute' : 'Unmute'}
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            disabled={phase !== 'live'}
            onClick={() => void toggle('camera')}
          >
            {me?.isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            disabled={phase !== 'live'}
            onClick={() => void toggle('screen')}
          >
            {me?.isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}
          </Button>
          <Button variant="contained" color="error" onClick={onClose}>
            Leave call
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
