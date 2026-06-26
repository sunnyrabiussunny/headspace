import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getEntries as getTimeEntries, getProjects as getTimeProjects, fmtHours } from '../../api_time'
import {
  getObject, updateObject, deleteObject,
  getMentions, mentionSearch, createObject, getEntryContext,
  listObjects, mergeObjects
} from '../../api'
import toast from 'react-hot-toast'
import styles from './ObjectDetailPage.module.css'

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g
const TYPE_META  = {
  PERSON:       { emoji:'👤', color:'#c97c4e', bg:'#2d1f17' },
  PLACE:        { emoji:'📍', color:'#5b8def', bg:'#172030' },
  IDEA:         { emoji:'💡', color:'#e0c040', bg:'#2a2010' },
  ORGANIZATION: { emoji:'🏢', color:'#3dbfa0', bg:'#112620' },
  MEDIA:        { emoji:'🎬', color:'#9b6fd4', bg:'#1e1228' },
  PAGE:         { emoji:'📄', color:'#60b8d4', bg:'#122028' },
}
const TYPE_EMOJI = { PERSON:'👤', PLACE:'📍', IDEA:'💡', ORGANIZATION:'🏢', MEDIA:'🎬', PAGE:'📄' }
const TYPE_NAMES = ['PERSON','PLACE','IDEA','ORGANIZATION','MEDIA','PAGE']

const OBJ_TAG_RE = /#([a-zA-Z][a-zA-Z0-9_-]{0,39})/g
function extractTagsFromText(text) {
  const tags = new Set()
  OBJ_TAG_RE.lastIndex = 0
  let m
  while ((m = OBJ_TAG_RE.exec(text)) !== null) {
    tags.add(m[1].toLowerCase())
  }
  return [...tags]
}

function parseMd(md) {
  const segs = []; let last = 0
  MENTION_RE.lastIndex = 0; let m
  while ((m = MENTION_RE.exec(md)) !== null) {
    if (m.index > last) segs.push({ type:'text', val: md.slice(last, m.index) })
    segs.push({ type:'mention', val: m[1], id: m[2] })
    last = m.index + m[0].length
  }
  if (last < md.length) segs.push({ type:'text', val: md.slice(last) })
  return segs
}
function toMd(segs) {
  return segs.map(s => s.type === 'mention' ? `@[${s.val}](${s.id})` : s.val).join('')
}
function toDisplay(segs) {
  return segs.map(s => s.type === 'mention' ? `@${s.val}` : s.val).join('')
}
function reconcile(oldSegs, newDisplay) {
  const out = []; let cursor = 0
  for (const seg of oldSegs) {
    if (seg.type !== 'mention') continue
    const token = `@${seg.val}`
    const idx = newDisplay.indexOf(token, cursor)
    if (idx === -1) continue
    if (idx > cursor) out.push({ type:'text', val: newDisplay.slice(cursor, idx) })
    out.push(seg)
    cursor = idx + token.length
  }
  if (cursor < newDisplay.length) out.push({ type:'text', val: newDisplay.slice(cursor) })
  return out.length === 0 && newDisplay.length > 0
    ? [{ type:'text', val: newDisplay }]
    : out
}
function renderRichNotes(md, navigate) {
  if (!md || !md.trim()) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Click to add notes... (type @ to link an object)</span>
  }
  const combined = /@\[([^\]]+)\]\(([^)]+)\)|https?:\/\/[^\s\)\]]+/g
  const parts = []; let last = 0, m, key = 0
  combined.lastIndex = 0
  while ((m = combined.exec(md)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{md.slice(last, m.index)}</span>)
    const full = m[0]
    if (full.startsWith('@[')) {
      const name = m[1], objId = m[2]
      parts.push(
        <span key={key++}
          style={{ color:'var(--accent-teal)', fontWeight:600, textDecoration:'underline', textUnderlineOffset:2, cursor:'pointer' }}
          onClick={e => { e.stopPropagation(); navigate(`/objects/${objId}`) }}>
          {name}
        </span>
      )
    } else {
      const display = full.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50) + (full.length > 55 ? '…' : '')
      parts.push(
        <a key={key++} href={full} target="_blank" rel="noopener noreferrer"
          style={{ color:'var(--accent-teal)', textDecoration:'underline', textUnderlineOffset:2, wordBreak:'break-all' }}
          onClick={e => e.stopPropagation()}>
          {display}
        </a>
      )
    }
    last = m.index + full.length
  }
  if (last < md.length) parts.push(<span key={key++}>{md.slice(last)}</span>)
  return parts
}

