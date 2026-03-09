import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { useEffect, useState } from 'react'

import type { ScoreAttrs } from './scoreUtils'
import { resolveScoreExtraFeatures } from './scoreFeatureFlags'
import type { ScoreExtensionOptions } from './ScoreExtension'

declare global {
  interface Window {
    __scoreDndSuppress?: boolean
    __scoreDndSuppressUntil?: number
    __scoreRequireClickAfterDnd?: boolean
  }
}

const isNodeSelectionLike = (selection: unknown) => {
  if (!selection || typeof selection !== 'object') return false
  const candidate = selection as { constructor?: { name?: unknown } }
  return candidate.constructor?.name === 'NodeSelection'
}

const isScoreSelection = (editor: Editor) => {
  const { selection } = editor.state
  if (!isNodeSelectionLike(selection)) return false
  const candidate = selection as NodeSelection
  return candidate.node.type.name === 'score'
}

const getScoreAttrs = (editor: Editor): ScoreAttrs | null => {
  const { selection } = editor.state
  if (!isNodeSelectionLike(selection)) return null
  const candidate = selection as NodeSelection
  if (candidate.node.type.name !== 'score') return null
  return candidate.node.attrs as ScoreAttrs
}

const stripTupletFromToken = (token: string) => {
  const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
  if (note) return `${note[1].toLowerCase()}${note[2]}${note[3]}/${note[4]}${note[6] || ''}${note[7] || ''}`
  const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
  if (rest) return `r/${rest[1]}${rest[3] || ''}${rest[4] || ''}`
  return token
}

const getTupletMeta = (token: string) => {
  const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
  if (note) {
    return { duration: note[4], hasTuplet: note[5] === 't' }
  }
  const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
  if (rest) {
    return { duration: rest[1], hasTuplet: rest[2] === 't' }
  }
  return null
}

const normalizeTupletFlags = (tokens: string[]) => {
  const next = [...tokens]
  let i = 0
  while (i < next.length) {
    const meta = getTupletMeta(next[i])
    if (!meta?.hasTuplet) {
      i += 1
      continue
    }
    const start = i
    const duration = meta.duration
    while (i < next.length) {
      const m = getTupletMeta(next[i])
      if (!m?.hasTuplet || m.duration !== duration) break
      i += 1
    }
    const runLength = i - start
    const complete = Math.floor(runLength / 3) * 3
    for (let idx = start + complete; idx < start + runLength; idx += 1) {
      next[idx] = stripTupletFromToken(next[idx])
    }
  }
  return next
}

