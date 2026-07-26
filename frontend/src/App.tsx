import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { base44, requireBase44 } from './lib/base44'
import witnessMarkSrc from './assets/witness-mark.png'
import './App.css'

type View = 'capture' | 'status' | 'triage'
type PacketStatus = 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'closed' | 'spam'
type Severity = 'unknown' | 'low' | 'medium' | 'high' | 'critical'

type WitnessPacket = {
  id: string
  public_ref: string
  message: string
  status: PacketStatus
  severity: Severity
  created_date?: string
  page_url?: string
  page_title?: string
  user_intent?: string
  assigned_to_email?: string
  resolution_summary?: string
  reporter_email?: string
  evidence_count?: number
  ai_summary?: string
  ai_suggested_severity?: Severity
  ai_spam_score?: number
  ai_spam_reason?: string
}

type WitnessEvidence = {
  id: string
  kind: string
  label?: string
  mime_type?: string
  created_date?: string
  transcript?: string
}

type WitnessEvent = {
  id: string
  event_type: string
  message?: string
  visibility: 'public' | 'internal'
  actor_kind?: string
  created_date?: string
}

type PublicStatus = {
  witness: Pick<WitnessPacket, 'public_ref' | 'status' | 'message' | 'resolution_summary'> & { created_at?: string }
  updates: WitnessEvent[]
}

const APP_ID = import.meta.env.VITE_BASE44_APP_ID
const SITE_KEY = import.meta.env.VITE_WITNESS_SITE_KEY
const REF_STORAGE_KEY = 'witness:last-public-ref'

const copy = {
  capture: {
    eyebrow: 'OPEN A WITNESS PACKET',
    title: 'Put the customer’s exact words on the record.',
    description: 'Capture context before it disappears into a direct message, support queue, or somebody’s memory.',
  },
  status: {
    eyebrow: 'CHECK THE RECORD',
    title: 'A public outcome, not a black hole.',
    description: 'Use the private reference from your receipt to see only the updates meant for you.',
  },
  triage: {
    eyebrow: 'INTERNAL OPERATIONS',
    title: 'Every issue has a chain of custody.',
    description: 'Review the evidence, accept responsibility, and leave a clear customer-facing outcome.',
  },
}

function formatDate(value?: string) {
  if (!value) return 'Not recorded'
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function humanize(value?: string) {
  return (value ?? 'new').replaceAll('_', ' ')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something interrupted the record. Try again.'
}

function isImage(file: File) {
  return file.type.startsWith('image/')
}

function formatSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const canRecordAudio = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

function WitnessMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`witness-mark${compact ? ' witness-mark--compact' : ''}`}>
      <img src={witnessMarkSrc} alt="Witness" />
    </span>
  )
}

type Tone = 'ink' | 'red' | 'blue' | 'green'

function Stamp({ children, tone = 'ink' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`stamp stamp--${tone}`}>{children}</span>
}

function toneForStatus(status?: PacketStatus): Tone {
  if (status === 'resolved') return 'green'
  if (status === 'acknowledged' || status === 'investigating') return 'blue'
  if (status === 'closed' || status === 'spam') return 'ink'
  return 'red'
}

function toneForSeverity(severity?: Severity): Tone {
  if (severity === 'critical' || severity === 'high') return 'red'
  if (severity === 'medium') return 'blue'
  return 'ink'
}

function toneForRisk(score?: number): Tone {
  if (score === undefined) return 'ink'
  if (score >= 0.66) return 'red'
  if (score >= 0.33) return 'blue'
  return 'green'
}

