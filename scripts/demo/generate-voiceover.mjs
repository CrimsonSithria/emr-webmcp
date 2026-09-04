#!/usr/bin/env node
/**
 * Clone voice from hackathon.m4a and render the full ~90s demo script via ElevenLabs.
 *
 * Env: ELEVENLABS_API_KEY (required)
 * In:  ~/Desktop/hackathon.m4a (or SAMPLE_PATH)
 * Out: /tmp/lablatch-voiceover-90s.mp3
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const scriptPath = path.join(repoRoot, 'docs/demo-voiceover-script.md');
const samplePath = process.env.SAMPLE_PATH || `${process.env.HOME}/Desktop/hackathon.m4a`;
const outPath = process.env.OUT_PATH || '/tmp/lablatch-voiceover-90s.mp3';
function readApiKey() {
  if (process.env.ELEVENLABS_API_KEY) {
    return process.env.ELEVENLABS_API_KEY;
  }
  try {
    const value = execFileSync(
      `${process.env.HOME}/.claude/scripts/keychain.sh`,
      ['get', 'elevenlabs-api-key'],
      { encoding: 'utf8' },
    ).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

const apiKey = readApiKey();

if (!apiKey) {
  console.error('Set ELEVENLABS_API_KEY or store elevenlabs-api-key in the keychain.');
  process.exit(1);
}

function narrationFromMarkdown(markdown) {
  const chunks = [];
  const blocks = markdown.split(/\n\n+/);
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]?.trim() ?? '';
    if (!/^\*\*\[[^\]]+\]/.test(block)) {
      continue;
    }
    const headingLines = block
      .split('\n')
      .filter((line) => !line.startsWith('**[') && line.trim() !== '')
      .join(' ')
      .trim();
    const next = blocks[i + 1]?.trim() ?? '';
    const body =
      headingLines ||
      (next && !next.startsWith('#') && !next.startsWith('|') && !next.startsWith('---') && !next.startsWith('**[')
        ? next
        : '');
    if (body) chunks.push(body);
  }
  return chunks.join('\n\n');
}

async function elevenFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'xi-api-key': apiKey,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${response.status} ${url}: ${body.slice(0, 400)}`);
  }
  return response;
}

function loopSample(source, dest, seconds) {
  execFileSync('ffmpeg', [
    '-y',
    '-stream_loop',
    '-1',
    '-i',
    source,
    '-t',
    String(seconds),
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    dest,
  ], { stdio: 'pipe' });
}

async function cloneVoice(sampleFile) {
  const form = new FormData();
  form.append('name', `lablatch-demo-${Date.now()}`);
  form.append('description', 'LabLatch hackathon voice clone from Voice Memo sample');
  form.append(
    'files',
    new Blob([readFileSync(sampleFile)], { type: 'audio/mp4' }),
    path.basename(sampleFile),
  );
  const response = await elevenFetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    body: form,
  });
  const payload = await response.json();
  if (!payload.voice_id) throw new Error('voice clone missing voice_id');
  return payload.voice_id;
}

async function synthesize(voiceId, text) {
  const response = await elevenFetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.72,
        similarity_boost: 0.8,
        style: 0.05,
        use_speaker_boost: true,
        speed: 0.88,
      },
    }),
  });
  return Buffer.from(await response.arrayBuffer());
}

const narration = narrationFromMarkdown(readFileSync(scriptPath, 'utf8'));
const loopedSample = '/tmp/hackathon-loop-90s.m4a';
loopSample(samplePath, loopedSample, 90);
console.error(`narration chars=${narration.length} sample=${samplePath} looped=${loopedSample}`);

const voiceId = await cloneVoice(loopedSample);
console.error(`cloned voice_id=${voiceId}`);

const audio = await synthesize(voiceId, narration);
writeFileSync(outPath, audio);
console.log(JSON.stringify({ voiceId, outPath, bytes: audio.length }));