function formatDate(s) {
  if (!s || s.length < 10) return s
  try { return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }) }
  catch { return s }
}

export default function ObjectDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [obj,       setObj]       = useState(null)
  const [title,     setTitle]     = useState('')
  const [backlinks, setBacklinks]   = useState([])
  const [timeProjs, setTimeProjs]   = useState([])
  const [timeEnts,  setTimeEnts]    = useState([])
  const [showMerge, setShowMerge] = useState(false)
  const [allObjects, setAllObjects] = useState([])
  const [mergeTarget, setMergeTarget] = useState('')
  const [mergeSearch, setMergeSearch] = useState('')
  const [merging,   setMerging]   = useState(false)

  const segsRef           = useRef([])
  const taRef             = useRef(null)
  const saveTimer         = useRef(null)
  const titleTimer        = useRef(null)
  const anchorRef         = useRef(-1)
  const skipNextRef       = useRef(false)
  const lastInsertEndRef  = useRef(-1)
  const pendingDisplayRef = useRef(null)

  const [query,      setQuery]      = useState(null)
  const [saved,      setSaved]      = useState(false)
  const [results,    setResults]    = useState([])
  const [selIdx,     setSelIdx]     = useState(0)
  const [createType, setCreateType] = useState('PERSON')
  const [isEditing,  setIsEditing]  = useState(false)
  const [notesMd,    setNotesMd]    = useState('')
  const [editMeta,   setEditMeta]   = useState(false)
  const [editDesc,   setEditDesc]   = useState('')
  const [editType,   setEditType]   = useState('')

  // Load object
  useEffect(() => {
    getObject(id).then(o => {
      setObj(o)
      setTitle(o.title)
      const segs = parseMd(o.notes || '')
      segsRef.current          = segs
      anchorRef.current        = -1
      skipNextRef.current      = false
      lastInsertEndRef.current = -1
      pendingDisplayRef.current = toDisplay(segs)
      setNotesMd(o.notes || '')
    }).catch(() => navigate('/objects'))
  }, [id])

  useEffect(() => {
    if (taRef.current && pendingDisplayRef.current !== null) {
      taRef.current.value = pendingDisplayRef.current
      pendingDisplayRef.current = null
    }
  }, [obj])

  // Load time entries referencing this object
  useEffect(() => {
    Promise.all([getTimeProjects(), getTimeEntries({})]).then(([projs, ents]) => {
      setTimeProjs(projs)
      // Filter entries whose description contains this object id
      setTimeEnts(ents.filter(e => e.description && e.description.includes(id)))
    }).catch(() => {})
  }, [id])

  // Load backlinks
  useEffect(() => {
    getMentions(id).then(async mentions => {
      const enriched = await Promise.all(mentions.map(async m => {
        if (m.source_type === 'diary') {
          try {
            const ctx = await getEntryContext(m.source_id, id)
            return { id: m.id, type:'diary', sourceId: m.source_id, label: ctx.date, snippet: ctx.snippet }
          } catch {
            return { id: m.id, type:'diary', sourceId: m.source_id, label: m.created_at?.slice(0,10), snippet:'' }
          }
        } else {
          try {
            const res = await fetch(`/api/objects/${m.source_id}`)
            const src = await res.json()
            return { id: m.id, type:'object', sourceId: m.source_id, label: src.title, objectType: src.type, snippet:'' }
          } catch {
            return { id: m.id, type:'object', sourceId: m.source_id, label:'Object', snippet:'' }
          }
        }
      }))
      setBacklinks(enriched)
    }).catch(() => {})
  }, [id])

  useEffect(() => {
    if (isEditing && taRef.current) {
      const displayVal = toDisplay(segsRef.current)
      taRef.current.value = displayVal
      taRef.current.focus()
      taRef.current.setSelectionRange(displayVal.length, displayVal.length)
    }
  }, [isEditing])

  useEffect(() => {
    if (query === null) { setResults([]); setSelIdx(0); return }
    mentionSearch(query).then(r => { setResults(r); setSelIdx(0) }).catch(() => {})
  }, [query])

  const handleDone = useCallback(() => {
    clearTimeout(saveTimer.current)
    const md = toMd(segsRef.current)
    setNotesMd(md)
    const detectedTags = extractTagsFromText(toDisplay(segsRef.current))
    updateObject(id, { notes: md, tags: detectedTags })
      .then(saved => {
        setObj(saved)
        setSaved(true); setTimeout(() => setSaved(false), 1800)
      })
      .catch(() => {})
    setIsEditing(false)
    setQuery(null)
  }, [id])

  const saveNotes = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const md = toMd(segsRef.current)
      setNotesMd(md)
      const detectedTags = extractTagsFromText(toDisplay(segsRef.current))
      updateObject(id, { notes: md, tags: detectedTags })
        .then(saved => { setObj(saved); setSaved(true); setTimeout(() => setSaved(false), 1800) })
        .catch(() => {})
    }, 500)
  }, [id])

  const saveTitle = useCallback((val) => {
    clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => {
      updateObject(id, { title: val.trim() || 'Untitled' }).catch(() => {})
    }, 600)
  }, [id])

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      clearTimeout(titleTimer.current)
    }
  }, [])

  const handleNotesChange = useCallback((e) => {
    const ta     = e.target
    const newVal = ta.value
    const cursor = ta.selectionStart
    segsRef.current = reconcile(segsRef.current, newVal)
    saveNotes()

    if (skipNextRef.current) {
      skipNextRef.current = false
      setQuery(null)
      return
    }

    const before = newVal.slice(0, cursor)
    const atIdx  = before.lastIndexOf('@')
    if (atIdx >= 0) {
      const frag = before.slice(atIdx + 1)
      const alreadyUsed = lastInsertEndRef.current > 0 && atIdx < lastInsertEndRef.current
      if (!frag.includes('\n') && !alreadyUsed) {
        anchorRef.current = atIdx
        setQuery(frag)
        return
      }
    }
    setQuery(null)
  }, [saveNotes])

  const doInsert = useCallback((selObj) => {
    const ta = taRef.current
    if (!ta) return
    const anchor = anchorRef.current
    if (anchor < 0) return
    const cursor = ta.selectionStart
    const before = ta.value.slice(0, anchor)
    const after  = ta.value.slice(cursor)
    const token  = `@${selObj.title}`
    const newVal = before + token + ' ' + after

    const beforeSegs = reconcile(segsRef.current, before)
    segsRef.current = [
      ...beforeSegs,
      { type:'mention', val: selObj.title, id: selObj.id },
      { type:'text', val: ' ' + after }
    ]

    ta.value = newVal
    const newPos = anchor + token.length + 1
    ta.setSelectionRange(newPos, newPos)
    ta.focus()

    skipNextRef.current      = true
    anchorRef.current        = -1
    lastInsertEndRef.current = newPos
    setQuery(null)
    setResults([])
    saveNotes()
  }, [saveNotes])

  const doCreate = useCallback(async (name, type) => {
    if (!name.trim()) return
    try { doInsert(await createObject({ type, title: name.trim() })) } catch {}
  }, [doInsert])

  const handleKeyDown = useCallback((e) => {
    if (query !== null) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i => Math.min(i + 1, results.length)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (selIdx < results.length) doInsert(results[selIdx])
        else if (query.trim()) doCreate(query.trim(), createType)
      } else if (e.key === 'Escape') setQuery(null)
    }
  }, [query, results, selIdx, doInsert, doCreate, createType])

  const handleBacklinkClick = useCallback((item) => {
    if (item.type === 'diary' && item.label) navigate('/', { state: { targetDate: item.label } })
    else if (item.type === 'object') navigate(`/objects/${item.sourceId}`)
  }, [navigate])

  const handleDelete = async () => {
    if (!window.confirm('Delete this object?')) return
    await deleteObject(id)
    navigate('/objects')
  }

  const openEditMeta = () => {
    setEditDesc(obj.description || '')
    setEditType(obj.type)
    setEditMeta(true)
  }

  const handleSaveMeta = async () => {
    try {
      const saved = await updateObject(id, { description: editDesc, type: editType })
      setObj(saved)
      setEditMeta(false)
      toast.success('Updated')
    } catch { toast.error('Failed to save') }
  }

  const openMerge = async () => {
    try {
      const all = await listObjects()
      setAllObjects(all.filter(o => o.id !== id))
      setMergeTarget('')
      setMergeSearch('')
      setShowMerge(true)
    } catch { toast.error('Failed to load objects') }
  }

  const handleMerge = async () => {
    if (!mergeTarget) return
    const target = allObjects.find(o => o.id === mergeTarget)
    if (!target) return
    if (!window.confirm(`Merge "${obj.title}" into "${target.title}"? This object will be deleted and all its links will transfer.`)) return
    setMerging(true)
    try {
      await mergeObjects(id, mergeTarget)
      toast.success(`Merged into "${target.title}"`)
      navigate(`/objects/${mergeTarget}`)
    } catch { toast.error('Merge failed') }
    finally { setMerging(false); setShowMerge(false) }
  }

  if (!obj) return <div className={styles.loading}>Loading...</div>
  const meta = TYPE_META[obj.type] || TYPE_META.IDEA

  const filteredForMerge = allObjects.filter(o =>
    !mergeSearch || o.title.toLowerCase().includes(mergeSearch.toLowerCase())
  )

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <button className={styles.backBtn} onClick={() => { handleDone(); navigate(-1) }}><ArrowLeft /> Back</button>
        <div className={styles.toolbarRight}>
          {saved && <span className={styles.savedBadge}>Saved</span>}
          {isEditing && (
            <button className={styles.doneToolbarBtn} onClick={handleDone}>
              <CheckIcon /> Done
            </button>
          )}
          <button className={styles.mergeBtn} onClick={openMerge} title="Merge into another object">
            <MergeIcon /> Merge
          </button>
          <button className={styles.delBtn} onClick={handleDelete}>Delete</button>
        </div>
      </div>

      <div className={styles.typeRow}>
        <span className={styles.typeBadge} style={{ background: meta.bg, color: meta.color }}>
          {meta.emoji} {obj.type}
        </span>
        <button className={styles.editMetaBtn} onClick={openEditMeta} title="Edit type & description">
          <EditIcon /> Edit
        </button>
      </div>

      {editMeta && (
        <div className={styles.metaEditor}>
          <div className={styles.metaEditorRow}>
            <label className={styles.metaLabel}>Type</label>
            <div className={styles.typeChips}>
              {['PERSON','PLACE','IDEA','ORGANIZATION','MEDIA'].map(t => (
                <button key={t}
                  className={`${styles.typeChip} ${editType === t ? styles.typeChipActive : ''}`}
                  onClick={() => setEditType(t)}>
                  {TYPE_EMOJI[t]} {t.charAt(0)+t.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.metaEditorRow}>
            <label className={styles.metaLabel}>Description</label>
            <input
              className={styles.metaInput}
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="One-line description..."
              onKeyDown={e => { if (e.key === 'Enter') handleSaveMeta(); if (e.key === 'Escape') setEditMeta(false) }}
              autoFocus
            />
          </div>
          <div className={styles.metaEditorActions}>
            <button className={styles.metaSaveBtn} onClick={handleSaveMeta}>Save</button>
            <button className={styles.metaCancelBtn} onClick={() => setEditMeta(false)}>Cancel</button>
          </div>
        </div>
      )}

      <input
        className={styles.titleInput}
        value={title}
        onChange={e => { setTitle(e.target.value); saveTitle(e.target.value) }}
        onBlur={e => {
          clearTimeout(titleTimer.current)
          updateObject(id, { title: e.target.value.trim() || 'Untitled' }).catch(() => {})
        }}
        placeholder="Title"
      />

      {obj.description && !editMeta && (
        <div className={styles.descRow} onClick={openEditMeta}>{obj.description}</div>
      )}

      {obj.properties?.url && (
        <a
          href={obj.properties.url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.urlRow}
          onClick={e => e.stopPropagation()}
        >
          <LinkIcon />
          <span>{obj.properties.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}</span>
          <span className={styles.urlFull}>{obj.properties.url}</span>
        </a>
      )}

      {obj.tags?.length > 0 && (
        <div className={styles.tagsRow}>
          <TagIcon />
          <span>{obj.tags.map(t => `#${t}`).join('  ')}</span>
        </div>
      )}

      <div className={styles.divider} />

      {/* Notes */}
      <div className={styles.notesWrap}>
        {!isEditing ? (
          <div className={styles.notesReadView} onClick={() => setIsEditing(true)} title="Click to edit">
            {renderRichNotes(notesMd, navigate)}
          </div>
        ) : (
          <>
            <div className={styles.notesEditorHeader}>
              <span className={styles.notesEditingLabel}>Editing notes</span>
              <button className={styles.doneBtn} onClick={handleDone}><CheckIcon /> Done</button>
            </div>
            <textarea
              ref={taRef}
              className={styles.notesTa}
              onChange={handleNotesChange}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                clearTimeout(saveTimer.current)
                updateObject(id, { notes: toMd(segsRef.current) }).catch(() => {})
              }}
              placeholder="Notes... (type @ to link another object)"
              spellCheck={false}
              defaultValue=""
            />
          </>
        )}
        {query !== null && (
          <div className={styles.popup}>
            <div className={styles.popupHint}>↑↓ navigate · Enter select · Esc close</div>
            {results.length === 0 && query.length > 0 && (
              <div className={styles.popupEmpty}>No objects match "{query}"</div>
            )}
            {results.map((o, i) => (
              <div key={o.id}
                className={`${styles.popupRow} ${i === selIdx ? styles.active : ''}`}
                onMouseEnter={() => setSelIdx(i)}
                onMouseDown={e => { e.preventDefault(); doInsert(o) }}>
                <span className={styles.popupEmoji}>{TYPE_EMOJI[o.type] || '📄'}</span>
                <span className={styles.popupTitle}>{o.title}</span>
                <span className={styles.popupType}>{o.type}</span>
              </div>
            ))}
            {query.trim().length > 0 && (
              <div className={`${styles.createSection} ${selIdx === results.length ? styles.active : ''}`}
                onMouseEnter={() => setSelIdx(results.length)}>
                <div className={styles.createTop}>
                  <span className={styles.createPlus}>＋</span>
                  <span className={styles.createLabel}>Create "{query.trim()}" as:</span>
                </div>
                <div className={styles.typeRow2}>
                  {TYPE_NAMES.map(t => (
                    <button key={t}
                      className={`${styles.typeBtn} ${createType === t ? styles.typeBtnActive : ''}`}
                      onMouseDown={e => { e.preventDefault(); setCreateType(t) }}>
                      {TYPE_EMOJI[t]} {t.charAt(0) + t.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                <button className={styles.createConfirm}
                  onMouseDown={e => { e.preventDefault(); doCreate(query.trim(), createType) }}>
                  Create and Link
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {backlinks.length > 0 && (
        <div className={styles.backlinks}>
          <div className={styles.divider} />
          <div className={styles.blHeader}>
            <span>Backlinks</span>
            <span className={styles.blCount}>{backlinks.length}</span>
          </div>
          {backlinks.map(item => (
            <button key={item.id} className={styles.blRow} onClick={() => handleBacklinkClick(item)}>
              <span className={styles.blIcon}>{item.type === 'diary' ? <CalIcon /> : <LayersIcon />}</span>
              <div className={styles.blInfo}>
                <span className={styles.blLabel}>{item.type === 'diary' ? formatDate(item.label) : item.label}</span>
                {item.snippet && <span className={styles.blSnippet}>{item.snippet}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Time entries that reference this object */}
      {timeEnts.length > 0 && (() => {
        const projMap = Object.fromEntries(timeProjs.map(p => [p.id, p]))
        // Group by project
        const groups = {}
        timeEnts.forEach(e => {
          if (!groups[e.project_id]) groups[e.project_id] = { proj: projMap[e.project_id], total: 0, entries: [] }
          groups[e.project_id].total += (e.duration || 0)
          groups[e.project_id].entries.push(e)
        })
        return (
          <div className={styles.backlinks}>
            <div className={styles.divider} />
            <div className={styles.blHeader}>
              <span>⏱ Tracked Time</span>
              <span className={styles.blCount}>{timeEnts.length} entries</span>
            </div>
            {Object.values(groups).map(g => (
              <a key={g.proj?.id || 'unknown'} href="/time" className={styles.blRow}
                style={{ textDecoration:'none' }}>
                <span className={styles.blIcon}>
                  <span style={{ width:10, height:10, borderRadius:'50%',
                    background: g.proj?.color || '#888', display:'inline-block' }} />
                </span>
                <div className={styles.blInfo}>
                  <span className={styles.blLabel}>{g.proj?.name || 'Unknown project'}</span>
                  <span className={styles.blSnippet}>
                    {g.entries.length} session{g.entries.length !== 1 ? 's' : ''} · {fmtHours(g.total)}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )
      })()}

      {/* Merge modal */}
      {showMerge && (
        <div className={styles.modalOverlay} onClick={() => setShowMerge(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Merge "{obj.title}" into…</h2>
            <p className={styles.modalDesc}>
              All backlinks will transfer to the target object. This object will be deleted.
            </p>
            <input
              className={styles.mergeSearchInput}
              placeholder="Search objects…"
              value={mergeSearch}
              onChange={e => setMergeSearch(e.target.value)}
              autoFocus
            />
            <div className={styles.mergeList}>
              {filteredForMerge.length === 0 && (
                <div className={styles.mergeEmpty}>No objects found.</div>
              )}
              {filteredForMerge.slice(0, 20).map(o => (
                <button
                  key={o.id}
                  className={`${styles.mergeRow} ${mergeTarget === o.id ? styles.mergeRowActive : ''}`}
                  onClick={() => setMergeTarget(o.id)}
                >
                  <span>{TYPE_EMOJI[o.type] || '📄'}</span>
                  <span className={styles.mergeRowTitle}>{o.title}</span>
                  <span className={styles.mergeRowType}>{o.type}</span>
                </button>
              ))}
            </div>
            <div className={styles.modalActions}>
              <button className="btn btn-secondary" onClick={() => setShowMerge(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleMerge}
                disabled={!mergeTarget || merging}
              >
                {merging ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CheckIcon()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> }
function ArrowLeft()  { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> }
function TagIcon()    { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> }
function CalIcon()    { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> }
function LayersIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> }
function LinkIcon()   { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> }
function EditIcon()   { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function MergeIcon()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg> }