function App() {
  const [view, setView] = useState<View>('capture')
  const [message, setMessage] = useState('')
  const [intent, setIntent] = useState('')
  const [email, setEmail] = useState('')
  const [contactConsent, setContactConsent] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [captureBusy, setCaptureBusy] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const [statementMode, setStatementMode] = useState<'voice' | 'manual'>(canRecordAudio ? 'voice' : 'manual')
  const [statementPhase, setStatementPhase] = useState<'idle' | 'recording' | 'transcribing' | 'ready'>('idle')
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [waveform, setWaveform] = useState<number[]>(() => Array(36).fill(4))
  const [statementFile, setStatementFile] = useState<File | null>(null)
  const [statementBlobUrl, setStatementBlobUrl] = useState('')
  const [editingTranscript, setEditingTranscript] = useState(false)
  const [isPlayingOriginal, setIsPlayingOriginal] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const waveformRafRef = useRef<number | null>(null)
  const originalAudioRef = useRef<HTMLAudioElement | null>(null)
  const [receipt, setReceipt] = useState<{ publicRef: string; status: string } | null>(null)
  const [reference, setReference] = useState(() => localStorage.getItem(REF_STORAGE_KEY) ?? '')
  const [publicStatus, setPublicStatus] = useState<PublicStatus | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [triageError, setTriageError] = useState('')
  const [packets, setPackets] = useState<WitnessPacket[]>([])
  const [summary, setSummary] = useState<{ total: number; by_status: Record<string, number>; unassigned_open: number } | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [events, setEvents] = useState<WitnessEvent[]>([])
  const [evidence, setEvidence] = useState<WitnessEvidence[]>([])
  const [triageBusy, setTriageBusy] = useState(false)
  const [publicMessage, setPublicMessage] = useState('')
  const [resolution, setResolution] = useState('')
  const [draftingField, setDraftingField] = useState<'public_message' | 'resolution_summary' | ''>('')

  const selectedPacket = packets.find((packet) => packet.id === selectedId) ?? null
  const imageFile = useMemo(() => files.find(isImage), [files])
  const imagePreview = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : ''), [imageFile])

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
  }, [imagePreview])

  useEffect(() => {
    if (!base44) return

    void base44.auth.isAuthenticated()
      .then((authenticated) => setIsAdmin(authenticated))
      .catch(() => setIsAdmin(false))
  }, [])

  useEffect(() => {
    if (!isAdmin || view !== 'triage') return
    void loadTriage()
  }, [isAdmin, view])

  useEffect(() => {
    if (!isAdmin || !selectedId) {
      setEvents([])
      setEvidence([])
      return
    }

    void loadPacketDetail(selectedId)
  }, [isAdmin, selectedId])

  useEffect(() => {
    if (!base44 || !isAdmin) return

    const client = base44 as any
    const unsubscribe = client.entities.WitnessPacket.subscribe(() => void loadTriage())
    return () => unsubscribe()
  }, [isAdmin])

  async function loadTriage() {
    try {
      setTriageError('')
      const client = requireBase44() as any
      const [summaryResult, packetRows] = await Promise.all([
        client.functions.invoke('dashboard-summary', {}),
        client.entities.WitnessPacket.list('-created_date', 50),
      ])
      const nextPackets = packetRows as WitnessPacket[]
      setSummary(summaryResult.data)
      setPackets(nextPackets)
      setSelectedId((current) => current || nextPackets[0]?.id || '')
    } catch (error) {
      setTriageError(errorMessage(error))
    }
  }

  async function loadPacketDetail(packetId: string) {
    try {
      const client = requireBase44() as any
      const [eventRows, evidenceRows] = await Promise.all([
        client.entities.WitnessEvent.filter({ packet_id: packetId }, 'created_date', 100),
        client.entities.WitnessEvidence.filter({ packet_id: packetId }, '-created_date', 10),
      ])
      setEvents(eventRows as WitnessEvent[])
      setEvidence(evidenceRows as WitnessEvidence[])
    } catch (error) {
      setTriageError(errorMessage(error))
    }
  }

  function onFilesChanged(event: ChangeEvent<HTMLInputElement>) {
    const maxExtra = statementFile ? 2 : 3
    const next = Array.from(event.target.files ?? []).slice(0, maxExtra)
    setFiles(next)
  }

  function stopWaveformSampling() {
    if (waveformRafRef.current) {
      cancelAnimationFrame(waveformRafRef.current)
      waveformRafRef.current = null
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close()
      audioCtxRef.current = null
    }
  }

  useEffect(() => () => {
    if (recordTimerRef.current) window.clearInterval(recordTimerRef.current)
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
    stopWaveformSampling()
    if (statementBlobUrl) URL.revokeObjectURL(statementBlobUrl)
  }, [])

  async function startRecording() {
    setCaptureError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recordChunksRef.current = []

      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      audioCtxRef.current = audioCtx
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const sampleWaveform = () => {
        analyser.getByteTimeDomainData(dataArray)
        let peak = 0
        for (let i = 0; i < dataArray.length; i += 2) {
          const deviation = Math.abs(dataArray[i] - 128)
          if (deviation > peak) peak = deviation
        }
        const barHeight = Math.min(32, 4 + (peak / 128) * 34)
        setWaveform((prev) => [...prev.slice(1), barHeight])
        waveformRafRef.current = requestAnimationFrame(sampleWaveform)
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        stopWaveformSampling()
        if (recordTimerRef.current) {
          window.clearInterval(recordTimerRef.current)
          recordTimerRef.current = null
        }
        void handleRecordingReady()
      }

      recorder.start()
      recorderRef.current = recorder
      setWaveform(Array(36).fill(4))
      setStatementPhase('recording')
      setRecordSeconds(0)
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((seconds) => seconds + 1), 1000)
      sampleWaveform()
    } catch {
      setCaptureError('Microphone access was denied or is unavailable in this browser.')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
  }

  async function handleRecordingReady() {
    const recorder = recorderRef.current
    const blob = new Blob(recordChunksRef.current, { type: recorder?.mimeType || 'audio/webm' })
    const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
    const file = new File([blob], `statement-${Date.now()}.${extension}`, { type: blob.type })
    setStatementFile(file)
    setStatementBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(blob)
    })
    setStatementPhase('transcribing')

    if (!SITE_KEY) {
      setCaptureError('This build has no reporting-channel key. Add VITE_WITNESS_SITE_KEY before using voice capture.')
      setStatementPhase('idle')
      return
    }

    try {
      const client = requireBase44() as any
      const uploaded = await client.integrations.Core.UploadPrivateFile({ file })
      const result = await client.functions.invoke('transcribe-voice', { site_key: SITE_KEY, file_uri: uploaded.file_uri })
      const transcript = (result.data.transcript as string) || ''
      if (transcript) {
        setMessage(transcript)
        setStatementPhase('ready')
      } else {
        setCaptureError("We couldn't transcribe that clip clearly. You can type your statement instead, or record again.")
        setStatementPhase('ready')
      }
    } catch (error) {
      setCaptureError(errorMessage(error))
      setStatementPhase('idle')
    }
  }

  function recordAgain() {
    setMessage('')
    setStatementFile(null)
    setStatementBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return ''
    })
    setEditingTranscript(false)
    setStatementPhase('idle')
    setRecordSeconds(0)
    setWaveform(Array(36).fill(4))
  }

  function toggleOriginalPlayback() {
    const audio = originalAudioRef.current
    if (!audio) return
    if (isPlayingOriginal) {
      audio.pause()
    } else {
      void audio.play()
    }
  }

  async function submitCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCaptureError('')

    if (!SITE_KEY) {
      setCaptureError('This build has no reporting-channel key. Add VITE_WITNESS_SITE_KEY before using public capture.')
      return
    }

    if (contactConsent && !email.trim()) {
      setCaptureError('Add an email address if you want a response.')
      return
    }

    if (!message.trim()) {
      setCaptureError('Record or type a statement before submitting.')
      return
    }

    try {
      setCaptureBusy(true)
      const client = requireBase44() as any
      const evidenceFiles = statementFile ? [statementFile, ...files] : files
      const uploadedEvidence = await Promise.all(evidenceFiles.slice(0, 3).map(async (file) => {
        const upload = await client.integrations.Core.UploadPrivateFile({ file })
        return {
          kind: isImage(file) ? 'screenshot' : file.type.startsWith('audio/') ? 'voice' : file.type.startsWith('video/') ? 'video' : 'document',
          file_uri: upload.file_uri,
          label: file.name,
          mime_type: file.type || undefined,
        }
      }))

      const result = await client.functions.invoke('submit-witness', {
        site_key: SITE_KEY,
        message: message.trim(),
        user_intent: intent.trim() || undefined,
        reporter_email: email.trim() || undefined,
        contact_consent: contactConsent,
        page_url: window.location.href,
        page_title: document.title,
        evidence: uploadedEvidence,
        website: '',
      })
      const nextReceipt = { publicRef: result.data.public_ref, status: result.data.status }
      localStorage.setItem(REF_STORAGE_KEY, nextReceipt.publicRef)
      setReference(nextReceipt.publicRef)
      setReceipt(nextReceipt)
      setMessage('')
      setIntent('')
      setEmail('')
      setContactConsent(false)
      setFiles([])
      recordAgain()
    } catch (error) {
      setCaptureError(errorMessage(error))
    } finally {
      setCaptureBusy(false)
    }
  }

  async function lookupStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatusError('')
    setPublicStatus(null)

    try {
      setStatusBusy(true)
      const client = requireBase44() as any
      const result = await client.functions.invoke('public-witness-status', { public_ref: reference.trim() })
      setPublicStatus(result.data as PublicStatus)
    } catch (error) {
      setStatusError(errorMessage(error))
    } finally {
      setStatusBusy(false)
    }
  }

  async function runTriage(action: 'acknowledge' | 'investigate' | 'resolve') {
    if (!selectedPacket) return
    setTriageError('')

    if (action === 'resolve' && !resolution.trim()) {
      setTriageError('A resolution summary is required before this packet can be marked fixed.')
      return
    }

    try {
      setTriageBusy(true)
      const client = requireBase44() as any
      await client.functions.invoke('triage-witness', {
        packet_id: selectedPacket.id,
        action,
        public_message: publicMessage.trim() || undefined,
        resolution_summary: action === 'resolve' ? resolution.trim() : undefined,
      })
      setPublicMessage('')
      if (action === 'resolve') setResolution('')
      await loadTriage()
      await loadPacketDetail(selectedPacket.id)
    } catch (error) {
      setTriageError(errorMessage(error))
    } finally {
      setTriageBusy(false)
    }
  }

  async function draftWithAI(field: 'public_message' | 'resolution_summary') {
    if (!selectedPacket) return
    setTriageError('')

    try {
      setDraftingField(field)
      const client = requireBase44() as any
      const result = await client.functions.invoke('draft-public-update', {
        packet_id: selectedPacket.id,
        field,
      })
      const draft = result.data.draft as string
      if (field === 'public_message') setPublicMessage(draft)
      else setResolution(draft)
    } catch (error) {
      setTriageError(errorMessage(error))
    } finally {
      setDraftingField('')
    }
  }

  async function openEvidence(evidenceId: string) {
    try {
      const client = requireBase44() as any
      const result = await client.functions.invoke('get-evidence-access', { evidence_id: evidenceId, expires_in: 300 })
      window.open(result.data.signed_url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setTriageError(errorMessage(error))
    }
  }

  function enterTriage() {
    if (!base44) {
      setTriageError('Set VITE_BASE44_APP_ID before opening the operator workspace.')
      return
    }

    if (!isAdmin) {
      const loginUrl = new URL('https://app.base44.com/login')
      loginUrl.searchParams.set('app_id', APP_ID)
      loginUrl.searchParams.set('from_url', window.location.href)
      window.location.href = loginUrl.toString()
      return
    }

    setView('triage')
  }

  const activeCopy = copy[view]

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('capture')} aria-label="Witness home">
          <WitnessMark compact />
          <span>WITNESS</span>
        </button>
        <p className="topbar__statement">Customer friction, made accountable.</p>
        <div className="topbar__tools">
          <span className={`connection-dot${APP_ID ? ' connection-dot--live' : ''}`} />
          <span>{APP_ID ? 'BACKEND CONNECTED' : 'CONFIGURATION REQUIRED'}</span>
        </div>
      </header>

      <div className="workspace">
        <aside className="packet-rail" aria-label="Workspace navigation">
          <div className="packet-rail__header">
            <span className="rail-index">CASE FILE</span>
            <span className="rail-number">W/01</span>
          </div>
          <nav className="mode-switcher">
            <button className={view === 'capture' ? 'is-active' : ''} onClick={() => setView('capture')}>
              <span>01</span> Capture
            </button>
            <button className={view === 'status' ? 'is-active' : ''} onClick={() => setView('status')}>
              <span>02</span> Status
            </button>
            <button className={view === 'triage' ? 'is-active' : ''} onClick={enterTriage}>
              <span>03</span> Triage
            </button>
          </nav>
          <div className="rail-thread" aria-hidden="true"><span /></div>
          <div className="packet-tabs" aria-hidden="true">
            <span>STATEMENT</span>
            <span>EVIDENCE</span>
            <span>OUTCOME</span>
          </div>
          <div className="rail-footnote">
            <WitnessMark compact />
            <p>The red line marks work still owed to a customer.</p>
          </div>
        </aside>

        <section className="evidence-canvas">
          <div className="canvas-heading">
            <div>
              <p className="eyebrow">{activeCopy.eyebrow}</p>
              <h1>{activeCopy.title}</h1>
            </div>
            <p className="canvas-heading__description">{activeCopy.description}</p>
          </div>

          {view === 'capture' && (
            <section className="capture-layout" aria-label="Open a Witness Packet">
              {receipt ? (
                <div className="receipt-sheet" role="status">
                  <div className="receipt-sheet__header"><Stamp tone="red">RECEIVED</Stamp><span>WITNESS RECEIPT</span></div>
                  <h2>The record exists.</h2>
                  <p>Keep this reference private. It is the only way to check the customer-facing status without sharing your identity.</p>
                  <code>{receipt.publicRef}</code>
                  <div className="receipt-sheet__actions">
                    <button className="button button--primary" onClick={() => setView('status')}>Check status <span>→</span></button>
                    <button className="button button--secondary" onClick={() => setReceipt(null)}>Open another packet</button>
                  </div>
                </div>
              ) : (
                <form className="statement-sheet" onSubmit={submitCapture}>
                  <div className="sheet-masthead">
                    <span>WITNESS PACKET</span>
                    <span className="sheet-number">NEW / 01</span>
                  </div>
                  <div className="statement-block">
                    <div className="statement-block__head">
                      <span>01 CUSTOMER STATEMENT</span>
                      {canRecordAudio && <Stamp tone="blue">VOICE → TEXT</Stamp>}
                    </div>

                    {statementMode === 'voice' && canRecordAudio ? (
                      <div className="recorder-panel">
                        {statementPhase === 'idle' && (
                          <div className="recorder-idle">
                            <button type="button" className="recorder-button" onClick={() => void startRecording()} aria-label="Record your statement">
                              <span className="recorder-button__dot" />
                            </button>
                            <div>
                              <b>Record your statement</b>
                              <p>Speak naturally. Witness will turn this into text and keep the original voice as private evidence.</p>
                            </div>
                          </div>
                        )}

                        {statementPhase === 'recording' && (
                          <div className="recorder-active">
                            <button type="button" className="recorder-button recorder-button--stop" onClick={stopRecording} aria-label="Stop recording">
                              <span className="recorder-button__square" />
                            </button>
                            <div className="recorder-active__body">
                              <div className="recorder-active__head">
                                <span className="recorder-timer">{formatSeconds(recordSeconds)}</span>
                                <span className="recorder-status"><span className="record-dot" /> Recording</span>
                              </div>
                              <p>Speak naturally. Witness will turn this into text.</p>
                              <div className="waveform">
                                {waveform.map((height, index) => <span key={index} style={{ height: `${height}px` }} />)}
                              </div>
                            </div>
                          </div>
                        )}

                        {statementPhase === 'transcribing' && (
                          <div className="recorder-active">
                            <button type="button" className="recorder-button recorder-button--busy" disabled aria-label="Transcribing">
                              <span className="recorder-spinner" />
                            </button>
                            <div className="recorder-active__body">
                              <span className="recorder-status">Transcribing…</span>
                              <p>Turning your voice into an editable statement.</p>
                            </div>
                          </div>
                        )}

                        {statementPhase === 'ready' && (
                          <div className="transcript-ready">
                            <div className="transcript-ready__head">
                              <span className="recorder-status"><span className="record-dot record-dot--done" /> Recording complete</span>
                              <span>Speak naturally. Witness will turn this into text.</span>
                            </div>
                            <div className="waveform waveform--frozen">
                              {waveform.map((height, index) => <span key={index} style={{ height: `${height}px` }} />)}
                            </div>
                            {editingTranscript ? (
                              <textarea
                                className="transcript-editor"
                                value={message}
                                onChange={(event) => setMessage(event.target.value)}
                                maxLength={3000}
                                autoFocus
                                onBlur={() => setEditingTranscript(false)}
                              />
                            ) : (
                              <blockquote className="transcript-quote">{message || 'No speech detected. Try recording again or edit this by hand.'}</blockquote>
                            )}
                            <div className="transcript-actions">
                              <button type="button" onClick={toggleOriginalPlayback}>{isPlayingOriginal ? '⏸ PAUSE' : '▶ PLAY ORIGINAL'}</button>
                              <button type="button" onClick={() => setEditingTranscript((value) => !value)}>✎ {editingTranscript ? 'DONE EDITING' : 'EDIT TRANSCRIPT'}</button>
                              <button type="button" onClick={recordAgain}>↻ RECORD AGAIN</button>
                            </div>
                            {statementBlobUrl && (
                              <audio
                                ref={originalAudioRef}
                                src={statementBlobUrl}
                                onPlay={() => setIsPlayingOriginal(true)}
                                onPause={() => setIsPlayingOriginal(false)}
                                onEnded={() => setIsPlayingOriginal(false)}
                              />
                            )}
                          </div>
                        )}

                        <button type="button" className="mode-toggle-link" onClick={() => setStatementMode('manual')}>Prefer to type your statement instead?</button>
                      </div>
                    ) : (
                      <label className="field field--statement">
                        <textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={1} maxLength={3000} required placeholder="Use the customer’s exact words. What did they expect, where did it break, and what is the consequence?" />
                        <small>{message.length}/3000</small>
                        {canRecordAudio && <button type="button" className="mode-toggle-link" onClick={() => setStatementMode('voice')}>Prefer to record your statement instead?</button>}
                      </label>
                    )}
                  </div>
                  <div className="field-row">
                    <label className="field">
                      <span>What were you trying to do? <em>Optional</em></span>
                      <input value={intent} onChange={(event) => setIntent(event.target.value)} maxLength={500} placeholder="e.g. Complete an order before a deadline" />
                    </label>
                    <label className="field">
                      <span>Email for a response <em>Optional</em></span>
                      <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} placeholder="name@example.com" />
                    </label>
                  </div>
                  <label className="consent-field">
                    <input type="checkbox" checked={contactConsent} onChange={(event) => setContactConsent(event.target.checked)} />
                    <span>It is okay to contact me about this report.</span>
                  </label>
                  <div className="evidence-upload">
                    <div className="evidence-upload__label"><span className="evidence-marker">02</span><div><strong>Attach evidence (screenshots)</strong><small>{statementFile ? 'Up to 2 more files.' : 'Up to 3 files.'} Files stay private.</small></div></div>
                    <div className="evidence-upload__controls">
                      <label className="upload-trigger">
                        <input type="file" accept="image/*,audio/*,video/*,.pdf,.txt,.doc,.docx" multiple onChange={onFilesChanged} />
                        <span>SELECT FILES</span>
                      </label>
                    </div>
                    <div className="file-list">
                      {files.length ? files.map((file, index) => <span key={`${file.name}-${index}`}><b>{String(index + 1).padStart(2, '0')}</b> {file.name}</span>) : <span>No evidence attached yet.</span>}
                    </div>
                  </div>
                  {captureError && <p className="form-error" role="alert">{captureError}</p>}
                  <div className="form-footer">
                    <p><WitnessMark compact /> Submitting creates a private record. No public profile. No shared inbox.</p>
                    <button className="button button--primary" type="submit" disabled={captureBusy}>{captureBusy ? 'SAVING…' : 'PUT IT ON THE RECORD'} <span>→</span></button>
                  </div>
                </form>
              )}

              <aside className="capture-evidence-sheet" aria-label="Evidence preview">
                <div className="evidence-sheet__top"><span>EXHIBIT</span><span>01</span></div>
                {imagePreview ? <img src={imagePreview} alt="Selected evidence preview" /> : <div className="evidence-placeholder"><WitnessMark /><span>Evidence belongs here.</span><p>Screenshot a break. Record a contradiction. Keep the original context.</p></div>}
                <div className="annotation annotation--one">The detail people usually lose.</div>
                <div className="evidence-sheet__caption"><span>CAPTURED CONTEXT</span><span>PRIVATE BY DEFAULT</span></div>
              </aside>
            </section>
          )}

          {view === 'status' && (
            <section className="status-layout" aria-label="Check report status">
              <form className="lookup-sheet" onSubmit={lookupStatus}>
                <div className="sheet-masthead"><span>WITNESS REFERENCE</span><Stamp tone="blue">PRIVATE</Stamp></div>
                <label className="field field--reference">
                  <span>Enter your reference</span>
                  <input value={reference} onChange={(event) => setReference(event.target.value)} minLength={20} required placeholder="wtn_…" autoComplete="off" />
                </label>
                {statusError && <p className="form-error" role="alert">{statusError}</p>}
                <button className="button button--primary" type="submit" disabled={statusBusy}>{statusBusy ? 'CHECKING…' : 'CHECK THE RECORD'} <span>→</span></button>
                <p className="lookup-note">Your reference is stored only in this browser. It is not placed in a public URL.</p>
              </form>

              <div className="outcome-sheet">
                <div className="outcome-sheet__head"><span>PUBLIC OUTCOME</span><span className="red-bracket" /></div>
                {publicStatus ? (
                  <>
                    <div className="outcome-sheet__status"><Stamp tone={toneForStatus(publicStatus.witness.status)}>{humanize(publicStatus.witness.status)}</Stamp><span>{publicStatus.witness.public_ref}</span></div>
                    <blockquote>“{publicStatus.witness.message}”</blockquote>
                    {publicStatus.witness.resolution_summary && <div className="resolution-note"><span>RESOLUTION</span><p>{publicStatus.witness.resolution_summary}</p></div>}
                    <ol className="public-timeline">
                      {publicStatus.updates.map((update, index) => <li key={update.id}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{humanize(update.event_type)}</b><p>{update.message || 'Status updated.'}</p><small>{formatDate(update.created_date)}</small></div></li>)}
                    </ol>
                  </>
                ) : (
                  <div className="outcome-empty"><span className="oversized-quote">“</span><h2>The customer view shows only what matters.</h2><p>Search your reference to see the status, public updates, and final resolution. Never private evidence or internal notes.</p><Stamp>NOT YET OPENED</Stamp></div>
                )}
              </div>
            </section>
          )}

          {view === 'triage' && (
            <section className="triage-layout" aria-label="Internal Witness Packet triage">
              {!isAdmin ? (
                <div className="access-sheet"><Stamp tone="red">CONTROLLED ACCESS</Stamp><h2>Operator sign-in required.</h2><p>Customer reports, private evidence, and internal accountability belong to the assigned team.</p><button className="button button--primary" onClick={enterTriage}>SIGN IN <span>→</span></button></div>
              ) : (
                <>
                  <div className="triage-summary">
                    <div><span>TOTAL PACKETS</span><strong>{summary?.total ?? '—'}</strong></div>
                    <div><span>UNASSIGNED OPEN</span><strong className="in-red">{summary?.unassigned_open ?? '—'}</strong></div>
                    <div><span>LIVE OPERATOR</span><strong>{isAdmin ? 'YOU' : '—'}</strong></div>
                    <button className="button button--secondary" onClick={() => void loadTriage()}>REFRESH</button>
                  </div>
                  {triageError && <p className="form-error" role="alert">{triageError}</p>}
                  <div className="operator-grid">
                    <aside className="packet-inbox">
                      <div className="packet-inbox__head"><span>INBOX</span><span>{packets.length}</span></div>
                      {packets.length ? packets.map((packet, index) => <button key={packet.id} onClick={() => setSelectedId(packet.id)} className={`packet-row${packet.id === selectedId ? ' is-selected' : ''}`}><span className="packet-row__index">{String(index + 1).padStart(2, '0')}</span><span className="packet-row__body"><b>{packet.page_title || 'Customer report'}</b><small>{packet.message}</small><em className={`tone-${toneForStatus(packet.status)}`}>{humanize(packet.status)}</em></span></button>) : <div className="packet-inbox__empty">No live packets.<br />The record is clear.</div>}
                    </aside>

                    <article className="packet-detail">
                      {selectedPacket ? (
                        <>
                          <div className="packet-detail__head"><span>WITNESS PACKET / {selectedPacket.public_ref.slice(-8)}</span><Stamp tone={toneForStatus(selectedPacket.status)}>{humanize(selectedPacket.status)}</Stamp></div>
                          <div className="packet-detail__quote"><span className="oversized-quote">“</span><blockquote>{selectedPacket.message}</blockquote></div>
                          <div className="packet-metadata"><span><b>Submitted</b>{formatDate(selectedPacket.created_date)}</span><span><b>Context</b>{selectedPacket.page_title || selectedPacket.page_url || 'Not supplied'}</span><span><b>Severity</b><em className={`tone-${toneForSeverity(selectedPacket.severity)}`}>{humanize(selectedPacket.severity)}</em></span></div>
                          {(selectedPacket.ai_summary || selectedPacket.ai_suggested_severity || selectedPacket.ai_spam_score !== undefined) && (
                            <section className="ai-assist">
                              <div className="ai-assist__head"><span>AI Assist</span><span>Advisory only</span></div>
                              {selectedPacket.ai_summary && <p className="ai-assist__summary">{selectedPacket.ai_summary}</p>}
                              <div className="ai-assist__row">
                                {selectedPacket.ai_suggested_severity && <span>Suggested severity <em className={`tone-${toneForSeverity(selectedPacket.ai_suggested_severity)}`}>{humanize(selectedPacket.ai_suggested_severity)}</em></span>}
                                {selectedPacket.ai_spam_score !== undefined && <span>Spam risk <em className={`tone-${toneForRisk(selectedPacket.ai_spam_score)}`}>{Math.round(selectedPacket.ai_spam_score * 100)}%</em></span>}
                              </div>
                              {selectedPacket.ai_spam_reason && <p className="ai-assist__reason">{selectedPacket.ai_spam_reason}</p>}
                            </section>
                          )}
                          <section className="evidence-board">
                            <div className="evidence-board__head"><span>Evidence</span><span>{String(evidence.length).padStart(2, '0')} ITEMS</span></div>
                            {evidence.length ? evidence.map((item, index) => (
                              <div className="evidence-item" key={item.id}>
                                <button className="evidence-tile" onClick={() => void openEvidence(item.id)}>
                                  <span className="evidence-marker">{String(index + 1).padStart(2, '0')}</span>
                                  <div><b>{item.label || `${humanize(item.kind)} evidence`}</b><small>{item.mime_type || humanize(item.kind)}</small></div>
                                  <span className="evidence-tile__open">VIEW ↗</span>
                                </button>
                                {item.kind === 'voice' && (
                                  <p className="evidence-transcript">{item.transcript || 'Transcription unavailable for this recording.'}</p>
                                )}
                              </div>
                            )) : <div className="evidence-board__empty">No attachments. Customer statement is the primary evidence.</div>}
                          </section>
                          <section className="event-chain"><div className="event-chain__head"><span>CHAIN OF EVENTS</span><span className="red-thread" /></div>{events.map((item, index) => <div className={`event-row${item.visibility === 'public' ? ' event-row--public' : ''}`} key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{humanize(item.event_type)}</b><p>{item.message || 'Internal state changed.'}</p></div><time>{formatDate(item.created_date)}</time></div>)}</section>
                        </>
                      ) : <div className="packet-detail__empty"><WitnessMark /><h2>Select a packet.</h2><p>Every action leaves a visible chain of events.</p></div>}
                    </article>

                    <aside className="ownership-strip">
                      <div className="ownership-strip__top"><Stamp tone="red">OWNERSHIP</Stamp><span className="vertical-witness" /></div>
                      <p>Accept the work. State what changes. Let the customer know.</p>
                      <label className="field">
                        <span>Public update</span>
                        <textarea value={publicMessage} onChange={(event) => setPublicMessage(event.target.value)} maxLength={3000} placeholder="What can the customer be told now?" />
                      </label>
                      <button type="button" className="ai-draft-button" disabled={!selectedPacket || draftingField !== ''} onClick={() => void draftWithAI('public_message')}>{draftingField === 'public_message' ? 'DRAFTING…' : '✦ DRAFT WITH AI'}</button>
                      <label className="field">
                        <span>Resolution record</span>
                        <textarea value={resolution} onChange={(event) => setResolution(event.target.value)} maxLength={3000} placeholder="What was fixed, changed, or decided?" />
                      </label>
                      <button type="button" className="ai-draft-button" disabled={!selectedPacket || draftingField !== ''} onClick={() => void draftWithAI('resolution_summary')}>{draftingField === 'resolution_summary' ? 'DRAFTING…' : '✦ DRAFT WITH AI'}</button>
                      <div className="ownership-actions"><button className="button button--secondary" disabled={!selectedPacket || triageBusy} onClick={() => void runTriage('acknowledge')}>SEEN</button><button className="button button--secondary" disabled={!selectedPacket || triageBusy} onClick={() => void runTriage('investigate')}>INVESTIGATE</button><button className="button button--primary" disabled={!selectedPacket || triageBusy} onClick={() => void runTriage('resolve')}>{triageBusy ? 'SAVING…' : 'MARK FIXED'}</button></div>
                    </aside>
                  </div>
                </>
              )}
            </section>
          )}
        </section>
      </div>
    </main>
  )
}

export default App
