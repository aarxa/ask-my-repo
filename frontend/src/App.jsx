import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import './App.css'

const API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

function App() {
  const normalizeRepoInput = (value = '', { finalize = false } = {}) => {
    let cleaned = value
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/^github\.com\//i, '')
      .replace(/^\/+/, '')

    if (finalize) {
      cleaned = cleaned
        .replace(/\/+$/, '')
        .replace(/\.git$/i, '')
    }

    return cleaned
  }

  const [repoUrl, setRepoUrl] = useState('')
  const [collectionId, setCollectionId] = useState(null)
  const [question, setQuestion] = useState('')
  const [chatHistory, setChatHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [activeTab, setActiveTab] = useState('ask')
  const [deadCodeResult, setDeadCodeResult] = useState(null)
  const [deadCodeError, setDeadCodeError] = useState('')
  const [improvementsResult, setImprovementsResult] = useState(null)
  const [files, setFiles] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [ingestStats, setIngestStats] = useState(null)
  const [ingestProgress, setIngestProgress] = useState(0)
  const [showIngestOverlay, setShowIngestOverlay] = useState(false)
  const [ingestMessage, setIngestMessage] = useState('Preparing repository analysis...')
  const [ingestUpdates, setIngestUpdates] = useState([])
  const chatEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  const ingest = async () => {
    if (!finalizedRepoSlug) return

    setLoading(true)
    setStatus('loading')
    setChatHistory([])
    setDeadCodeResult(null)
    setImprovementsResult(null)
    setSelectedFile(null)
    setIngestStats(null)
    setShowIngestOverlay(true)
    setIngestProgress(3)
    setIngestMessage('fetching files from repo')
    setIngestUpdates(['fetching files from repo'])
    const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    let pollTimer = null

    const syncProgress = async () => {
      try {
        const statusRes = await axios.get(`${API}/ingest-status/${jobId}`)
        const state = statusRes.data || {}
        if (typeof state.progress === 'number') {
          setIngestProgress(Math.max(3, Math.min(state.progress, 99)))
        }
        if (state.message) {
          setIngestMessage(state.message)
        }
        if (Array.isArray(state.updates) && state.updates.length > 0) {
          setIngestUpdates(state.updates)
        }
      } catch (e) {
        // Status may not be ready yet; keep polling.
      }
    }

    pollTimer = setInterval(syncProgress, 450)

    try {
      const res = await axios.post(`${API}/ingest`, { repo_url: finalizedRepoUrl, job_id: jobId })
      await syncProgress()
      clearInterval(pollTimer)
      setIngestMessage('almost done')
      setIngestUpdates((prev) => prev.includes('almost done') ? prev : [...prev, 'almost done'])
      const filesRes = await axios.get(`${API}/files/${res.data.collection_id}`)
      setIngestProgress(100)
      await new Promise(resolve => setTimeout(resolve, 420))

      setCollectionId(res.data.collection_id)
      setIngestStats(res.data)
      setStatus('ready')
      setFiles(filesRes.data.files)
      setShowIngestOverlay(false)
    } catch (e) {
      setStatus('error')
      clearInterval(pollTimer)
      setIngestMessage('failed to ingest repository')
      setShowIngestOverlay(false)
    }
    setLoading(false)
  }

  const ask = async () => {
    if (!question.trim()) return
    const userQuestion = question
    setQuestion('')
    setChatHistory(prev => [...prev, { role: 'user', content: userQuestion }])
    setLoading(true)
    try {
      const res = await axios.post(`${API}/ask`, {
        collection_id: collectionId,
        question: selectedFile ? `Regarding the file ${selectedFile.path}: ${userQuestion}` : userQuestion,
        chat_history: chatHistory
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .reduce((acc, m, i, arr) => {
            if (m.role === 'user' && arr[i + 1]?.role === 'assistant') {
              acc.push({ question: m.content, answer: arr[i + 1].content })
            }
            return acc
          }, [])
      })
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: res.data.answer,
        sources: res.data.sources
      }])
    } catch (e) {
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: 'Something went wrong. Please try again.'
      }])
    }
    setLoading(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask()
    }
  }

  const getDeadCode = async () => {
    if (!finalizedRepoSlug) return

    setLoading(true)
    setDeadCodeResult(null)
    setDeadCodeError('')
    try {
      const res = await axios.post(`${API}/dead-code`, { repo_url: finalizedRepoUrl })
      const data = res.data || {}
      const findings = Array.isArray(data.dead_code_findings)
        ? data.dead_code_findings
        : Array.isArray(data.findings)
          ? data.findings
          : []
      const count = Number.isFinite(data.count) ? data.count : findings.length
      setDeadCodeResult({
        ...data,
        count,
        dead_code_findings: findings
      })
    } catch (e) {
      setDeadCodeError('Scan failed. Please try again.')
    }
    setLoading(false)
  }

  const getImprovements = async () => {
    setLoading(true)
    setImprovementsResult(null)
    try {
      const res = await axios.post(`${API}/improvements`, { collection_id: collectionId, question: '' })
      setImprovementsResult(res.data)
    } catch (e) { }
    setLoading(false)
  }

  const getFileIcon = (path) => {
    if (path.endsWith('.py')) return 'PY'
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'JS'
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'TS'
    if (path.endsWith('.css')) return 'CSS'
    if (path.endsWith('.md')) return 'MD'
    if (path.endsWith('.json')) return 'JSON'
    if (path.endsWith('.cpp') || path.endsWith('.c') || path.endsWith('.h')) return 'C'
    if (path.endsWith('.go')) return 'GO'
    if (path.endsWith('.rs')) return 'RS'
    return 'FILE'
  }

  const suggestions = [
    'What does this app do?',
    'How is the database set up?',
    'What are the main entry points?',
    'Are there any security concerns?'
  ]
  const repoSlug = normalizeRepoInput(repoUrl)
  const finalizedRepoSlug = normalizeRepoInput(repoUrl, { finalize: true })
  const finalizedRepoUrl = finalizedRepoSlug ? `https://github.com/${finalizedRepoSlug}` : ''
  const topFiles = files.slice(0, 3)

  const escapeHtml = (text) => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const formatInline = (text) => {
    const safe = escapeHtml(text)
    return safe
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  }

  const renderMessageContent = (text) => {
    if (!text) return null
    const blocks = text.split(/```/)
    return blocks.map((block, index) => {
      if (index % 2 === 1) {
        const firstBreak = block.indexOf('\n')
        const maybeLang = firstBreak === -1 ? block.trim() : block.slice(0, firstBreak).trim()
        const looksLikeLang = /^[a-zA-Z0-9#+._-]+$/.test(maybeLang)
        const code = firstBreak === -1
          ? block
          : looksLikeLang ? block.slice(firstBreak + 1) : block
        return (
          <pre key={`code-${index}`} className="formatted-code-block">
            {looksLikeLang && <span className="code-lang">{maybeLang}</span>}
            <code>{code.trim()}</code>
          </pre>
        )
      }

      const lines = block.split('\n').filter(line => line.trim() !== '')
      const elements = []
      let listBuffer = []
      let listType = null
      let orderedSections = []

      const flushOrderedSections = (keyBase) => {
        if (orderedSections.length > 0) {
          elements.push(
            <ol key={`ordered-${keyBase}`} className="formatted-list ordered">
              {orderedSections.map((item, itemIndex) => (
                <li key={`ordered-item-${keyBase}-${itemIndex}`} className="formatted-ordered-item">
                  <span
                    className="formatted-ordered-main"
                    dangerouslySetInnerHTML={{ __html: formatInline(item.title) }}
                  />
                  {item.notes.map((note, noteIndex) => (
                    <p
                      key={`ordered-note-${keyBase}-${itemIndex}-${noteIndex}`}
                      className="formatted-subparagraph"
                      dangerouslySetInnerHTML={{ __html: formatInline(note) }}
                    />
                  ))}
                  {item.bullets.length > 0 && (
                    <ul className="formatted-list formatted-sublist">
                      {item.bullets.map((bullet, bulletIndex) => (
                        <li
                          key={`ordered-bullet-${keyBase}-${itemIndex}-${bulletIndex}`}
                          dangerouslySetInnerHTML={{ __html: formatInline(bullet) }}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )
          orderedSections = []
        }
      }

      const flushList = (keyBase) => {
        if (listBuffer.length > 0) {
          flushOrderedSections(`${keyBase}-before-list`)
          if (listType === 'ordered') {
            elements.push(
              <ol key={`list-${keyBase}`} className="formatted-list ordered">
                {listBuffer.map((item, itemIndex) => (
                  <li key={`item-${keyBase}-${itemIndex}`} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
                ))}
              </ol>
            )
          } else {
            elements.push(
              <ul key={`list-${keyBase}`} className="formatted-list">
                {listBuffer.map((item, itemIndex) => (
                  <li key={`item-${keyBase}-${itemIndex}`} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
                ))}
              </ul>
            )
          }
          listBuffer = []
          listType = null
        }
      }

      lines.forEach((line, lineIndex) => {
        const trimmed = line.trim()

        if (/^#{1,6}\s+/.test(trimmed)) {
          flushList(`${index}-${lineIndex}-before-heading`)
          flushOrderedSections(`${index}-${lineIndex}-before-heading`)
          const level = Math.min(trimmed.match(/^#+/)[0].length, 6)
          const title = trimmed.replace(/^#{1,6}\s+/, '')
          elements.push(
            <p
              key={`title-${index}-${lineIndex}`}
              className={`formatted-heading level-${level}`}
              dangerouslySetInnerHTML={{ __html: formatInline(title) }}
            />
          )
          return
        }

        if (/^\d+\.\s+/.test(trimmed)) {
          flushList(`${index}-${lineIndex}-before-ordered`)
          orderedSections.push({
            title: trimmed.replace(/^\d+\.\s+/, ''),
            bullets: [],
            notes: []
          })
          return
        }

        if (/^([-*•]|o)\s+/.test(trimmed)) {
          if (orderedSections.length > 0) {
            orderedSections[orderedSections.length - 1].bullets.push(trimmed.replace(/^([-*•]|o)\s+/, ''))
            return
          }
          if (listType && listType !== 'unordered') {
            flushList(`${index}-${lineIndex}-switch`)
          }
          listType = 'unordered'
          listBuffer.push(trimmed.replace(/^([-*•]|o)\s+/, ''))
          return
        }

        if (orderedSections.length > 0 && /^([A-Za-z][^:]{0,80}):$/.test(trimmed)) {
          orderedSections[orderedSections.length - 1].notes.push(trimmed)
          return
        }
        if (orderedSections.length > 0) {
          orderedSections[orderedSections.length - 1].notes.push(trimmed)
          return
        }

        flushList(`${index}-${lineIndex}`)
        flushOrderedSections(`${index}-${lineIndex}-paragraph`)
        if (/^([A-Za-z][A-Za-z\s/&-]{1,40}):$/.test(trimmed)) {
          elements.push(
            <p
              key={`label-${index}-${lineIndex}`}
              className="formatted-heading level-4"
              dangerouslySetInnerHTML={{ __html: formatInline(trimmed) }}
            />
          )
          return
        }
        elements.push(
          <p
            key={`para-${index}-${lineIndex}`}
            className="formatted-paragraph"
            dangerouslySetInnerHTML={{ __html: formatInline(trimmed) }}
          />
        )
      })

      flushList(`${index}-end`)
      flushOrderedSections(`${index}-end`)

      return <div key={`block-${index}`}>{elements}</div>
    })
  }

  const getSourceGroups = (sources = []) => {
    const grouped = {}
    sources.forEach((source) => {
      const parts = source.path.split('/')
      const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root'
      if (!grouped[folder]) grouped[folder] = []
      grouped[folder].push(source)
    })
    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]))
  }

  const goHome = () => {
    if (loading) return
    setCollectionId(null)
    setActiveTab('ask')
    setQuestion('')
    setChatHistory([])
    setDeadCodeResult(null)
    setDeadCodeError('')
    setImprovementsResult(null)
    setSelectedFile(null)
    setFiles([])
    setIngestStats(null)
    setStatus('')
    setShowIngestOverlay(false)
    setIngestProgress(0)
    setIngestMessage('Preparing repository analysis...')
    setIngestUpdates([])
  }

  return (
    <div className={`app ${showIngestOverlay ? 'overlay-active' : ''}`}>
      {/* Top navbar */}
      <nav className="navbar">
        <div className="navbar-left">
          <button type="button" className="logo logo-button" onClick={goHome} aria-label="Go to Home">
            <span className="logo-icon">⬡</span>
            <span className="logo-text">ask<span className="logo-accent">myrepo</span></span>
          </button>
          <span className="navbar-divider" />
          <span className="navbar-tagline">AI codebase intelligence</span>
        </div>
        <div className="navbar-right">
          <div className="ingest-bar">
            <span className="ingest-prefix">github.com/</span>
            <input
              value={repoSlug}
              onChange={e => setRepoUrl(`https://github.com/${normalizeRepoInput(e.target.value)}`)}
              placeholder="user/repository"
              disabled={loading}
              onKeyDown={e => e.key === 'Enter' && ingest()}
              className="ingest-input"
            />
            <button onClick={ingest} disabled={loading || !finalizedRepoSlug} className="ingest-btn">
              {loading && status === 'loading' ? (
                <span className="btn-spinner" />
              ) : (
                'Analyze'
              )}
            </button>
          </div>
          {status === 'ready' && ingestStats && (
            <div className="ingest-badge">
              <span className="badge-dot" />
              {ingestStats.files_found} files · {ingestStats.chunks_stored} chunks
            </div>
          )}
        </div>
      </nav>
      {showIngestOverlay && (
        <div className="ingest-overlay">
          <div className="ingest-flight-chip">
            <span className="ingest-flight-label">github.com/{repoSlug || 'owner/repository'}</span>
          </div>
          <div className="ingest-modal">
            <p className="ingest-modal-title">Analyzing Repository</p>
            <p className="ingest-modal-subtitle">{ingestMessage}</p>
            <div className="ingest-progress-row">
              <div className="ingest-progress-track">
                <span className="ingest-progress-fill" style={{ width: `${ingestProgress}%` }} />
              </div>
              <p className="ingest-progress-value">{ingestProgress}%</p>
            </div>
            <div className="ingest-update-list">
              {ingestUpdates.slice(-5).map((update, idx) => (
                <p key={`${update}-${idx}`}>{update}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="app-content">
        {/* Main content */}
        {!collectionId ? (
          <div className="empty-state">
            <div className="empty-grid" />
            <div className="empty-content">
              <div className="empty-icon">⬡</div>
              <h1 className="empty-title">Ask anything about any codebase</h1>
              <p className="empty-subtitle">
                Paste a GitHub repo URL above. Ask questions, detect dead code,<br />
                get architectural insights — all powered by AI.
              </p>
              <div className="empty-features">
                <div className="feature-pill">Natural language Q&A</div>
                <div className="feature-pill">Dead code detection</div>
                <div className="feature-pill">AI code review</div>
                <div className="feature-pill">File-level analysis</div>
              </div>
              <div className="onboarding-steps">
                <div className="step-card">
                  <span className="step-number">1</span>
                  <p><strong>Paste a repo path</strong><br />Use `owner/repo` in the top search bar.</p>
                </div>
                <div className="step-card">
                  <span className="step-number">2</span>
                  <p><strong>Run Analyze</strong><br />We ingest files and build searchable context.</p>
                </div>
                <div className="step-card">
                  <span className="step-number">3</span>
                  <p><strong>Ask and review</strong><br />Chat, detect dead code, and request AI review.</p>
                </div>
              </div>
              <div className="repo-samples">
                {['vercel/next.js', 'pallets/flask', 'vitejs/vite'].map(sample => (
                  <button key={sample} className="sample-pill" onClick={() => setRepoUrl(`https://github.com/${sample}`)}>
                    Try {sample}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="workspace">
          {/* File tree sidebar */}
          <aside className="sidebar">
            <div className="repo-context-card">
              <p className="repo-context-label">Current Repository</p>
              <p className="repo-context-name">{repoSlug}</p>
              {ingestStats && (
                <div className="repo-context-stats">
                  <span>{ingestStats.files_found} files indexed</span>
                  <span>{ingestStats.chunks_stored} chunks embedded</span>
                </div>
              )}
              {topFiles.length > 0 && (
                <div className="repo-context-files">
                  {topFiles.map(file => (
                    <span key={file.path}>{file.path.split('/').pop()}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="sidebar-header">
              <span className="sidebar-title">Files</span>
              <span className="sidebar-count">{files.length}</span>
            </div>
            {selectedFile && (
              <button
                className="clear-file-btn"
                onClick={() => {
                  setSelectedFile(null)
                  setChatHistory(prev => [...prev, {
                    role: 'system-note',
                    content: '— Back to full repo context —'
                  }])
                }}
              >
                Clear selection
              </button>
            )}
            <div className="file-list">
              {files.map(f => (
                <div
                  key={f.path}
                  className={`file-item ${selectedFile?.path === f.path ? 'active' : ''}`}
                  onClick={() => setSelectedFile(f)}
                  title={f.path}
                >
                  <span className="file-icon">{getFileIcon(f.path)}</span>
                  <span className="file-name">{f.path.split('/').pop()}</span>
                  {f.path.includes('/') && (
                    <span className="file-dir">{f.path.split('/').slice(0, -1).join('/')}</span>
                  )}
                </div>
              ))}
            </div>
          </aside>

          {/* Main panel */}
          <main className="main-panel">
            {/* Tabs */}
            <div className="tabs">
              {[
                { id: 'ask', label: 'Chat' },
                { id: 'improvements', label: 'Review' },
                { id: 'deadcode', label: 'Dead Code' },
              ].map(tab => (
                <button
                  key={tab.id}
                  className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Chat tab */}
            {activeTab === 'ask' && (
              <div className="chat-wrap">
                <div className="tab-intro">
                  <h2>Repository Chat</h2>
                  <p>Ask architecture, behavior, or implementation questions in natural language.</p>
                </div>
                {selectedFile && (
                  <div className="file-context-banner">
                    <span className="file-icon badge">{getFileIcon(selectedFile.path)}</span>
                    <span>Focused on <strong>{selectedFile.path}</strong></span>
                    <a href={selectedFile.url} target="_blank" rel="noreferrer" className="view-file-link">
                      View on GitHub ↗
                    </a>
                  </div>
                )}

                <div className="chat-messages">
                  {chatHistory.length === 0 ? (
                    <div className="chat-empty">
                      <p className="chat-empty-title">Ask anything about the codebase</p>
                      <div className="suggestion-grid">
                        {suggestions.map(s => (
                          <button
                            key={s}
                            className="suggestion-chip"
                            onClick={() => { setQuestion(s); inputRef.current?.focus() }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    chatHistory.map((msg, i) => (
                      msg.role === 'system-note' ? (
                        <div key={i} className="system-note">{msg.content}</div>
                      ) : (
                        <div key={i} className={`message ${msg.role}`} style={{ animationDelay: `${Math.min(i * 0.03, 0.22)}s` }}>
                          <div className="message-bubble">
                            <div className="message-content">
                              {renderMessageContent(msg.content)}
                            </div>
                            {msg.sources?.length > 0 && (
                              <div className="source-groups">
                                {getSourceGroups(msg.sources).map(([folder, items]) => (
                                  <div key={folder} className="source-group">
                                    <p className="source-group-title">{folder}</p>
                                    <div className="source-pills">
                                      {items.map(s => (
                                        <a key={s.path} href={s.url} target="_blank" rel="noreferrer" className="source-pill">
                                          <span className="file-icon badge">{getFileIcon(s.path)}</span>
                                          {s.path.split('/').pop()}
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    ))
                  )}
                  {loading && activeTab === 'ask' && (
                    <div className="message assistant">
                      <div className="message-bubble typing-bubble">
                        <span /><span /><span />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="chat-input-area">
                  <textarea
                    ref={inputRef}
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={selectedFile ? `Ask about ${selectedFile.path.split('/').pop()}...` : 'Ask about the codebase... (Enter to send)'}
                    disabled={loading}
                    rows={2}
                    className="chat-textarea"
                  />
                  <div className="chat-input-actions">
                    {chatHistory.length > 0 && (
                      <button className="ghost-btn" onClick={() => setChatHistory([])}>
                        Clear chat
                      </button>
                    )}
                    <button
                      className="send-btn"
                      onClick={ask}
                      disabled={loading || !question.trim()}
                    >
                      Send →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Dead code tab */}
            {activeTab === 'deadcode' && (
              <div className="panel-content">
                <div className="panel-header">
                  <div>
                    <h2 className="panel-title">Dead Code Detection</h2>
                    <p className="panel-desc">Scans for unused functions, variables, and imports using static analysis.</p>
                  </div>
                  <button className="action-btn" onClick={getDeadCode} disabled={loading}>
                    {loading ? <><span className="btn-spinner" /> Scanning...</> : 'Run Scan'}
                  </button>
                </div>
                {!deadCodeResult && (
                  <div className="panel-empty">
                    <p>Run a static scan to find likely unused imports, variables, and functions.</p>
                    <ul>
                      <li>Best after ingesting the full repo</li>
                      <li>Review flagged entries before deletion</li>
                      <li>Use chat to verify suspicious findings</li>
                    </ul>
                  </div>
                )}
                {deadCodeError && (
                  <div className="panel-error">{deadCodeError}</div>
                )}
                {deadCodeResult && (
                  <div className="results-area">
                    <div className="results-summary">
                      <span className={deadCodeResult.count === 0 ? 'summary-good' : 'summary-warn'}>
                        {deadCodeResult.count === 0 ? 'No dead code found' : `${deadCodeResult.count} issue${deadCodeResult.count !== 1 ? 's' : ''} found`}
                      </span>
                    </div>
                    {deadCodeResult.dead_code_findings.length === 0 ? (
                      <div className="finding-row">
                        <code className="finding-text">No findings returned by scanner.</code>
                      </div>
                    ) : deadCodeResult.dead_code_findings.map((f, i) => (
                      <div key={i} className="finding-row">
                        <span className="finding-dot" />
                        <code className="finding-text">{f}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Improvements tab */}
            {activeTab === 'improvements' && (
              <div className="panel-content">
                <div className="panel-header">
                  <div>
                    <h2 className="panel-title">AI Code Review</h2>
                    <p className="panel-desc">GPT-4o analyzes architecture, security, and code quality.</p>
                  </div>
                  <button className="action-btn" onClick={getImprovements} disabled={loading}>
                    {loading ? <><span className="btn-spinner" /> Analyzing...</> : 'Run Analysis'}
                  </button>
                </div>
                {!improvementsResult && (
                  <div className="panel-empty">
                    <p>Generate a structured quality review across architecture, maintainability, and security.</p>
                    <ul>
                      <li>Use after analyzing a repository</li>
                      <li>Turn recommendations into chat follow-up tasks</li>
                      <li>Prioritize high-impact fixes first</li>
                    </ul>
                  </div>
                )}
                {improvementsResult && (
                  <div className="results-area">
                    <div className="analysis-text">
                      {renderMessageContent(improvementsResult.analysis)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
