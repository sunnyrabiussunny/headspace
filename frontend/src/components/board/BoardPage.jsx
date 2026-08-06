import React, { useEffect, useRef, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import * as api from '../../api_board'
import styles from './BoardPage.module.css'

const COLORS = ['#3dbfa0', '#4d8dff', '#a374ff', '#ff6b81', '#ffb84d', '#5ed6c4', '#ff8a5c', '#8c9eff', '#ffd166', '#6ec6ff']
const MIN_W = 200
const MIN_H = 140

export default function BoardPage() {
  const [boxes, setBoxes]     = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  const boxesRef = useRef(boxes)
  useEffect(() => { boxesRef.current = boxes }, [boxes])

  const dragRef   = useRef(null)  // { boxId, startX, startY, origX, origY }
  const resizeRef = useRef(null)  // { boxId, startX, startY, origW, origH }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await api.listBoxes()
      setBoxes(data)
    } catch { toast.error('Failed to load board') }
    setLoading(false)
  }

  function patchBoxLocal(id, patch) {
    setBoxes(bs => bs.map(b => (b.id === id ? { ...b, ...patch } : b)))
  }

  async function addBox() {
    const n = boxes.length
    try {
      const box = await api.createBox({
        title: 'New Box',
        color: COLORS[n % COLORS.length],
        x: 24 + (n % 5) * 28,
        y: 24 + (n % 5) * 28,
        w: 260, h: 220,
      })
      setBoxes(bs => [...bs, box])
    } catch { toast.error('Failed to add box') }
  }

  async function removeBox(id) {
    if (!window.confirm('Delete this box and everything in it?')) return
    setBoxes(bs => bs.filter(b => b.id !== id))
    try { await api.deleteBox(id) } catch { toast.error('Failed to delete box') }
  }

  async function bringFront(id) {
    const top = boxesRef.current.reduce((m, b) => Math.max(m, b.z_index || 1), 1)
    patchBoxLocal(id, { z_index: top + 1 })
    try { await api.bringBoxFront(id) } catch { /* non-critical */ }
  }

  async function renameBox(id, title) {
    patchBoxLocal(id, { title })
    try { await api.updateBox(id, { title }) } catch { toast.error('Failed to save title') }
  }

  async function recolorBox(id, color) {
    patchBoxLocal(id, { color })
    try { await api.updateBox(id, { color }) } catch { toast.error('Failed to save color') }
  }

  // ── Item CRUD (bubbled up so box list stays in sync) ──────────────────────
  async function addItem(boxId, text) {
    const t = text.trim()
    if (!t) return
    try {
      const item = await api.createItem(boxId, t)
      setBoxes(bs => bs.map(b => (b.id === boxId ? { ...b, items: [...b.items, item] } : b)))
    } catch { toast.error('Failed to add item') }
  }
  async function toggleItem(boxId, item) {
    setBoxes(bs => bs.map(b => (b.id === boxId
      ? { ...b, items: b.items.map(i => (i.id === item.id ? { ...i, done: !i.done } : i)) }
      : b)))
    try { await api.updateItem(item.id, { done: !item.done }) } catch { toast.error('Failed to save') }
  }
  async function removeItem(boxId, itemId) {
    setBoxes(bs => bs.map(b => (b.id === boxId ? { ...b, items: b.items.filter(i => i.id !== itemId) } : b)))
    try { await api.deleteItem(itemId) } catch { toast.error('Failed to delete item') }
  }

  // ── Drag to move ────────────────────────────────────────────────────────
  const onDragMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const nx = Math.max(0, d.origX + (clientX - d.startX))
    const ny = Math.max(0, d.origY + (clientY - d.startY))
    patchBoxLocal(d.boxId, { x: nx, y: ny })
  }, [])

  const onDragEnd = useCallback(() => {
    const d = dragRef.current
    dragRef.current = null
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragEnd)
    document.removeEventListener('touchmove', onDragMove)
    document.removeEventListener('touchend', onDragEnd)
    if (d) {
      const box = boxesRef.current.find(b => b.id === d.boxId)
      if (box) api.updateBox(d.boxId, { x: box.x, y: box.y }).catch(() => toast.error('Failed to save position'))
    }
  }, [onDragMove])

  const onHeaderPointerDown = (e, box) => {
    if (!editing) return
    if (e.target.closest('[data-no-drag]')) return
    e.preventDefault()
    bringFront(box.id)
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    dragRef.current = { boxId: box.id, startX: clientX, startY: clientY, origX: box.x, origY: box.y }
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
    document.addEventListener('touchmove', onDragMove, { passive: false })
    document.addEventListener('touchend', onDragEnd)
  }

  // ── Drag to resize ──────────────────────────────────────────────────────
  const onResizeMove = useCallback((e) => {
    const r = resizeRef.current
    if (!r) return
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const nw = Math.max(MIN_W, r.origW + (clientX - r.startX))
    const nh = Math.max(MIN_H, r.origH + (clientY - r.startY))
    patchBoxLocal(r.boxId, { w: nw, h: nh })
  }, [])

  const onResizeEnd = useCallback(() => {
    const r = resizeRef.current
    resizeRef.current = null
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
    document.removeEventListener('touchmove', onResizeMove)
    document.removeEventListener('touchend', onResizeEnd)
    if (r) {
      const box = boxesRef.current.find(b => b.id === r.boxId)
      if (box) api.updateBox(r.boxId, { w: box.w, h: box.h }).catch(() => toast.error('Failed to save size'))
    }
  }, [onResizeMove])

  const onResizePointerDown = (e, box) => {
    if (!editing) return
    e.preventDefault(); e.stopPropagation()
    bringFront(box.id)
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    resizeRef.current = { boxId: box.id, startX: clientX, startY: clientY, origW: box.w, origH: box.h }
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeEnd)
    document.addEventListener('touchmove', onResizeMove, { passive: false })
    document.addEventListener('touchend', onResizeEnd)
  }

  const canvasH = Math.max(900, ...boxes.map(b => b.y + b.h + 80), 900)

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>Board</h1>
        <div className={styles.toolbarRight}>
          {editing && (
            <button className={styles.addBoxBtn} onClick={addBox}>+ Add Box</button>
          )}
          <button
            className={`${styles.editBtn} ${editing ? styles.editBtnActive : ''}`}
            onClick={() => setEditing(e => !e)}
          >
            {editing ? '✓ Done' : '✎ Edit Layout'}
          </button>
        </div>
      </div>

      <div className={styles.canvasWrap}>
        <div className={styles.canvas} style={{ height: canvasH }}>
          {loading && <div className={styles.empty}>Loading…</div>}
          {!loading && boxes.length === 0 && (
            <div className={styles.empty}>
              Blank slate. Click <strong>Edit Layout</strong>, then <strong>+ Add Box</strong> to start.
            </div>
          )}
          {boxes.map(box => (
            <BoardBoxCard
              key={box.id}
              box={box}
              editing={editing}
              onHeaderPointerDown={onHeaderPointerDown}
              onResizePointerDown={onResizePointerDown}
              onRename={renameBox}
              onRecolor={recolorBox}
              onRemove={removeBox}
              onAddItem={addItem}
              onToggleItem={toggleItem}
              onRemoveItem={removeItem}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function BoardBoxCard({
  box, editing, onHeaderPointerDown, onResizePointerDown,
  onRename, onRecolor, onRemove, onAddItem, onToggleItem, onRemoveItem,
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(box.title)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newText, setNewText] = useState('')

  useEffect(() => { setTitleDraft(box.title) }, [box.title])

  const doneCount = box.items.filter(i => i.done).length

  const commitTitle = () => {
    setEditingTitle(false)
    const t = titleDraft.trim() || 'Untitled'
    if (t !== box.title) onRename(box.id, t)
    else setTitleDraft(box.title)
  }

  const submitNewItem = () => {
    const t = newText.trim()
    if (!t) return
    onAddItem(box.id, t)
    setNewText('')
  }

  return (
    <div
      className={styles.box}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: box.z_index || 1 }}
    >
      <div
        className={`${styles.boxHeader} ${editing ? styles.boxHeaderEditable : ''}`}
        style={{ background: box.color }}
        onMouseDown={(e) => onHeaderPointerDown(e, box)}
        onTouchStart={(e) => onHeaderPointerDown(e, box)}
      >
        {editingTitle ? (
          <input
            data-no-drag
            autoFocus
            className={styles.titleInput}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitleDraft(box.title); setEditingTitle(false) } }}
          />
        ) : (
          <span
            className={styles.boxTitle}
            onClick={() => editing && setEditingTitle(true)}
            title={editing ? 'Click to rename' : ''}
          >
            {box.title}
          </span>
        )}

        <div className={styles.headerRight} data-no-drag>
          {box.items.length > 0 && (
            <span className={styles.countBadge}>{doneCount}/{box.items.length}</span>
          )}
          {editing && (
            <>
              <button className={styles.colorDot} style={{ background: box.color }}
                onClick={() => setPickerOpen(p => !p)} title="Change color" />
              <button className={styles.deleteBoxBtn} onClick={() => onRemove(box.id)} title="Delete box">×</button>
            </>
          )}
        </div>

        {pickerOpen && (
          <div className={styles.colorPicker} data-no-drag>
            {COLORS.map(c => (
              <button
                key={c}
                className={styles.colorSwatch}
                style={{ background: c }}
                onClick={() => { onRecolor(box.id, c); setPickerOpen(false) }}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.boxBody}>
        <div className={styles.addRow}>
          <input
            className={styles.addInput}
            placeholder="Add a note…"
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitNewItem() }}
          />
          <button className={styles.addBtn} onClick={submitNewItem}>Add</button>
        </div>

        <div className={styles.items}>
          {box.items.map(item => (
            <div key={item.id} className={styles.item}>
              <button
                className={`${styles.checkbox} ${item.done ? styles.checkboxDone : ''}`}
                onClick={() => onToggleItem(box.id, item)}
              />
              <span className={`${styles.itemText} ${item.done ? styles.itemTextDone : ''}`}>{item.text}</span>
              <button className={styles.itemDelete} onClick={() => onRemoveItem(box.id, item.id)}>×</button>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <div
          className={styles.resizeHandle}
          onMouseDown={(e) => onResizePointerDown(e, box)}
          onTouchStart={(e) => onResizePointerDown(e, box)}
        />
      )}
    </div>
  )
}
