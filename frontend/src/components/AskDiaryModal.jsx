import React, { useState, useRef, useEffect } from 'react'
import { askDiary } from '../api'
import styles from './AskDiaryModal.module.css'

export default function AskDiaryModal({ onClose }) {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])  // { role: 'user'|'assistant', text, sources? }
  const [loading, setLoading]   = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const submit = async (e) => {
    e.preventDefault()
    const q = question.trim()
    if (!q || loading) return
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setQuestion('')
    setLoading(true)
    try {
      const res = await askDiary(q)
      setMessages(prev => [...prev, { role: 'assistant', text: res.answer, sources: res.sources }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Something went wrong asking your diary. Is the backend running?' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>💬 Ask Your Diary</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          {messages.length === 0 && (
            <div className={styles.empty}>
              Ask a question about anything you've written — "when did I last see Dr. Rahman?", "what did I do last Eid?".
              Answered by your local model, using only your own diary entries.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? styles.userMsg : styles.assistantMsg}>
              <div className={styles.msgText}>{m.text}</div>
              {m.sources?.length > 0 && (
                <div className={styles.sources}>
                  {m.sources.slice(0, 5).map(s => (
                    <span key={s.id} className={styles.sourcePill}>{s.date}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && <div className={styles.assistantMsg}><div className={styles.msgText}>Thinking…</div></div>}
          <div ref={bottomRef} />
        </div>

        <form className={styles.inputRow} onSubmit={submit}>
          <input
            className={styles.input}
            placeholder="Ask a question…"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            autoFocus
          />
          <button className={styles.sendBtn} type="submit" disabled={loading || !question.trim()}>Ask</button>
        </form>
      </div>
    </div>
  )
}