const ScoreBubbleMenu = ({ editor }: { editor: Editor | null }) => {
  const [attrs, setAttrs] = useState<ScoreAttrs | null>(null)
  const [, setSuppressByDnd] = useState(
    typeof window !== 'undefined' && window.__scoreDndSuppress === true,
  )

  useEffect(() => {
    if (!editor) return undefined

    const update = () => {
      setAttrs(getScoreAttrs(editor))
    }

    update()
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)

    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    let clearTimer: number | null = null

    const clearSuppression = () => {
      window.__scoreDndSuppress = false
      window.__scoreDndSuppressUntil = 0
      setSuppressByDnd(false)
    }

    const scheduleClear = (delayMs: number) => {
      if (clearTimer !== null) {
        window.clearTimeout(clearTimer)
      }
      clearTimer = window.setTimeout(() => {
        clearSuppression()
        clearTimer = null
      }, Math.max(0, delayMs))
    }

    const onDnd = (event: Event) => {
      const custom = event as CustomEvent<{ phase?: string }>
      if (custom.detail?.phase === 'start' || custom.detail?.phase === 'end') {
        window.__scoreDndSuppress = true
        window.__scoreDndSuppressUntil = Date.now() + 700
        setSuppressByDnd(true)
        scheduleClear(720)
      }
    }
    const onMouseDown = () => {
      clearSuppression()
    }
    const onNativeDragLike = () => {
      window.__scoreDndSuppress = true
      window.__scoreDndSuppressUntil = Date.now() + 700
      setSuppressByDnd(true)
      scheduleClear(720)
    }
    const onClear = () => {
      clearSuppression()
    }

    window.addEventListener('score-node-dnd', onDnd as EventListener)
    window.addEventListener('score-node-dnd-clear', onClear as EventListener)
    window.addEventListener('dragstart', onNativeDragLike, true)
    window.addEventListener('drop', onNativeDragLike, true)
    window.addEventListener('dragend', onNativeDragLike, true)
    window.addEventListener('mousedown', onMouseDown, true)
    return () => {
      window.removeEventListener('score-node-dnd', onDnd as EventListener)
      window.removeEventListener('score-node-dnd-clear', onClear as EventListener)
      window.removeEventListener('dragstart', onNativeDragLike, true)
      window.removeEventListener('drop', onNativeDragLike, true)
      window.removeEventListener('dragend', onNativeDragLike, true)
      window.removeEventListener('mousedown', onMouseDown, true)
      if (clearTimer !== null) {
        window.clearTimeout(clearTimer)
      }
    }
  }, [])


  if (!editor) return null
  const scoreExtension = editor.extensionManager.extensions.find((ext) => ext.name === 'score')
  const extraFeatures = resolveScoreExtraFeatures((scoreExtension?.options as ScoreExtensionOptions | undefined)?.extraFeatures)
  const allowDoubleDotted = extraFeatures.doubleDotted

  const updateAttrs = (next: Partial<ScoreAttrs>) => {
    editor.commands.updateAttributes('score', next)
  }

  useEffect(() => {
    if (!attrs) return
    if (allowDoubleDotted) return
    if (Number(attrs.inputDots ?? 0) <= 1) return
    updateAttrs({ inputDots: 1 })
  }, [allowDoubleDotted, attrs?.inputDots])

  const getSelectedTokens = (currentAttrs: ScoreAttrs) => {
    if (!currentAttrs.selectedTarget) return null
    const source = currentAttrs.selectedTarget === 'lower'
      ? currentAttrs.lowerNotes
      : currentAttrs.selectedTarget === 'upper'
        ? currentAttrs.upperNotes
        : currentAttrs.selectedTarget === 'single2'
          ? currentAttrs.singleNotes2
          : currentAttrs.selectedTarget === 'single3'
            ? currentAttrs.singleNotes3
            : currentAttrs.selectedTarget === 'single4'
              ? currentAttrs.singleNotes4
              : currentAttrs.notes
    const tokens = source?.trim() ? source.trim().split(/\s+/) : []
    const indices = Array.from(new Set(
      (currentAttrs.selectedIndices?.length
        ? currentAttrs.selectedIndices
        : (currentAttrs.selectedIndex >= 0 ? [currentAttrs.selectedIndex] : []))
        .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < tokens.length),
    )).sort((a, b) => a - b)
    if (indices.length === 0) return null
    return {
      tokens,
      token: tokens[indices[0]],
      target: currentAttrs.selectedTarget,
      indices,
    }
  }

  const updateSelectedToken = (
    currentAttrs: ScoreAttrs,
    updater: (token: string, target: ScoreAttrs['selectedTarget']) => string,
  ) => {
    const selected = getSelectedTokens(currentAttrs)
    if (!selected) return
    let changed = false
    selected.indices.forEach((idx) => {
      const currentToken = selected.tokens[idx]
      const nextToken = updater(currentToken, selected.target)
      if (!nextToken || nextToken === currentToken) return
      selected.tokens[idx] = nextToken
      changed = true
    })
    if (!changed) return
    const normalized = normalizeTupletFlags(selected.tokens)
    const joined = normalized.join(' ')
    updateAttrs(selected.target === 'lower'
      ? { lowerNotes: joined }
      : selected.target === 'upper'
        ? { upperNotes: joined }
        : selected.target === 'single2'
          ? { singleNotes2: joined }
          : selected.target === 'single3'
            ? { singleNotes3: joined }
            : selected.target === 'single4'
              ? { singleNotes4: joined }
              : { notes: joined })
  }

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={() => {
        const scoreSelected = isScoreSelection(editor)
        const requireClick = typeof window !== 'undefined' && window.__scoreRequireClickAfterDnd === true
        return scoreSelected && !requireClick
      }}
      options={{ placement: 'top-start' }}
      className="score-bubble"
    >
      {attrs && (
        <>
          {(() => {
            const selected = getSelectedTokens(attrs)
            if (selected) return null
            return (
              <div className="score-bubble__stack">
                <div className="score-bubble__row score-bubble__row--selected-primary">
                  <label>
                    <span>種類</span>
                    <select
                      value={attrs.inputMode}
                      onChange={(event) => {
                        const mode = event.target.value as ScoreAttrs['inputMode']
                        updateAttrs({
                          inputMode: mode,
                          inputAccidental: mode === 'rest' ? '' : attrs.inputAccidental,
                        })
                      }}
                    >
                      <option value="note">音符</option>
                      <option value="rest">休符</option>
                    </select>
                  </label>
                  <label>
                    <span>音価</span>
                    <select
                      value={attrs.inputDuration}
                      onChange={(event) => updateAttrs({ inputDuration: event.target.value })}
                    >
                      <option value="w">全音符</option>
                      <option value="h">2分音符</option>
                      <option value="q">4分音符</option>
                      <option value="8">8分音符</option>
                      <option value="16">16分音符</option>
                    </select>
                  </label>
                <label>
                  <span>付点</span>
                  <select
                    value={String(allowDoubleDotted ? attrs.inputDots : Math.min(1, Number(attrs.inputDots ?? 0)))}
                    onChange={(event) => updateAttrs({
                      inputDots: Math.min(
                        allowDoubleDotted ? 2 : 1,
                        Number(event.target.value),
                      ) as ScoreAttrs['inputDots'],
                    })}
                  >
                    <option value="0">なし</option>
                    <option value="1">付点</option>
                    {allowDoubleDotted && <option value="2">複付点</option>}
                  </select>
                </label>
                </div>
                <div className="score-bubble__row score-bubble__row--selected-secondary">
                  <label>
                    <span>連符</span>
                    <select
                      value={attrs.inputTuplet ? 'triplet' : 'none'}
                      onChange={(event) => updateAttrs({ inputTuplet: event.target.value === 'triplet' })}
                    >
                      <option value="none">なし</option>
                      <option value="triplet">3連符</option>
                    </select>
                  </label>
                  <label>
                    <span>臨時記号</span>
                    <select
                      value={attrs.inputAccidental}
                      disabled={attrs.inputMode === 'rest'}
                      onChange={(event) => updateAttrs({ inputAccidental: event.target.value as ScoreAttrs['inputAccidental'] })}
                    >
                      <option value="">なし</option>
                      <option value="#">シャープ</option>
                      <option value="b">フラット</option>
                    </select>
                  </label>
                </div>
              </div>
            )
          })()}
          {(() => {
            const selected = getSelectedTokens(attrs)
            if (!selected) return null
            const noteMatch = selected.token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
            const restMatch = selected.token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
            const mode: ScoreAttrs['inputMode'] = restMatch ? 'rest' : 'note'
            const duration = restMatch?.[1] ?? noteMatch?.[4] ?? attrs.inputDuration
            const isTuplet = (restMatch?.[2] ?? noteMatch?.[5] ?? '') === 't'
            const dots = Math.min(allowDoubleDotted ? 2 : 1, (restMatch?.[3] ?? noteMatch?.[6] ?? '').length)
            const accidental = noteMatch?.[2] ?? ''
            return (
              <div className="score-bubble__stack">
                <div className="score-bubble__row score-bubble__row--selected-primary">
                <label>
                  <span>種類</span>
                  <select
                    value={mode}
                    onChange={(event) => {
                      const nextMode = event.target.value as ScoreAttrs['inputMode']
                      updateSelectedToken(attrs, (token, target) => {
                        const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
                        const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
                        const tokenDuration = rest?.[1] ?? note?.[4] ?? 'q'
                        const tokenTuplet = rest?.[2] ?? note?.[5] ?? ''
                        const tokenDots = rest?.[3] ?? note?.[6] ?? ''
                        const tokenTie = rest?.[4] ?? note?.[7] ?? ''
                        if (nextMode === 'rest') return `r/${tokenDuration}${tokenTuplet}${tokenDots}${tokenTie}`
                        if (note) return token
                        const fallbackPitch = target === 'lower' ? 'c3' : 'c4'
                        return `${fallbackPitch}/${tokenDuration}${tokenTuplet}${tokenDots}${tokenTie}`
                      })
                    }}
                  >
                    <option value="note">音符</option>
                    <option value="rest">休符</option>
                  </select>
                </label>
                <label>
                  <span>音価</span>
                  <select
                    value={duration}
                    onChange={(event) => {
                      const nextDuration = event.target.value
                      updateSelectedToken(attrs, (token) => {
                        const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
                        if (note) return `${note[1].toLowerCase()}${note[2]}${note[3]}/${nextDuration}${note[5] || ''}${note[6] || ''}${note[7] || ''}`
                        const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
                        return `r/${nextDuration}${rest?.[2] || ''}${rest?.[3] || ''}${rest?.[4] || ''}`
                      })
                    }}
                  >
                    <option value="w">全音符</option>
                    <option value="h">2分音符</option>
                    <option value="q">4分音符</option>
                    <option value="8">8分音符</option>
                    <option value="16">16分音符</option>
                  </select>
                </label>
                <label>
                  <span>付点</span>
                  <select
                    value={String(dots)}
                    onChange={(event) => {
                      const nextDots = Math.min(allowDoubleDotted ? 2 : 1, Number(event.target.value))
                      const dotSuffix = '.'.repeat(nextDots)
                      updateSelectedToken(attrs, (token) => {
                        const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
                        if (note) return `${note[1].toLowerCase()}${note[2]}${note[3]}/${note[4]}${note[5] || ''}${dotSuffix}${note[7] || ''}`
                        const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
                        if (rest) return `r/${rest[1]}${rest[2] || ''}${dotSuffix}${rest[4] || ''}`
                        return token
                      })
                    }}
                  >
                    <option value="0">なし</option>
                    <option value="1">付点</option>
                    {allowDoubleDotted && <option value="2">複付点</option>}
                  </select>
                </label>
                </div>
                <div className="score-bubble__row score-bubble__row--selected-secondary">
                  <label>
                  <span>連符</span>
                  <select
                    value={isTuplet ? 'triplet' : 'none'}
                    onChange={(event) => {
                      const triplet = event.target.value === 'triplet'
                      if (triplet && selected.indices.length % 3 !== 0) return
                      updateSelectedToken(attrs, (token) => {
                        const tupletMark = triplet ? 't' : ''
                        const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
                        if (note) return `${note[1].toLowerCase()}${note[2]}${note[3]}/${note[4]}${tupletMark}${note[6] || ''}${note[7] || ''}`
                        const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
                        if (rest) return `r/${rest[1]}${tupletMark}${rest[3] || ''}${rest[4] || ''}`
                        return token
                      })
                    }}
                  >
                    <option value="none">なし</option>
                    <option value="triplet">3連符</option>
                  </select>
                  </label>
                  <label>
                  <span>臨時記号</span>
                  <select
                    value={accidental}
                    disabled={mode === 'rest'}
                    onChange={(event) => {
                      const nextAccidental = event.target.value as ScoreAttrs['inputAccidental']
                      updateSelectedToken(attrs, (token) => {
                        const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
                        if (!note) return token
                        return `${note[1].toLowerCase()}${nextAccidental}${note[3]}/${note[4]}${note[5] || ''}${note[6] || ''}${note[7] || ''}`
                      })
                    }}
                  >
                    <option value="">なし</option>
                    <option value="#">シャープ</option>
                    <option value="b">フラット</option>
                  </select>
                  </label>
                </div>
                {selected.indices.length > 1 && selected.indices.length % 3 !== 0 && (
                  <label>
                    <span>連符注意</span>
                    <input value="複数選択で3連符化する場合は3の倍数を選択" readOnly />
                  </label>
                )}
                <div className="score-bubble__hint">
                  選択中: {selected.target === 'upper'
                    ? '上段'
                    : selected.target === 'lower'
                      ? '下段'
                      : selected.target === 'single'
                        ? '1段目'
                        : selected.target === 'single2'
                          ? '2段目'
                          : selected.target === 'single3'
                            ? '3段目'
                            : '4段目'} {selected.indices.length === 1 ? `#${selected.indices[0] + 1}` : `${selected.indices.length}件`}
                  {selected.indices.length === 1 ? '（Shift+↑/↓で移動）' : '（範囲選択）'}
                </div>
              </div>
            )
          })()}
          {!getSelectedTokens(attrs) && (
            <div className="score-bubble__hint">
              譜面をクリックして音符を追加
            </div>
          )}
        </>
      )}
    </BubbleMenu>
  )
}

export default ScoreBubbleMenu
