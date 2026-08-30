# Web Speech Voice Mode

Kalo voice mode uses the browser's Web Speech APIs while keeping the existing Kalo Agent, system prompt, memory, health tools, and installed plugins authoritative.

## Processing path

```text
microphone
→ browser SpeechRecognition
→ current Kalo Session
→ existing pi-agent-core runTurn()
→ plain spoken assistant text
→ browser speechSynthesis
```

Raw audio is never stored by Kalo. The final transcript is persisted as a voice-origin user message and is sent to the user's configured model provider exactly like a typed message.

## Local-first STT

The default `local_preferred` policy calls the experimental on-device Web Speech APIs when available:

```js
SpeechRecognition.available({
  langs: ["zh-CN"],
  processLocally: true,
  quality: "dictation"
});
```

Possible states are `available`, `downloadable`, `downloading`, and `unavailable`. Kalo can explicitly install a downloadable language pack with `SpeechRecognition.install()`.

Kalo never silently falls back to network recognition:

- `local_only` fails if the local language pack is unavailable.
- `local_preferred` uses local when available and requires saved permission before network fallback.
- `network` also requires saved network-speech permission.

On the Chrome test device, `zh-CN` on-device recognition reported `unavailable`, while browser-vendor network recognition was available and accurate.

Network SpeechRecognition is provided by the browser/OS vendor. Kalo does not proxy the audio and cannot identify or guarantee that vendor's retention, region, or availability.

## Local-first TTS

Kalo selects a matching voice with:

```js
voice.localService === true
```

Network/unknown voices are selectable only after network-speech permission. The tested device exposed 18 local Chinese voices and 3 network/unknown voices.

The selected `voiceURI`, speaking rate, and pitch are stored locally:

```text
rate:  0.50–2.00 (default 1.00)
pitch: 0.50–1.50 (default 1.00)
```

They apply to both the settings preview and Kalo's spoken replies.

## Turn handling

Native `continuous=true` recognition can wait several seconds before committing a final result. Kalo instead runs one utterance at a time and restarts it:

- `speechend` schedules `recognition.stop()` after 120 ms.
- An interim result with no update for 900 ms also schedules `stop()`.
- `stop()`, unlike `abort()`, asks the browser to finalize buffered speech.

### Automatic turn-taking

Recognition pauses after a final transcript, Kalo completes its Agent/tool turn, local TTS speaks the response, and recognition restarts automatically.

### Realtime interruption (experimental)

Recognition remains active while the Agent works and while local TTS plays. New non-echo speech cancels speech synthesis and aborts the current Agent turn. Completed tool side effects are not rolled back.

Because SpeechRecognition owns microphone capture, the app cannot directly verify its AEC path. Kalo compares interim/final transcripts with the text currently being spoken and ignores likely TTS echo. Users should switch to automatic turn-taking if the browser recognizes its own voice.

## Voice-specific response format

Voice turns append a system-prompt section requiring concise, natural, spoken plain text with no Markdown, lists, tables, code, links, URLs, raw JSON, emoji, or decorative symbols.

A deterministic final sanitizer provides defense in depth before persistence and speech:

- removes old internal voice labels
- converts Markdown headings/lists/tables to plain text
- keeps link labels but removes URLs
- strips code markers, HTML, emoji, and decoration
- collapses whitespace

The sanitizer does not affect tool-call content; it applies only to user-facing assistant text in voice turns.

## Session and mode safety

Voice is available only in `standard` sessions. Plugin-development sessions hide the voice button, and voice startup re-reads the Session and rejects non-standard mode.

Voice user/assistant/tool messages carry `transport: "voice"` in IndexedDB and backup. A persisted voice user message does not trigger the normal chat-page pending-turn runner because the voice controller already owns that `runTurn()` call.

## Backup and privacy

Backup format v8 includes Web Speech preferences and voice-origin text messages. It does not include raw audio, browser speech language packs, system TTS voices, or vendor-side speech data.

The privacy boundary shown to users must distinguish:

```text
STT local:       raw audio stays on device
STT network:     browser vendor may receive audio
Kalo Agent:      transcript goes to configured model provider
TTS local:       synthesis stays on device
TTS network:     browser/OS vendor may process text
Kalo tools:      execute locally
```

## Compatibility

`processLocally`, `SpeechRecognition.available()`, and `install()` are experimental and require capability detection. `webkitSpeechRecognition` may be network-backed and is never described as local unless `processLocally=true` is explicitly supported and selected.

`speechSynthesis` has wider browser coverage, but voice inventory and event behavior vary by OS. Kalo stores `voiceURI` but safely falls back to another matching local voice if the selected voice disappears.
