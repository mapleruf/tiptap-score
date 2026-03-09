import { NodeViewWrapper } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'

import {
  renderScoreSvg,
  type NoteClef,
  type ScoreAttrs,
  type SelectedScoreNotes,
  pitchFromY,
  transposeTokenByStep,
  isYWithinStaff,
  parseTimeSig,
  durationTokenToBeatsWithTuplet,
  MAX_AUTO_MEASURES,
} from './scoreUtils'
import { resolveScoreExtraFeatures } from './scoreFeatureFlags'
import type { ScoreExtensionOptions } from './ScoreExtension'

declare global {
  interface Window {
    __scoreDndSuppress?: boolean
    __scoreDndSuppressUntil?: number
    __scoreDndBlockDragHandleUntil?: number
    __scoreRequireClickAfterDnd?: boolean
  }
}

type ScoreTarget = 'single' | 'single2' | 'single3' | 'single4' | 'upper' | 'lower'

const SINGLE_TARGETS: ScoreTarget[] = ['single', 'single2', 'single3', 'single4']
const DND_BLOCK_DRAG_HANDLE_MS = 900

const clearDndSuppress = () => {
  if (typeof window === 'undefined') return
  window.__scoreDndSuppress = false
  window.__scoreDndSuppressUntil = 0
  window.__scoreDndBlockDragHandleUntil = 0
  window.__scoreRequireClickAfterDnd = false
  window.dispatchEvent(new CustomEvent('score-node-dnd-clear'))
}
const KEY_SIG_OPTIONS = [
  { value: 'C', label: 'C（ハ長調 / イ短調）' },
  { value: 'G', label: 'G（ト長調 / ホ短調）' },
  { value: 'D', label: 'D（ニ長調 / ロ短調）' },
  { value: 'A', label: 'A（イ長調 / 嬰ヘ短調）' },
  { value: 'E', label: 'E（ホ長調 / 嬰ハ短調）' },
  { value: 'B', label: 'B（ロ長調 / 嬰ト短調）' },
  { value: 'F#', label: 'F#（嬰ヘ長調 / 嬰ニ短調）' },
  { value: 'C#', label: 'C#（嬰ハ長調 / 嬰イ短調）' },
  { value: 'F', label: 'F（ヘ長調 / ニ短調）' },
  { value: 'Bb', label: 'Bb（変ロ長調 / ト短調）' },
  { value: 'Eb', label: 'Eb（変ホ長調 / ハ短調）' },
  { value: 'Ab', label: 'Ab（変イ長調 / ヘ短調）' },
  { value: 'Db', label: 'Db（変ニ長調 / 変ロ短調）' },
  { value: 'Gb', label: 'Gb（変ト長調 / 変ホ短調）' },
  { value: 'Cb', label: 'Cb（変ハ長調 / 変イ短調）' },
] as const

type HitBox = {
  x1: number
  x2: number
  y1: number
  y2: number
}

const parseHitBox = (value: string | undefined): HitBox | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<HitBox>
    if (
      !Number.isFinite(parsed.x1)
      || !Number.isFinite(parsed.x2)
      || !Number.isFinite(parsed.y1)
      || !Number.isFinite(parsed.y2)
    ) {
      return null
    }
    return {
      x1: Number(parsed.x1),
      x2: Number(parsed.x2),
      y1: Number(parsed.y1),
      y2: Number(parsed.y2),
    }
  } catch {
    return null
  }
}

const isInHitBox = (x: number, y: number, box: HitBox | null) => {
  if (!box) return false
  return x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2
}

const isNodeSelectionAt = (selection: unknown, pos: number) => {
  if (!selection || typeof selection !== 'object') return false
  const candidate = selection as { from?: unknown; constructor?: { name?: unknown } }
  if (candidate.constructor?.name !== 'NodeSelection') return false
  return typeof candidate.from === 'number' && candidate.from === pos
}

const getClefByTarget = (attrs: ScoreAttrs, target: ScoreTarget): NoteClef => {
  if (target === 'single') return attrs.singleClef
  if (target === 'single2') return attrs.singleClef2
  if (target === 'single3') return attrs.singleClef3
  if (target === 'single4') return attrs.singleClef4
  if (target === 'upper') return attrs.upperClef
  return attrs.lowerClef
}

const getClefPatchByTarget = (target: ScoreTarget, value: NoteClef): Partial<ScoreAttrs> => {
  if (target === 'single') return { singleClef: value }
  if (target === 'single2') return { singleClef2: value }
  if (target === 'single3') return { singleClef3: value }
  if (target === 'single4') return { singleClef4: value }
  if (target === 'upper') return { upperClef: value }
  return { lowerClef: value }
}

const getNotesByTarget = (attrs: ScoreAttrs, target: ScoreTarget) => {
  switch (target) {
    case 'single':
      return attrs.notes
    case 'single2':
      return attrs.singleNotes2
    case 'single3':
      return attrs.singleNotes3
    case 'single4':
      return attrs.singleNotes4
    case 'upper':
      return attrs.upperNotes
    case 'lower':
      return attrs.lowerNotes
    default:
      return ''
  }
}

const getNotesPatchByTarget = (target: ScoreTarget, value: string): Partial<ScoreAttrs> => {
  switch (target) {
    case 'single':
      return { notes: value }
    case 'single2':
      return { singleNotes2: value }
    case 'single3':
      return { singleNotes3: value }
    case 'single4':
      return { singleNotes4: value }
    case 'upper':
      return { upperNotes: value }
    case 'lower':
      return { lowerNotes: value }
    default:
      return {}
  }
}

const getDataPrefixByTarget = (target: ScoreTarget) => target

const getClefTargetFromPoint = (
  container: HTMLElement,
  staffType: ScoreAttrs['staff'],
  x: number,
  y: number,
): ScoreTarget | null => {
  if (staffType === 'grand') {
    const upperClefHit = parseHitBox(container.dataset.upperClefHit)
    const lowerClefHit = parseHitBox(container.dataset.lowerClefHit)
    if (isInHitBox(x, y, upperClefHit)) return 'upper'
    if (isInHitBox(x, y, lowerClefHit)) return 'lower'
    return null
  }
  for (const target of SINGLE_TARGETS) {
    const hit = parseHitBox(container.dataset[`${target}ClefHit`])
    if (isInHitBox(x, y, hit)) return target
  }
  return null
}

const parseNumberList = (value: string | undefined) => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
  } catch {
    return []
  }
}

const parseStringList = (value: string | undefined) => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => (item == null ? '' : String(item)))
  } catch {
    return []
  }
}

