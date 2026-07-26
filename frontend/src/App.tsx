import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { base44, requireBase44 } from './lib/base44'
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
}

type WitnessEvidence = {
  id: string
  kind: string
  label?: string
  mime_type?: string
  created_date?: string
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

function WitnessMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`witness-mark${compact ? ' witness-mark--compact' : ''}`} aria-label="Witness">
      <span>W</span>
    </span>
  )
}

function Stamp({ children, tone = 'ink' }: { children: ReactNode; tone?: 'ink' | 'red' | 'blue' }) {
  return <span className={`stamp stamp--${tone}`}>{children}</span>
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
    const next = Array.from(event.target.files ?? []).slice(0, 3)
    setFiles(next)
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

    try {
      setCaptureBusy(true)
      const client = requireBase44() as any
      const uploadedEvidence = await Promise.all(files.map(async (file) => {
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
      base44.auth.redirectToLogin(window.location.href)
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
                  <label className="field field--statement">
                    <span>What happened?</span>
                    <textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={1} maxLength={3000} required placeholder="Use the customer’s exact words. What did they expect, where did it break, and what is the consequence?" />
                    <small>{message.length}/3000</small>
                  </label>
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
                    <div className="evidence-upload__label"><span className="evidence-marker">01</span><div><strong>Attach evidence</strong><small>Up to 3 files. Files stay private.</small></div></div>
                    <label className="upload-trigger">
                      <input type="file" accept="image/*,audio/*,video/*,.pdf,.txt,.doc,.docx" multiple onChange={onFilesChanged} />
                      <span>SELECT FILES</span>
                    </label>
                    <div className="file-list">
                      {files.length ? files.map((file, index) => <span key={`${file.name}-${index}`}><b>{String(index + 1).padStart(2, '0')}</b> {file.name}</span>) : <span>No evidence attached yet.</span>}
                    </div>
                  </div>
                  {captureError && <p className="form-error" role="alert">{captureError}</p>}
                  <div className="form-footer">
                    <p><WitnessMark compact /> Submitting creates a private record. No public profile. No shared inbox.</p>
                    <button className="button button--primary" type="submit" disabled={captureBusy}>{captureBusy ? 'RECORDING…' : 'PUT IT ON THE RECORD'} <span>→</span></button>
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
                    <div className="outcome-sheet__status"><Stamp tone={publicStatus.witness.status === 'resolved' ? 'red' : 'ink'}>{humanize(publicStatus.witness.status)}</Stamp><span>{publicStatus.witness.public_ref}</span></div>
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
                      {packets.length ? packets.map((packet, index) => <button key={packet.id} onClick={() => setSelectedId(packet.id)} className={`packet-row${packet.id === selectedId ? ' is-selected' : ''}`}><span className="packet-row__index">{String(index + 1).padStart(2, '0')}</span><span className="packet-row__body"><b>{packet.page_title || 'Customer report'}</b><small>{packet.message}</small><em>{humanize(packet.status)}</em></span></button>) : <div className="packet-inbox__empty">No live packets.<br />The record is clear.</div>}
                    </aside>

                    <article className="packet-detail">
                      {selectedPacket ? (
                        <>
                          <div className="packet-detail__head"><span>WITNESS PACKET / {selectedPacket.public_ref.slice(-8)}</span><Stamp tone={selectedPacket.status === 'resolved' ? 'red' : 'ink'}>{humanize(selectedPacket.status)}</Stamp></div>
                          <div className="packet-detail__quote"><span className="oversized-quote">“</span><blockquote>{selectedPacket.message}</blockquote></div>
                          <div className="packet-metadata"><span><b>Submitted</b>{formatDate(selectedPacket.created_date)}</span><span><b>Context</b>{selectedPacket.page_title || selectedPacket.page_url || 'Not supplied'}</span><span><b>Severity</b>{humanize(selectedPacket.severity)}</span></div>
                          <section className="evidence-board"><div className="evidence-board__head"><span>Evidence</span><span>{String(evidence.length).padStart(2, '0')} ITEMS</span></div>{evidence.length ? evidence.map((item, index) => <button className="evidence-tile" key={item.id} onClick={() => void openEvidence(item.id)}><span className="evidence-marker">{String(index + 1).padStart(2, '0')}</span><div><b>{item.label || `${humanize(item.kind)} evidence`}</b><small>{item.mime_type || humanize(item.kind)}</small></div><span className="evidence-tile__open">VIEW ↗</span></button>) : <div className="evidence-board__empty">No attachments. Customer statement is the primary evidence.</div>}</section>
                          <section className="event-chain"><div className="event-chain__head"><span>CHAIN OF EVENTS</span><span className="red-thread" /></div>{events.map((item, index) => <div className={`event-row${item.visibility === 'public' ? ' event-row--public' : ''}`} key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{humanize(item.event_type)}</b><p>{item.message || 'Internal state changed.'}</p></div><time>{formatDate(item.created_date)}</time></div>)}</section>
                        </>
                      ) : <div className="packet-detail__empty"><WitnessMark /><h2>Select a packet.</h2><p>Every action leaves a visible chain of events.</p></div>}
                    </article>

                    <aside className="ownership-strip">
                      <div className="ownership-strip__top"><Stamp tone="red">OWNERSHIP</Stamp><span className="vertical-witness" /></div>
                      <p>Accept the work. State what changes. Let the customer know.</p>
                      <label className="field"><span>Public update</span><textarea value={publicMessage} onChange={(event) => setPublicMessage(event.target.value)} maxLength={3000} placeholder="What can the customer be told now?" /></label>
                      <label className="field"><span>Resolution record</span><textarea value={resolution} onChange={(event) => setResolution(event.target.value)} maxLength={3000} placeholder="What was fixed, changed, or decided?" /></label>
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