const getTokenBeatStarts = (tokens: string[], beatValue: number) => {
  const starts: number[] = []
  let totalBeats = 0
  for (const token of tokens) {
    starts.push(totalBeats)
    const match = token.match(/^([a-gA-G]|r)([#b]?)(\d)?\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
    if (!match) continue
    const duration = match[4]
    const tuplet = match[5] === 't'
    const dots = match[6]?.length ?? 0
    totalBeats += durationTokenToBeatsWithTuplet(duration, beatValue, dots, tuplet)
  }
  return { starts, totalBeats }
}

const getInsertIndexByBeat = (beatStarts: number[], clickBeat: number) => {
  for (let i = 0; i < beatStarts.length; i += 1) {
    if (clickBeat < beatStarts[i]) return i
  }
  return beatStarts.length
}

const getInsertIndexByX = (noteXs: number[], clickX: number) => {
  if (noteXs.length === 0) return 0
  let lastLeftIndex = -1
  noteXs.forEach((x, idx) => {
    if (x <= clickX && idx > lastLeftIndex) {
      lastLeftIndex = idx
    }
  })
  return lastLeftIndex + 1
}

const durationDefs = [
  { token: 'w', quarterBeats: 4 },
  { token: 'h', quarterBeats: 2 },
  { token: 'q', quarterBeats: 1 },
  { token: '8', quarterBeats: 0.5 },
  { token: '16', quarterBeats: 0.25 },
  { token: '32', quarterBeats: 0.125 },
] as const

const splitBeatsIntoDurations = (beats: number, beatValue: number) => {
  const parts: Array<{ token: string, dots: 0 | 1 | 2 }> = []
  let remaining = beats
  const defs = durationDefs.flatMap((def) => ([0, 1, 2] as const).map((dots) => {
    const dotMultiplier = dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1
    return {
      token: def.token,
      dots,
      beats: def.quarterBeats * (beatValue / 4) * dotMultiplier,
    }
  })).sort((a, b) => b.beats - a.beats)
  while (remaining > 0.0001) {
    const picked = defs.find((def) => def.beats <= remaining + 0.0001)
    if (!picked) break
    parts.push({ token: picked.token, dots: picked.dots })
    remaining -= picked.beats
  }
  return parts
}

const isScoreBubbleVisible = () => {
  const bubble = document.querySelector('.score-bubble') as HTMLElement | null
  if (!bubble) return false
  const style = window.getComputedStyle(bubble)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false
  }
  const rect = bubble.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

const getScoreTargetFromY = (
  container: HTMLElement,
  staffType: ScoreAttrs['staff'],
  y: number,
  staffTopY: number,
  staffLineSpacing: number,
  lowerStaffTopY: number,
  lowerStaffLineSpacing: number,
) => {
  let target: ScoreTarget | null = null
  if (staffType === 'grand') {
    const inUpper = isYWithinStaff(y, staffTopY, staffLineSpacing, 10)
    const inLower = isYWithinStaff(y, lowerStaffTopY, lowerStaffLineSpacing, 10)

    if (inUpper && inLower) {
      const upperCenterY = staffTopY + staffLineSpacing * 2
      const lowerCenterY = lowerStaffTopY + lowerStaffLineSpacing * 2
      const distToUpper = Math.abs(y - upperCenterY)
      const distToLower = Math.abs(y - lowerCenterY)
      target = distToLower < distToUpper ? 'lower' : 'upper'
    } else if (inUpper) {
      target = 'upper'
    } else if (inLower) {
      target = 'lower'
    }
  } else {
    const tops = parseNumberList(container.dataset.singleStaffTopYs)
    const count = Math.max(1, Math.min(4, Number(container.dataset.singleStaffCount || 1)))
    if (tops.length > 0) {
      let nearestIndex = 0
      let nearestDistance = Number.POSITIVE_INFINITY
      let found = false
      for (let i = 0; i < Math.min(count, tops.length); i += 1) {
        const top = tops[i]
        if (!isYWithinStaff(y, top, staffLineSpacing, 10)) continue
        const centerY = top + staffLineSpacing * 2
        const dist = Math.abs(y - centerY)
        if (dist < nearestDistance) {
          nearestDistance = dist
          nearestIndex = i
          found = true
        }
      }
      if (found) {
        target = SINGLE_TARGETS[nearestIndex] ?? 'single'
      }
    } else {
      if (isYWithinStaff(y, staffTopY, staffLineSpacing, 10)) {
        target = 'single'
      }
    }
  }
  return target
}

const getLocalPointFromClient = (svg: SVGSVGElement, clientX: number, clientY: number) => {
  const rect = svg.getBoundingClientRect()
  const ctm = svg.getScreenCTM()
  if (ctm) {
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const local = point.matrixTransform(ctm.inverse())
    const svgWidth = Number(svg.getAttribute('width')) || svg.viewBox.baseVal.width || rect.width
    return { x: local.x, y: local.y, svgWidth }
  }
  const svgWidth = Number(svg.getAttribute('width')) || svg.viewBox.baseVal.width || rect.width
  const svgHeight = Number(svg.getAttribute('height')) || svg.viewBox.baseVal.height || rect.height
  if (rect.width <= 0 || rect.height <= 0) return null
  const x = ((clientX - rect.left) / rect.width) * svgWidth
  const y = ((clientY - rect.top) / rect.height) * svgHeight
  return { x, y, svgWidth }
}

const getLocalPointFromMouse = (svg: SVGSVGElement, event: React.MouseEvent<HTMLDivElement>) => (
  getLocalPointFromClient(svg, event.clientX, event.clientY)
)

const findNearestTokenIndexFromRendered = ({
  tokens,
  noteXs,
  noteYs,
  tokenMap,
  renderedPitches,
  x,
  y,
  staffTopY,
  staffLineSpacing,
  maxDx,
  maxDy,
}: {
  tokens: string[]
  noteXs: number[]
  noteYs: number[]
  tokenMap: number[]
  renderedPitches: string[]
  x: number
  y: number
  staffTopY: number
  staffLineSpacing: number
  maxDx: number
  maxDy: number
}) => {
  let nearestTokenIdx = -1
  let nearestScore = Number.POSITIVE_INFINITY
  for (let i = 0; i < noteXs.length; i += 1) {
    const tokenIdx = tokenMap[i] ?? i
    if (tokenIdx < 0 || tokenIdx >= tokens.length) continue
    const dx = Math.abs(x - noteXs[i])
    if (dx > maxDx) continue

    let dy = 0
    const noteY = noteYs[i]
    if (Number.isFinite(noteY)) {
      dy = Math.abs(y - noteY)
      if (dy > maxDy) continue
    } else {
      const renderedPitch = renderedPitches[i]
      if (renderedPitch) {
        // Fallback: keep pitch-aware filter if note Y cannot be read.
        dy = Math.abs(y - (staffTopY + staffLineSpacing * 2))
        if (dy > maxDy) continue
      }
    }

    const score = dx * dx + dy * dy
    if (score < nearestScore) {
      nearestScore = score
      nearestTokenIdx = tokenIdx
    }
  }
  return nearestTokenIdx
}

const ScoreNodeView = ({ node, editor, getPos, extension }: NodeViewProps) => {
  const extraFeatures = resolveScoreExtraFeatures((extension.options as ScoreExtensionOptions | undefined)?.extraFeatures)
  const allowMultiSingleStaff = extraFeatures.multiSingleStaff
  const allowDoubleDotted = extraFeatures.doubleDotted
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    target: ScoreTarget
    startX: number
    startY: number
    startClientX: number
    startClientY: number
    moved: boolean
  } | null>(null)
  const finalizeDragSelectionRef = useRef<(clientX: number, clientY: number) => void>(() => {})
  const suppressClickRef = useRef(false)
  const [errors, setErrors] = useState<string[]>([])
  const [layoutTick, setLayoutTick] = useState(0)
  const [cursorMode, setCursorMode] = useState<'default' | 'select' | 'insert'>('default')
  const [dragBox, setDragBox] = useState<{ left: number, top: number, width: number, height: number } | null>(null)
  const [dragHandleDisabledAfterDrop, setDragHandleDisabledAfterDrop] = useState(
    typeof window !== 'undefined' && Boolean(window.__scoreDndBlockDragHandleUntil),
  )
  const [clefMenu, setClefMenu] = useState<{
    target: ScoreTarget
    left: number
    top: number
  } | null>(null)
  const [settingsMenu, setSettingsMenu] = useState<{ left: number, top: number } | null>(null)
  const attrs = node.attrs as ScoreAttrs
  const normalizedSingleStaffCount = allowMultiSingleStaff
    ? Math.max(1, Math.min(4, Number(attrs.singleStaffCount || 1)))
    : 1
  const normalizedInputDots = allowDoubleDotted
    ? Math.max(0, Math.min(2, Number(attrs.inputDots ?? 0)))
    : Math.max(0, Math.min(1, Number(attrs.inputDots ?? 0)))
  const canDragNode = !clefMenu
    && !settingsMenu
    && !attrs.selectedTarget
    && (attrs.selectedIndices?.length ?? 0) === 0
    && attrs.selectedIndex < 0
  const canDragByCursor = canDragNode && cursorMode !== 'insert'
  const selectedNotes: SelectedScoreNotes | null = useMemo(() => {
    if (!attrs.selectedTarget) return null
    const unique = Array.from(new Set(
      (attrs.selectedIndices?.length ? attrs.selectedIndices : (attrs.selectedIndex >= 0 ? [attrs.selectedIndex] : []))
        .filter((idx) => Number.isInteger(idx) && idx >= 0),
    )).sort((a, b) => a - b)
    if (unique.length === 0) return null
    return { target: attrs.selectedTarget, indices: unique }
  }, [attrs.selectedIndex, attrs.selectedIndices, attrs.selectedTarget])

  const updateNodeAttrs = (partial: Partial<ScoreAttrs>) => {
    if (!editor || typeof getPos !== 'function') return
    const nodePos = getPos()
    editor.commands.command(({ tr, state, dispatch }) => {
      const currentNode = state.doc.nodeAt(nodePos)
      if (!currentNode) return false
      tr.setNodeMarkup(nodePos, undefined, {
        ...(node.attrs as ScoreAttrs),
        ...partial,
      })
      tr.setSelection(NodeSelection.create(tr.doc, nodePos))
      if (dispatch) dispatch(tr)
      return true
    })
  }

  const clearSelectedNotes = () => {
    if (!attrs.selectedTarget && (attrs.selectedIndices?.length ?? 0) === 0 && attrs.selectedIndex < 0) return
    updateNodeAttrs({
      selectedTarget: '',
      selectedIndex: -1,
      selectedIndices: [],
    })
  }

  const updateScoreAttrsFromMenu = (partial: Partial<ScoreAttrs>) => {
    const next: Partial<ScoreAttrs> = { ...partial }
    if (!allowMultiSingleStaff) {
      next.singleStaffCount = 1
    }
    if (!allowDoubleDotted && next.inputDots != null) {
      next.inputDots = Math.min(1, Number(next.inputDots)) as ScoreAttrs['inputDots']
    }
    if (next.staff === 'grand' && attrs.staff === 'single' && Number(attrs.singleStaffCount || 1) >= 2) {
      next.staff = 'single'
    }
    if (next.staff === 'single' && attrs.staff === 'grand') {
      const sourceTarget = clefMenu?.target === 'lower' ? 'lower' : 'upper'
      next.notes = sourceTarget === 'lower' ? attrs.lowerNotes : attrs.upperNotes
      next.singleNotes2 = ''
      next.singleNotes3 = ''
      next.singleNotes4 = ''
      next.singleStaffCount = 1
      next.singleClef = 'treble'
      next.singleClef2 = 'treble'
      next.singleClef3 = 'treble'
      next.singleClef4 = 'treble'
    }
    if (next.staff === 'grand' && attrs.staff === 'single') {
      const sourceTarget = clefMenu?.target && SINGLE_TARGETS.includes(clefMenu.target) ? clefMenu.target : 'single'
      const sourceSingleNotes = getNotesByTarget(attrs, sourceTarget)
      const sourceSingleClef = getClefByTarget(attrs, sourceTarget)
      next.upperClef = 'treble'
      next.lowerClef = 'bass'
      if (sourceSingleClef === 'bass') {
        next.lowerNotes = sourceSingleNotes
      } else {
        next.upperNotes = sourceSingleNotes
      }
    }
    updateNodeAttrs(next)
  }

  useEffect(() => {
    const patch: Partial<ScoreAttrs> = {}
    if (!allowMultiSingleStaff && Number(attrs.singleStaffCount || 1) !== 1) {
      patch.singleStaffCount = 1
    }
    if (!allowDoubleDotted && Number(attrs.inputDots ?? 0) > 1) {
      patch.inputDots = 1
    }
    if (Object.keys(patch).length > 0) {
      updateNodeAttrs(patch)
    }
  }, [allowDoubleDotted, allowMultiSingleStaff, attrs.inputDots, attrs.singleStaffCount])

  useEffect(() => {
    const container = canvasRef.current
    if (!container) return undefined

    const rafId = window.requestAnimationFrame(() => {
      setLayoutTick((value) => value + 1)
    })

    const observer = new ResizeObserver(() => {
      setLayoutTick((value) => value + 1)
    })

    observer.observe(container)
    if (container.parentElement) {
      observer.observe(container.parentElement)
    }
    const editorRoot = container.closest('.ProseMirror')
    if (editorRoot) {
      observer.observe(editorRoot)
    }

    return () => {
      window.cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const container = canvasRef.current
    if (!container) return
    const { errors: renderErrors } = renderScoreSvg(
      container,
      {
        ...attrs,
        singleStaffCount: normalizedSingleStaffCount as ScoreAttrs['singleStaffCount'],
        inputDots: normalizedInputDots as ScoreAttrs['inputDots'],
      },
      selectedNotes,
    )
    setErrors(renderErrors)
  }, [attrs, layoutTick, selectedNotes])

  useEffect(() => {
    if (!editor || typeof getPos !== 'function') return undefined

    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedNotes || selectedNotes.indices.length !== 1) return
      const isVerticalMove = event.key === 'ArrowUp' || event.key === 'ArrowDown'
      const isHorizontalMove = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
      if (!isVerticalMove && !isHorizontalMove) return

      const nodePos = getPos()
      const isSelected =
        isNodeSelectionAt(editor.state.selection, nodePos)
      if (!isSelected) return

      const current = getNotesByTarget(attrs, selectedNotes.target)
      const tokens = current?.trim() ? current.trim().split(/\s+/) : []

      if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
      const selectedIndex = selectedNotes.indices[0]
      if (selectedIndex < 0 || selectedIndex >= tokens.length) return

      if (isHorizontalMove) {
        event.preventDefault()
        event.stopPropagation()
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation()
        }
        const nextIndex = event.key === 'ArrowLeft'
          ? Math.max(0, selectedIndex - 1)
          : Math.min(tokens.length - 1, selectedIndex + 1)
        if (nextIndex === selectedIndex) return

        const nextAttrs: ScoreAttrs = {
          ...attrs,
          selectedTarget: selectedNotes.target,
          selectedIndex: nextIndex,
          selectedIndices: [nextIndex],
        }
        editor.commands.command(({ tr, state, dispatch }) => {
          const currentNode = state.doc.nodeAt(nodePos)
          if (!currentNode) return false
          tr.setNodeMarkup(nodePos, undefined, nextAttrs)
          tr.setSelection(NodeSelection.create(tr.doc, nodePos))
          if (dispatch) dispatch(tr)
          return true
        })
        return
      }

      event.preventDefault()
      event.stopPropagation()
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation()
      }
      const clef = getClefByTarget(attrs, selectedNotes.target)
      const delta = event.key === 'ArrowUp' ? 1 : -1
      const moved = transposeTokenByStep(tokens[selectedIndex], delta, clef)
      if (moved === tokens[selectedIndex]) return
      tokens[selectedIndex] = moved
      const next = tokens.join(' ')
      const nextAttrs: ScoreAttrs = {
        ...attrs,
        ...getNotesPatchByTarget(selectedNotes.target, next),
      }
      editor.commands.command(({ tr, state, dispatch }) => {
        const currentNode = state.doc.nodeAt(nodePos)
        if (!currentNode) return false
        tr.setNodeMarkup(nodePos, undefined, nextAttrs)
        tr.setSelection(NodeSelection.create(tr.doc, nodePos))
        if (dispatch) dispatch(tr)
        return true
      })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [editor, getPos, attrs, selectedNotes])

  useEffect(() => {
    if (!editor || typeof getPos !== 'function') return undefined

    const onDeleteKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (!selectedNotes || selectedNotes.indices.length === 0) return

      const nodePos = getPos()
      const isNodeSelected =
        isNodeSelectionAt(editor.state.selection, nodePos)
      if (!isNodeSelected) return

      const current = getNotesByTarget(attrs, selectedNotes.target)
      const tokens = current?.trim() ? current.trim().split(/\s+/) : []
      const indices = Array.from(new Set(selectedNotes.indices))
        .filter((idx) => idx >= 0 && idx < tokens.length)
        .sort((a, b) => b - a)
      if (indices.length === 0) return

      event.preventDefault()
      event.stopPropagation()
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation()
      }

      indices.forEach((idx) => {
        tokens.splice(idx, 1)
      })

      const nextAttrs: ScoreAttrs = {
        ...attrs,
        ...getNotesPatchByTarget(selectedNotes.target, tokens.join(' ')),
        selectedTarget: '',
        selectedIndex: -1,
        selectedIndices: [],
      }

      editor.commands.command(({ tr, state, dispatch }) => {
        const currentNode = state.doc.nodeAt(nodePos)
        if (!currentNode) return false
        tr.setNodeMarkup(nodePos, undefined, nextAttrs)
        tr.setSelection(NodeSelection.create(tr.doc, nodePos))
        if (dispatch) dispatch(tr)
        return true
      })
    }

    window.addEventListener('keydown', onDeleteKeyDown, true)
    return () => window.removeEventListener('keydown', onDeleteKeyDown, true)
  }, [editor, getPos, attrs, selectedNotes])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || typeof getPos !== 'function') return
    const nodePos = getPos()
    if (dragHandleDisabledAfterDrop) {
      clearDndSuppress()
      setDragHandleDisabledAfterDrop(false)
    }
    if (typeof window !== 'undefined' && window.__scoreDndSuppress === true) {
      clearDndSuppress()
      editor.commands.command(({ tr, dispatch }) => {
        tr.setMeta('score-force-bubble-refresh', Date.now())
        if (dispatch) dispatch(tr)
        return true
      })
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (event.detail > 1) return
    if (!editor) return
    const container = canvasRef.current
    if (!container) return
    const isSelected =
      editor.state.selection instanceof NodeSelection
      && editor.state.selection.from === nodePos
    const svg = container.querySelector('svg')
    if (!svg) return
    const localPoint = getLocalPointFromMouse(svg, event)
    if (!localPoint) return
    const { x, y, svgWidth } = localPoint

    const clefTarget = getClefTargetFromPoint(container, attrs.staff, x, y)
    if (clefTarget) {
      setSettingsMenu(null)
      if (attrs.staff !== 'single') return
      if (!isSelected) {
        editor.commands.focus()
        editor.commands.setNodeSelection(nodePos)
      }
      if (clefMenu && clefMenu.target === clefTarget) {
        setClefMenu(null)
        clearSelectedNotes()
        return
      }
      const menuWidth = 240
      const menuHeight = 260
      const padding = 12
      const left = Math.max(
        padding,
        Math.min(window.innerWidth - menuWidth - padding, event.clientX + 8),
      )
      const top = Math.max(
        padding,
        Math.min(window.innerHeight - menuHeight - padding, event.clientY + 8),
      )
      setClefMenu({ target: clefTarget, left, top })
      return
    }

    if (clefMenu) {
      setClefMenu(null)
      clearSelectedNotes()
    }
    if (settingsMenu) {
      setSettingsMenu(null)
      clearSelectedNotes()
    }

    const canInsert = isSelected && editor.isFocused && isScoreBubbleVisible()
    if (!canInsert) {
      if (!isSelected || !editor.isFocused) {
        editor.commands.focus()
        editor.commands.setNodeSelection(nodePos)
      } else {
        // Force BubbleMenu shouldShow re-evaluation even when selection didn't change.
        editor.commands.command(({ tr, dispatch }) => {
          tr.setMeta('score-force-bubble-refresh', Date.now())
          if (dispatch) dispatch(tr)
          return true
        })
      }
      return
    }

    const staffTopY = Number(container.dataset.staffTopY ?? 20)
    const staffLineSpacing = Number(container.dataset.staffLineSpacing ?? 10)
    const lowerStaffTopY = Number(
      container.dataset.lowerStaffTopY ?? staffTopY + staffLineSpacing * 8,
    )
    const lowerStaffLineSpacing = Number(container.dataset.lowerStaffLineSpacing ?? staffLineSpacing)
    const inStrictUpper = isYWithinStaff(y, staffTopY, staffLineSpacing, 0)
    const inStrictLower = isYWithinStaff(y, lowerStaffTopY, lowerStaffLineSpacing, 0)
    const singleTops = parseNumberList(container.dataset.singleStaffTopYs)
    const inStrictSingle = attrs.staff === 'single'
      ? singleTops.some((top) => isYWithinStaff(y, top, staffLineSpacing, 0))
      : false
    const inStrictTarget = attrs.staff === 'grand' ? (inStrictUpper || inStrictLower) : inStrictSingle
    if (!inStrictTarget) {
      if (attrs.selectedTarget || (attrs.selectedIndices?.length ?? 0) > 0 || attrs.selectedIndex >= 0) {
        updateNodeAttrs({
          selectedTarget: '',
          selectedIndex: -1,
          selectedIndices: [],
        })
      }
      return
    }

    const target = getScoreTargetFromY(
      container,
      attrs.staff,
      y,
      staffTopY,
      staffLineSpacing,
      lowerStaffTopY,
      lowerStaffLineSpacing,
    )

    if (!target) {
      if (attrs.selectedTarget || (attrs.selectedIndices?.length ?? 0) > 0 || attrs.selectedIndex >= 0) {
        updateNodeAttrs({
          selectedTarget: '',
          selectedIndex: -1,
          selectedIndices: [],
        })
      }
      return
    }

    const singleIndex = SINGLE_TARGETS.indexOf(target)
    const targetStaffTopY = target === 'lower'
      ? lowerStaffTopY
      : singleIndex >= 0
        ? (singleTops[singleIndex] ?? staffTopY)
        : staffTopY
    const targetLineSpacing = target === 'lower' ? lowerStaffLineSpacing : staffLineSpacing
    const clef = getClefByTarget(attrs, target)
    const pitch = pitchFromY(
      y,
      targetStaffTopY,
      targetLineSpacing,
      clef,
    )
    const accidental = attrs.inputAccidental || ''
    const duration = attrs.inputDuration || 'q'
    const dots = normalizedInputDots as 0 | 1 | 2
    const tuplet = Boolean(attrs.inputTuplet)
    const dotSuffix = '.'.repeat(dots)
    const inputMode = (attrs.inputMode as ScoreAttrs['inputMode']) || 'note'
    const { numBeats, beatValue } = parseTimeSig(attrs.timeSig || '4/4')
    const nextBeats = durationTokenToBeatsWithTuplet(duration, beatValue, dots, tuplet)

    const current = getNotesByTarget(attrs, target)

    const tokens = current?.trim() ? current.trim().split(/\s+/) : []
    const prefix = getDataPrefixByTarget(target)
    const noteXs = parseNumberList(container.dataset[`${prefix}NoteXs`])
    const noteYs = parseNumberList(container.dataset[`${prefix}NoteYs`])
    const localStaffTopY = target === 'lower'
      ? lowerStaffTopY
      : singleIndex >= 0
        ? (singleTops[singleIndex] ?? staffTopY)
        : staffTopY
    const localStaffLineSpacing = targetLineSpacing
    const tokenMap = parseNumberList(container.dataset[`${prefix}NoteTokenMap`])
    const renderedPitches = parseStringList(container.dataset[`${prefix}RenderedPitches`])
    const nearestIdx = findNearestTokenIndexFromRendered({
      tokens,
      noteXs,
      noteYs,
      tokenMap,
      renderedPitches,
      x,
      y,
      staffTopY: localStaffTopY,
      staffLineSpacing: localStaffLineSpacing,
      maxDx: 24,
      maxDy: 24,
    })
    const hasSelectedNotes = Boolean(selectedNotes && selectedNotes.indices.length > 0)
    if (hasSelectedNotes) {
      const clickedSelectedNote = Boolean(
        selectedNotes
        && selectedNotes.target === target
        && nearestIdx >= 0
        && selectedNotes.indices.includes(nearestIdx),
      )
      if (clickedSelectedNote) {
        updateNodeAttrs({ selectedTarget: target, selectedIndex: nearestIdx, selectedIndices: [nearestIdx] })
        return
      }
      if (nearestIdx >= 0) {
        updateNodeAttrs({ selectedTarget: target, selectedIndex: nearestIdx, selectedIndices: [nearestIdx] })
        return
      }
      updateNodeAttrs({
        selectedTarget: '',
        selectedIndex: -1,
        selectedIndices: [],
      })
      return
    }
    if (nearestIdx >= 0) {
      updateNodeAttrs({ selectedTarget: target, selectedIndex: nearestIdx, selectedIndices: [nearestIdx] })
      return
    }

    const { starts: beatStarts, totalBeats } = getTokenBeatStarts(tokens, beatValue)
    const maxBeats = numBeats * MAX_AUTO_MEASURES
    if (totalBeats + nextBeats > maxBeats) {
      return
    }
    const noteStartX = Number(
      container.dataset[`${prefix}NoteStartX`],
    ) || 0
    const noteEndX = Number(
      container.dataset[`${prefix}NoteEndX`],
    ) || svgWidth
    const clampedX = Math.max(noteStartX, Math.min(noteEndX, x))
    const insertIndex = noteXs.length === tokens.length && noteXs.length > 0
      ? Math.max(0, Math.min(tokens.length, getInsertIndexByX(noteXs, clampedX)))
      : (() => {
        const boundaries = parseNumberList(
          container.dataset[`${prefix}MeasureBoundaries`],
        )
        let clickBeat = 0
        if (boundaries.length >= 2) {
          const firstX = boundaries[0]
          const lastX = boundaries[boundaries.length - 1]
          const clampedXFromBoundaries = Math.max(firstX, Math.min(lastX, x))
          let measureIndex = 0
          for (let i = 0; i < boundaries.length - 1; i += 1) {
            if (clampedXFromBoundaries <= boundaries[i + 1]) {
              measureIndex = i
              break
            }
          }
          const measureStartX = boundaries[measureIndex]
          const measureEndX = boundaries[measureIndex + 1]
          const measureWidth = Math.max(1, measureEndX - measureStartX)
          const inMeasure = (clampedXFromBoundaries - measureStartX) / measureWidth
          clickBeat = measureIndex * numBeats + inMeasure * numBeats
        } else {
          const noteWidth = Math.max(1, noteEndX - noteStartX)
          clickBeat = ((clampedX - noteStartX) / noteWidth) * totalBeats
        }
        return Math.max(0, Math.min(tokens.length, getInsertIndexByBeat(beatStarts, clickBeat)))
      })()
    const insertBeat = beatStarts[insertIndex] ?? totalBeats
    const generatedTokens: string[] = []
    if (tuplet) {
      const tupletMark = 't'
      generatedTokens.push(
        inputMode === 'rest'
          ? `r/${duration}${tupletMark}${dotSuffix}`
          : `${pitch}${accidental}/${duration}${tupletMark}${dotSuffix}`,
      )
    } else {
      const segments: number[] = []
      let remaining = nextBeats
      let cursorBeat = insertBeat
      while (remaining > 0.0001) {
        const beatInMeasure = ((cursorBeat % numBeats) + numBeats) % numBeats
        const remainInMeasure = beatInMeasure === 0 ? numBeats : numBeats - beatInMeasure
        const chunk = Math.min(remaining, remainInMeasure)
        segments.push(chunk)
        cursorBeat += chunk
        remaining -= chunk
      }

      segments.forEach((segmentBeats, segIdx) => {
        const durations = splitBeatsIntoDurations(segmentBeats, beatValue)
        durations.forEach((dur, durIdx) => {
          const isLast = segIdx === segments.length - 1 && durIdx === durations.length - 1
          const tieMark = inputMode === 'note' && !isLast ? '~' : ''
          const dotsSuffixForPart = '.'.repeat(dur.dots)
          const nextToken = inputMode === 'rest'
            ? `r/${dur.token}${dotsSuffixForPart}`
            : `${pitch}${accidental}/${dur.token}${dotsSuffixForPart}${tieMark}`
          generatedTokens.push(nextToken)
        })
      })
    }
    if (generatedTokens.length === 0) {
      const tupletMark = tuplet ? 't' : ''
      generatedTokens.push(inputMode === 'rest' ? `r/${duration}${tupletMark}${dotSuffix}` : `${pitch}${accidental}/${duration}${tupletMark}${dotSuffix}`)
    }

    tokens.splice(insertIndex, 0, ...generatedTokens)
    const next = tokens.join(' ')

      const nextAttrs: ScoreAttrs = {
        ...attrs,
      ...getNotesPatchByTarget(target, next),
      selectedTarget: target,
      selectedIndex: insertIndex,
      selectedIndices: [insertIndex],
    }

    editor.commands.command(({ tr, state, dispatch }) => {
      const currentNode = state.doc.nodeAt(nodePos)
      if (!currentNode) return false
      tr.setNodeMarkup(nodePos, undefined, nextAttrs)
      tr.setSelection(NodeSelection.create(tr.doc, nodePos))
      if (dispatch) dispatch(tr)
      return true
    })
  }

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor) return
    const container = canvasRef.current
    if (!container) return
    if (typeof getPos !== 'function') return
    const nodePos = getPos()
    const isSelected =
      editor.state.selection instanceof NodeSelection
      && editor.state.selection.from === nodePos
    const canEdit = isSelected && editor.isFocused
    if (!canEdit) {
      editor.commands.focus()
      editor.commands.setNodeSelection(nodePos)
      return
    }
    const svg = container.querySelector('svg')
    if (!svg) return
    const localPoint = getLocalPointFromMouse(svg, event)
    if (!localPoint) return
    const { x, y } = localPoint

    const staffTopY = Number(container.dataset.staffTopY ?? 20)
    const staffLineSpacing = Number(container.dataset.staffLineSpacing ?? 10)
    const lowerStaffTopY = Number(
      container.dataset.lowerStaffTopY ?? staffTopY + staffLineSpacing * 8,
    )
    const lowerStaffLineSpacing = Number(container.dataset.lowerStaffLineSpacing ?? staffLineSpacing)
    const singleTops = parseNumberList(container.dataset.singleStaffTopYs)
    const target = getScoreTargetFromY(
      container,
      attrs.staff,
      y,
      staffTopY,
      staffLineSpacing,
      lowerStaffTopY,
      lowerStaffLineSpacing,
    )
    if (!target) {
      if (typeof getPos !== 'function') return
      const nodePos = getPos()
      const isNodeSelected = isNodeSelectionAt(editor.state.selection, nodePos)
      if (!isNodeSelected) {
        editor.commands.focus()
        editor.commands.setNodeSelection(nodePos)
      }
      return
    }

    const current = getNotesByTarget(attrs, target)
    const tokens = current?.trim() ? current.trim().split(/\s+/) : []
    if (tokens.length === 0) return
    const prefix = getDataPrefixByTarget(target)
    const noteXs = parseNumberList(container.dataset[`${prefix}NoteXs`])
    const noteYs = parseNumberList(container.dataset[`${prefix}NoteYs`])
    if (noteXs.length === 0) return

    const singleIndex = SINGLE_TARGETS.indexOf(target)
    const localStaffTopY = target === 'lower'
      ? lowerStaffTopY
      : singleIndex >= 0
        ? (singleTops[singleIndex] ?? staffTopY)
        : staffTopY
    const localStaffLineSpacing = target === 'lower' ? lowerStaffLineSpacing : staffLineSpacing
    const tokenMap = parseNumberList(container.dataset[`${prefix}NoteTokenMap`])
    const renderedPitches = parseStringList(container.dataset[`${prefix}RenderedPitches`])
    const nearestIdx = findNearestTokenIndexFromRendered({
      tokens,
      noteXs,
      noteYs,
      tokenMap,
      renderedPitches,
      x,
      y,
      staffTopY: localStaffTopY,
      staffLineSpacing: localStaffLineSpacing,
      maxDx: 36,
      maxDy: 28,
    })
    if (nearestIdx < 0) return

    tokens.splice(nearestIdx, 1)
    const next = tokens.join(' ')
    let nextSelectedTarget: ScoreAttrs['selectedTarget'] = ''
    let nextSelectedIndex = -1
    if (selectedNotes && selectedNotes.target === target && selectedNotes.indices.length === 1) {
      const selectedIndex = selectedNotes.indices[0]
      if (selectedIndex < nearestIdx) {
        nextSelectedTarget = target
        nextSelectedIndex = selectedIndex
      } else if (selectedIndex > nearestIdx) {
        nextSelectedTarget = target
        nextSelectedIndex = selectedIndex - 1
      }
    }
    const nextAttrs: ScoreAttrs = {
      ...attrs,
      ...getNotesPatchByTarget(target, next),
      selectedTarget: nextSelectedTarget,
      selectedIndex: nextSelectedIndex,
      selectedIndices: nextSelectedIndex >= 0 ? [nextSelectedIndex] : [],
    }

    editor.commands.command(({ tr, state, dispatch }) => {
      const currentNode = state.doc.nodeAt(nodePos)
      if (!currentNode) return false
      tr.setNodeMarkup(nodePos, undefined, nextAttrs)
      tr.setSelection(NodeSelection.create(tr.doc, nodePos))
      if (dispatch) dispatch(tr)
      return true
    })
  }

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!editor || typeof getPos !== 'function') return
    const nodePos = getPos()
    const isSelected =
      editor.state.selection instanceof NodeSelection
      && editor.state.selection.from === nodePos
    if (!isSelected) {
      editor.commands.focus()
      editor.commands.setNodeSelection(nodePos)
    }
    setClefMenu(null)
    const menuWidth = 260
    const menuHeight = 320
    const padding = 12
    const left = Math.max(
      padding,
      Math.min(window.innerWidth - menuWidth - padding, event.clientX + 8),
    )
    const top = Math.max(
      padding,
      Math.min(window.innerHeight - menuHeight - padding, event.clientY + 8),
    )
    setSettingsMenu({ left, top })
  }

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor) return
    if (dragHandleDisabledAfterDrop) {
      if (typeof window !== 'undefined') {
        window.__scoreDndBlockDragHandleUntil = 0
      }
      setDragHandleDisabledAfterDrop(false)
    }
    if (canDragByCursor) {
      // In drag-handle mode, let ProseMirror block drag take control.
      return
    }
    const container = canvasRef.current
    if (!container) return
    const svg = container.querySelector('svg')
    if (!svg) return
    const localPoint = getLocalPointFromMouse(svg, event)
    if (!localPoint) return
    const { x, y } = localPoint

    const staffTopY = Number(container.dataset.staffTopY ?? 20)
    const staffLineSpacing = Number(container.dataset.staffLineSpacing ?? 10)
    const lowerStaffTopY = Number(
      container.dataset.lowerStaffTopY ?? staffTopY + staffLineSpacing * 8,
    )
    const lowerStaffLineSpacing = Number(container.dataset.lowerStaffLineSpacing ?? staffLineSpacing)

    const target = getScoreTargetFromY(
      container,
      attrs.staff,
      y,
      staffTopY,
      staffLineSpacing,
      lowerStaffTopY,
      lowerStaffLineSpacing,
    )
    if (!target) return

    const preview = containerRef.current
    if (!preview) return
    const previewRect = preview.getBoundingClientRect()
    dragRef.current = {
      target,
      startX: x,
      startY: y,
      startClientX: event.clientX - previewRect.left + preview.scrollLeft,
      startClientY: event.clientY - previewRect.top + preview.scrollTop,
      moved: false,
    }
  }

  const handleMouseDownCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    suppressClickRef.current = false
    clearDndSuppress()
    if (!editor || typeof getPos !== 'function') return
    const nodePos = getPos()
    const isNodeSelected = isNodeSelectionAt(editor.state.selection, nodePos)
    if (!editor.isFocused || !isNodeSelected) {
      editor.commands.focus()
      editor.commands.setNodeSelection(nodePos)
      window.setTimeout(() => {
        try {
          if (!isNodeSelectionAt(editor.state.selection, nodePos)) {
            editor.commands.focus()
            editor.commands.setNodeSelection(nodePos)
          }
        } catch {
          // ignore remap timing
        }
      }, 0)
    }
  }

  const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    suppressClickRef.current = false
    clearDndSuppress()
    if (!editor || typeof getPos !== 'function') return
    const nodePos = getPos()
    const isNodeSelected = isNodeSelectionAt(editor.state.selection, nodePos)
    if (!editor.isFocused || !isNodeSelected) {
      editor.commands.focus()
      editor.commands.setNodeSelection(nodePos)
      window.setTimeout(() => {
        try {
          if (!isNodeSelectionAt(editor.state.selection, nodePos)) {
            editor.commands.focus()
            editor.commands.setNodeSelection(nodePos)
          }
        } catch {
          // ignore remap timing
        }
      }, 0)
    }
  }

  const finalizeDragSelection = (clientX: number, clientY: number) => {
    if (!editor) return
    const drag = dragRef.current
    dragRef.current = null
    setDragBox(null)
    if (!drag || !drag.moved) return

    const container = canvasRef.current
    if (!container) return
    const svg = container.querySelector('svg')
    if (!svg) return
    const localPoint = getLocalPointFromClient(svg, clientX, clientY)
    if (!localPoint) return
    const { x, y } = localPoint
    const minX = Math.min(drag.startX, x)
    const maxX = Math.max(drag.startX, x)
    const minY = Math.min(drag.startY, y)
    const maxY = Math.max(drag.startY, y)

    const tokensSource = getNotesByTarget(attrs, drag.target)
    const tokens = tokensSource?.trim() ? tokensSource.trim().split(/\s+/) : []
    const dragPrefix = getDataPrefixByTarget(drag.target)
    const noteXs = parseNumberList(container.dataset[`${dragPrefix}NoteXs`])
    const noteYs = parseNumberList(container.dataset[`${dragPrefix}NoteYs`])
    const tokenMap = parseNumberList(container.dataset[`${dragPrefix}NoteTokenMap`])
    const staffTopY = Number(container.dataset.staffTopY ?? 20)
    const staffLineSpacing = Number(container.dataset.staffLineSpacing ?? 10)
    const lowerStaffTopY = Number(container.dataset.lowerStaffTopY ?? staffTopY + staffLineSpacing * 8)
    const lowerStaffLineSpacing = Number(container.dataset.lowerStaffLineSpacing ?? staffLineSpacing)
    const singleTops = parseNumberList(container.dataset.singleStaffTopYs)
    const dragSingleIndex = SINGLE_TARGETS.indexOf(drag.target)
    const localStaffTopY = drag.target === 'lower'
      ? lowerStaffTopY
      : dragSingleIndex >= 0
        ? (singleTops[dragSingleIndex] ?? staffTopY)
        : staffTopY
    const localStaffLineSpacing = drag.target === 'lower' ? lowerStaffLineSpacing : staffLineSpacing

    const selected = new Set<number>()
    for (let i = 0; i < noteXs.length; i += 1) {
      const tokenIdx = tokenMap[i] ?? i
      if (tokenIdx < 0 || tokenIdx >= tokens.length) continue
      const nx = noteXs[i]
      if (nx < minX || nx > maxX) continue
      const ny = Number.isFinite(noteYs[i]) ? noteYs[i] : (localStaffTopY + localStaffLineSpacing * 2)
      if (ny < minY - 16 || ny > maxY + 16) continue
      selected.add(tokenIdx)
    }

    const indices = Array.from(selected).sort((a, b) => a - b)
    if (indices.length > 0) {
      updateNodeAttrs({
        selectedTarget: drag.target,
        selectedIndices: indices,
        selectedIndex: indices[0],
      })
      suppressClickRef.current = true
    }
  }
  const handleMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    finalizeDragSelection(event.clientX, event.clientY)
  }

  useEffect(() => {
    finalizeDragSelectionRef.current = finalizeDragSelection
  })

  useEffect(() => {
    const hasSelection = Boolean(
      attrs.selectedTarget
      && ((attrs.selectedIndices?.length ?? 0) > 0 || attrs.selectedIndex >= 0),
    )
    if (!hasSelection) return undefined

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const preview = containerRef.current
      if (!target || !preview) return
      if (preview.contains(target)) return
      // バブルメニュー操作中は選択を維持する
      if (target.closest('.score-bubble')) return

      if (!editor || typeof getPos !== 'function') return
      const nodePos = getPos()
      editor.commands.command(({ tr, state, dispatch }) => {
        const currentNode = state.doc.nodeAt(nodePos)
        if (!currentNode) return false
        tr.setNodeMarkup(nodePos, undefined, {
          ...(attrs as ScoreAttrs),
          selectedTarget: '',
          selectedIndex: -1,
          selectedIndices: [],
        })
        if (dispatch) dispatch(tr)
        return true
      })
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown)
    }
  }, [attrs, attrs.selectedTarget, attrs.selectedIndex, attrs.selectedIndices, editor, getPos])

  useEffect(() => {
    if (!clefMenu && !settingsMenu) return undefined
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('.score-clef-menu')) return
      if (target.closest('.score-settings-menu')) return
      setClefMenu(null)
      setSettingsMenu(null)
      if (attrs.selectedTarget || (attrs.selectedIndices?.length ?? 0) > 0 || attrs.selectedIndex >= 0) {
        if (!editor || typeof getPos !== 'function') return
        const nodePos = getPos()
        editor.commands.command(({ tr, state, dispatch }) => {
          const currentNode = state.doc.nodeAt(nodePos)
          if (!currentNode) return false
          tr.setNodeMarkup(nodePos, undefined, {
            ...(attrs as ScoreAttrs),
            selectedTarget: '',
            selectedIndex: -1,
            selectedIndices: [],
          })
          if (dispatch) dispatch(tr)
          return true
        })
      }
      if (editor && typeof getPos === 'function') {
        const nodePos = getPos()
        const isNodeSelected =
          editor.state.selection instanceof NodeSelection
          && editor.state.selection.from === nodePos
        if (isNodeSelected) {
          editor.commands.blur()
        }
      }
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }, [clefMenu, settingsMenu, attrs, attrs.selectedTarget, attrs.selectedIndices, attrs.selectedIndex, editor, getPos])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!editor || typeof getPos !== 'function') return
      const nodePos = getPos()
      const isNodeSelected =
        isNodeSelectionAt(editor.state.selection, nodePos)
      const hasSelectedNotes = Boolean(
        attrs.selectedTarget
        || (attrs.selectedIndices?.length ?? 0) > 0
        || attrs.selectedIndex >= 0,
      )
      if (!clefMenu && !settingsMenu && !hasSelectedNotes && !isNodeSelected) return
      setClefMenu(null)
      setSettingsMenu(null)
      if (hasSelectedNotes) {
        editor.commands.command(({ tr, state, dispatch }) => {
          const currentNode = state.doc.nodeAt(nodePos)
          if (!currentNode) return false
          tr.setNodeMarkup(nodePos, undefined, {
            ...(attrs as ScoreAttrs),
            selectedTarget: '',
            selectedIndex: -1,
            selectedIndices: [],
          })
          if (dispatch) dispatch(tr)
          return true
        })
        return
      }
      if (isNodeSelected) {
        editor.commands.blur()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clefMenu, settingsMenu, attrs, attrs.selectedTarget, attrs.selectedIndices, attrs.selectedIndex, editor, getPos])

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag) {
      const container = canvasRef.current
      if (container) {
        const svg = container.querySelector('svg')
        if (svg) {
          const localPoint = getLocalPointFromMouse(svg, event)
          if (localPoint) {
            const moved = Math.abs(localPoint.x - drag.startX) > 4 || Math.abs(localPoint.y - drag.startY) > 4
            if (moved) {
              drag.moved = true
              suppressClickRef.current = true
              const preview = containerRef.current
              if (!preview) return
              const rect = preview.getBoundingClientRect()
              const currentX = event.clientX - rect.left + preview.scrollLeft
              const currentY = event.clientY - rect.top + preview.scrollTop
              setDragBox({
                left: Math.min(drag.startClientX, currentX),
                top: Math.min(drag.startClientY, currentY),
                width: Math.abs(currentX - drag.startClientX),
                height: Math.abs(currentY - drag.startClientY),
              })
              setCursorMode('select')
              return
            }
          }
        }
      }
    }

    const container = canvasRef.current
    if (!container) return
    const svg = container.querySelector('svg')
    if (!svg) {
      setCursorMode('default')
      return
    }
    const localPoint = getLocalPointFromMouse(svg, event)
    if (!localPoint) {
      setCursorMode('default')
      return
    }
    const { x, y } = localPoint
    const staffTopY = Number(container.dataset.staffTopY ?? 20)
    const staffLineSpacing = Number(container.dataset.staffLineSpacing ?? 10)
    const lowerStaffTopY = Number(
      container.dataset.lowerStaffTopY ?? staffTopY + staffLineSpacing * 8,
    )
    const lowerStaffLineSpacing = Number(container.dataset.lowerStaffLineSpacing ?? staffLineSpacing)
    const singleTops = parseNumberList(container.dataset.singleStaffTopYs)
    const target = getScoreTargetFromY(
      container,
      attrs.staff,
      y,
      staffTopY,
      staffLineSpacing,
      lowerStaffTopY,
      lowerStaffLineSpacing,
    )
    if (!target) {
      setCursorMode('default')
      return
    }
    const onClef = Boolean(getClefTargetFromPoint(container, attrs.staff, x, y))
    if (onClef) {
      setCursorMode('select')
      return
    }

    const current = getNotesByTarget(attrs, target)
    const tokens = current?.trim() ? current.trim().split(/\s+/) : []
    const prefix = getDataPrefixByTarget(target)
    const noteXs = parseNumberList(container.dataset[`${prefix}NoteXs`])
    const noteYs = parseNumberList(container.dataset[`${prefix}NoteYs`])
    const singleIndex = SINGLE_TARGETS.indexOf(target)
    const localStaffTopY = target === 'lower'
      ? lowerStaffTopY
      : singleIndex >= 0
        ? (singleTops[singleIndex] ?? staffTopY)
        : staffTopY
    const localStaffLineSpacing = target === 'lower' ? lowerStaffLineSpacing : staffLineSpacing
    const tokenMap = parseNumberList(container.dataset[`${prefix}NoteTokenMap`])
    const renderedPitches = parseStringList(container.dataset[`${prefix}RenderedPitches`])
    const nearestIdx = findNearestTokenIndexFromRendered({
      tokens,
      noteXs,
      noteYs,
      tokenMap,
      renderedPitches,
      x,
      y,
      staffTopY: localStaffTopY,
      staffLineSpacing: localStaffLineSpacing,
      maxDx: 24,
      maxDy: 24,
    })
    if (nearestIdx >= 0) {
      setCursorMode('select')
      return
    }

    const nodePos = typeof getPos === 'function' ? getPos() : -1
    const isSelected =
      editor.state.selection instanceof NodeSelection
      && editor.state.selection.from === nodePos
    const canInsert = isSelected && editor.isFocused && isScoreBubbleVisible()
    setCursorMode(canInsert ? 'insert' : 'default')
  }

  const handleMouseLeave = () => {
    if (!dragRef.current) {
      setDragBox(null)
    }
    setCursorMode('default')
  }

  const handleDragStart = () => {
    if (typeof window === 'undefined') return
    window.__scoreRequireClickAfterDnd = true
    window.__scoreDndSuppress = true
    window.__scoreDndSuppressUntil = Date.now() + 700
    window.dispatchEvent(new CustomEvent('score-node-dnd', { detail: { phase: 'start' } }))
  }

  const handleDragEnd = () => {
    if (typeof window === 'undefined') return
    window.__scoreRequireClickAfterDnd = true
    window.__scoreDndBlockDragHandleUntil = Date.now() + DND_BLOCK_DRAG_HANDLE_MS
    setDragHandleDisabledAfterDrop(true)
    window.__scoreDndSuppress = true
    window.__scoreDndSuppressUntil = Date.now() + 700
    window.dispatchEvent(new CustomEvent('score-node-dnd', { detail: { phase: 'end' } }))
    if (!editor || typeof getPos !== 'function') return
    // DnD 後に editor focus が外れたままだと click が無効化されるため復元する。
    window.setTimeout(() => {
      try {
        const nodePos = getPos()
        if (typeof nodePos !== 'number' || nodePos < 0) return
        editor.commands.focus()
        editor.commands.setNodeSelection(nodePos)
      } catch {
        // getPos can be temporarily invalid during remap; ignore safely.
      }
    }, 0)
  }

  useEffect(() => {
    if (!dragHandleDisabledAfterDrop || typeof window === 'undefined') return undefined
    const remaining = Math.max(0, (window.__scoreDndBlockDragHandleUntil ?? 0) - Date.now())
    const timer = window.setTimeout(() => {
      window.__scoreDndBlockDragHandleUntil = 0
      setDragHandleDisabledAfterDrop(false)
    }, remaining + 20)
    return () => window.clearTimeout(timer)
  }, [dragHandleDisabledAfterDrop])

  useEffect(() => {
    const onWindowMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const preview = containerRef.current
      if (!preview) return
      const rect = preview.getBoundingClientRect()
      const currentX = event.clientX - rect.left + preview.scrollLeft
      const currentY = event.clientY - rect.top + preview.scrollTop
      const moved = Math.abs(currentX - drag.startClientX) > 4 || Math.abs(currentY - drag.startClientY) > 4
      if (!moved) return
      drag.moved = true
      suppressClickRef.current = true
      setDragBox({
        left: Math.min(drag.startClientX, currentX),
        top: Math.min(drag.startClientY, currentY),
        width: Math.abs(currentX - drag.startClientX),
        height: Math.abs(currentY - drag.startClientY),
      })
    }
    const onWindowMouseUp = (event: MouseEvent) => {
      finalizeDragSelectionRef.current(event.clientX, event.clientY)
    }
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
    }
  }, [])

  return (
    <NodeViewWrapper className="score-node" data-score-staff={node.attrs.staff}>
      <div
        className={`score-node__preview score-node__preview--${cursorMode}`}
        ref={containerRef}
        data-drag-handle={canDragByCursor && !dragHandleDisabledAfterDrop ? '' : undefined}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDrop={handleDragEnd}
        onPointerDownCapture={handlePointerDownCapture}
        onMouseDownCapture={handleMouseDownCapture}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      >
        <div className="score-node__canvas" ref={canvasRef} />
        {dragBox && (
          <div
            className="score-node__selection-box"
            style={{
              left: `${dragBox.left}px`,
              top: `${dragBox.top}px`,
              width: `${dragBox.width}px`,
              height: `${dragBox.height}px`,
            }}
          />
        )}
        {clefMenu && (
          <div
            className="score-clef-menu"
            style={{ left: `${clefMenu.left}px`, top: `${clefMenu.top}px`, position: 'fixed' }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {attrs.staff === 'single' && (
              <label>
                <span>音部記号</span>
                <select
                  value={getClefByTarget(attrs, clefMenu.target)}
                  onChange={(event) => {
                    const nextClef = event.target.value as NoteClef
                    updateScoreAttrsFromMenu(getClefPatchByTarget(clefMenu.target, nextClef))
                  }}
                >
                  <option value="treble">ト音記号</option>
                  <option value="bass">ヘ音記号</option>
                  <option value="alto">ハ音記号(アルト)</option>
                  <option value="tenor">ハ音記号(テナー)</option>
                </select>
              </label>
            )}
          </div>
        )}
        {settingsMenu && (
          <div
            className="score-settings-menu"
            style={{ left: `${settingsMenu.left}px`, top: `${settingsMenu.top}px`, position: 'fixed' }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <label>
              <span>拍子</span>
              <input
                value={attrs.timeSig}
                onChange={(event) => updateScoreAttrsFromMenu({ timeSig: event.target.value })}
                placeholder="4/4"
              />
            </label>
            <label>
              <span>調号</span>
              <select
                value={KEY_SIG_OPTIONS.some((option) => option.value === attrs.keySig) ? attrs.keySig : 'C'}
                onChange={(event) => updateScoreAttrsFromMenu({ keySig: event.target.value })}
              >
                {KEY_SIG_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>譜表</span>
              <select
                value={attrs.staff}
                disabled={attrs.staff === 'single' && normalizedSingleStaffCount >= 2}
                onChange={(event) => updateScoreAttrsFromMenu({ staff: event.target.value as ScoreAttrs['staff'] })}
              >
                <option value="single">単譜表</option>
                <option value="grand">大譜表</option>
              </select>
            </label>
            {attrs.staff === 'single' && allowMultiSingleStaff && (
              <label>
                <span>段数</span>
                <select
                  value={String(normalizedSingleStaffCount)}
                  onChange={(event) => updateScoreAttrsFromMenu({ singleStaffCount: Number(event.target.value) as ScoreAttrs['singleStaffCount'] })}
                >
                  <option value="1">1段</option>
                  <option value="2">2段</option>
                  <option value="3">3段</option>
                  <option value="4">4段</option>
                </select>
              </label>
            )}
          </div>
        )}
      </div>
      {errors.length > 0 && (
        <div className="score-node__errors">
          {errors.slice(0, 3).map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default ScoreNodeView
