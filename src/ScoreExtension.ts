import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'

import ScoreNodeView from './ScoreNodeView'
import { defaultScoreAttrs, type ScoreAttrs } from './scoreUtils'

const isNodeSelectionLike = (selection: unknown) => {
  if (!selection || typeof selection !== 'object') return false
  const candidate = selection as { constructor?: { name?: unknown } }
  return candidate.constructor?.name === 'NodeSelection'
}

const getNotesFieldByTarget = (target: ScoreAttrs['selectedTarget']) => {
  if (target === 'lower') return 'lowerNotes' as const
  if (target === 'upper') return 'upperNotes' as const
  if (target === 'single2') return 'singleNotes2' as const
  if (target === 'single3') return 'singleNotes3' as const
  if (target === 'single4') return 'singleNotes4' as const
  if (target === 'single') return 'notes' as const
  return null
}

const ScoreExtension = Node.create({
  name: 'score',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      timeSig: {
        default: defaultScoreAttrs.timeSig,
        parseHTML: (element) => element.getAttribute('data-time-sig') ?? defaultScoreAttrs.timeSig,
        renderHTML: (attributes) => ({ 'data-time-sig': attributes.timeSig }),
      },
      keySig: {
        default: defaultScoreAttrs.keySig,
        parseHTML: (element) => element.getAttribute('data-key-sig') ?? defaultScoreAttrs.keySig,
        renderHTML: (attributes) => ({ 'data-key-sig': attributes.keySig }),
      },
      staff: {
        default: defaultScoreAttrs.staff,
        parseHTML: (element) => element.getAttribute('data-staff') ?? defaultScoreAttrs.staff,
        renderHTML: (attributes) => ({ 'data-staff': attributes.staff }),
      },
      singleClef: {
        default: defaultScoreAttrs.singleClef,
        parseHTML: (element) => element.getAttribute('data-single-clef') ?? defaultScoreAttrs.singleClef,
        renderHTML: (attributes) => ({ 'data-single-clef': attributes.singleClef }),
      },
      singleClef2: {
        default: defaultScoreAttrs.singleClef2,
        parseHTML: (element) => element.getAttribute('data-single-clef-2') ?? defaultScoreAttrs.singleClef2,
        renderHTML: (attributes) => ({ 'data-single-clef-2': attributes.singleClef2 }),
      },
      singleClef3: {
        default: defaultScoreAttrs.singleClef3,
        parseHTML: (element) => element.getAttribute('data-single-clef-3') ?? defaultScoreAttrs.singleClef3,
        renderHTML: (attributes) => ({ 'data-single-clef-3': attributes.singleClef3 }),
      },
      singleClef4: {
        default: defaultScoreAttrs.singleClef4,
        parseHTML: (element) => element.getAttribute('data-single-clef-4') ?? defaultScoreAttrs.singleClef4,
        renderHTML: (attributes) => ({ 'data-single-clef-4': attributes.singleClef4 }),
      },
      upperClef: {
        default: defaultScoreAttrs.upperClef,
        parseHTML: (element) => element.getAttribute('data-upper-clef') ?? defaultScoreAttrs.upperClef,
        renderHTML: (attributes) => ({ 'data-upper-clef': attributes.upperClef }),
      },
      lowerClef: {
        default: defaultScoreAttrs.lowerClef,
        parseHTML: (element) => element.getAttribute('data-lower-clef') ?? defaultScoreAttrs.lowerClef,
        renderHTML: (attributes) => ({ 'data-lower-clef': attributes.lowerClef }),
      },
      singleStaffCount: {
        default: defaultScoreAttrs.singleStaffCount,
        parseHTML: (element) => {
          const raw = Number(element.getAttribute('data-single-staff-count'))
          if (!Number.isFinite(raw)) return defaultScoreAttrs.singleStaffCount
          return Math.max(1, Math.min(4, Math.floor(raw)))
        },
        renderHTML: (attributes) => ({ 'data-single-staff-count': attributes.singleStaffCount }),
      },
      notes: {
        default: defaultScoreAttrs.notes,
        parseHTML: (element) => element.getAttribute('data-notes') ?? defaultScoreAttrs.notes,
        renderHTML: (attributes) => ({ 'data-notes': attributes.notes }),
      },
      singleNotes2: {
        default: defaultScoreAttrs.singleNotes2,
        parseHTML: (element) => element.getAttribute('data-single-notes-2') ?? defaultScoreAttrs.singleNotes2,
        renderHTML: (attributes) => ({ 'data-single-notes-2': attributes.singleNotes2 }),
      },
      singleNotes3: {
        default: defaultScoreAttrs.singleNotes3,
        parseHTML: (element) => element.getAttribute('data-single-notes-3') ?? defaultScoreAttrs.singleNotes3,
        renderHTML: (attributes) => ({ 'data-single-notes-3': attributes.singleNotes3 }),
      },
      singleNotes4: {
        default: defaultScoreAttrs.singleNotes4,
        parseHTML: (element) => element.getAttribute('data-single-notes-4') ?? defaultScoreAttrs.singleNotes4,
        renderHTML: (attributes) => ({ 'data-single-notes-4': attributes.singleNotes4 }),
      },
      upperNotes: {
        default: defaultScoreAttrs.upperNotes,
        parseHTML: (element) => element.getAttribute('data-upper-notes') ?? defaultScoreAttrs.upperNotes,
        renderHTML: (attributes) => ({ 'data-upper-notes': attributes.upperNotes }),
      },
      lowerNotes: {
        default: defaultScoreAttrs.lowerNotes,
        parseHTML: (element) => element.getAttribute('data-lower-notes') ?? defaultScoreAttrs.lowerNotes,
        renderHTML: (attributes) => ({ 'data-lower-notes': attributes.lowerNotes }),
      },
      inputDuration: {
        default: defaultScoreAttrs.inputDuration,
        parseHTML: (element) => element.getAttribute('data-input-duration') ?? defaultScoreAttrs.inputDuration,
        renderHTML: (attributes) => ({ 'data-input-duration': attributes.inputDuration }),
      },
      inputDots: {
        default: defaultScoreAttrs.inputDots,
        parseHTML: (element) => {
          const raw = Number(element.getAttribute('data-input-dots'))
          return Number.isFinite(raw) && raw >= 0 && raw <= 2 ? raw : defaultScoreAttrs.inputDots
        },
        renderHTML: (attributes) => ({ 'data-input-dots': attributes.inputDots }),
      },
      inputTuplet: {
        default: defaultScoreAttrs.inputTuplet,
        parseHTML: (element) => element.getAttribute('data-input-tuplet') === 'true',
        renderHTML: (attributes) => ({ 'data-input-tuplet': String(Boolean(attributes.inputTuplet)) }),
      },
      inputMode: {
        default: defaultScoreAttrs.inputMode,
        parseHTML: (element) => element.getAttribute('data-input-mode') ?? defaultScoreAttrs.inputMode,
        renderHTML: (attributes) => ({ 'data-input-mode': attributes.inputMode }),
      },
      inputAccidental: {
        default: defaultScoreAttrs.inputAccidental,
        parseHTML: (element) => element.getAttribute('data-input-accidental') ?? defaultScoreAttrs.inputAccidental,
        renderHTML: (attributes) => ({ 'data-input-accidental': attributes.inputAccidental }),
      },
      selectedTarget: {
        default: defaultScoreAttrs.selectedTarget,
        parseHTML: (element) => element.getAttribute('data-selected-target') ?? defaultScoreAttrs.selectedTarget,
        renderHTML: (attributes) => ({ 'data-selected-target': attributes.selectedTarget }),
      },
      selectedIndex: {
        default: defaultScoreAttrs.selectedIndex,
        parseHTML: (element) => {
          const raw = Number(element.getAttribute('data-selected-index'))
          return Number.isFinite(raw) ? raw : defaultScoreAttrs.selectedIndex
        },
        renderHTML: (attributes) => ({ 'data-selected-index': attributes.selectedIndex }),
      },
      selectedIndices: {
        default: defaultScoreAttrs.selectedIndices,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-selected-indices')
          if (!raw) return defaultScoreAttrs.selectedIndices
          try {
            const parsed = JSON.parse(raw)
            if (!Array.isArray(parsed)) return defaultScoreAttrs.selectedIndices
            return parsed
              .map((v) => Number(v))
              .filter((v) => Number.isInteger(v) && v >= 0)
          } catch {
            return defaultScoreAttrs.selectedIndices
          }
        },
        renderHTML: (attributes) => ({
          'data-selected-indices': JSON.stringify(Array.isArray(attributes.selectedIndices) ? attributes.selectedIndices : []),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="score"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'score' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ScoreNodeView)
  },

  addKeyboardShortcuts() {
    const handleDeleteSelectedNotes = () => {
      const { editor } = this
      const { selection, doc } = editor.state

      let nodePos = -1
      let attrs: ScoreAttrs | null = null

      if (isNodeSelectionLike(selection) && selection.node.type.name === this.name) {
        nodePos = selection.from
        attrs = selection.node.attrs as ScoreAttrs
      } else {
        doc.descendants((node, pos) => {
          if (node.type.name !== this.name) return true
          const candidate = node.attrs as ScoreAttrs
          const hasSelectedNotes = Boolean(
            candidate.selectedTarget
            && (
              (Array.isArray(candidate.selectedIndices) && candidate.selectedIndices.length > 0)
              || (Number.isInteger(candidate.selectedIndex) && candidate.selectedIndex >= 0)
            ),
          )
          if (!hasSelectedNotes) return true
          nodePos = pos
          attrs = candidate
          return false
        })
      }

      if (!attrs || nodePos < 0) return false

      const field = getNotesFieldByTarget(attrs.selectedTarget)
      if (!field) return true

      const selectedIndices = (Array.isArray(attrs.selectedIndices) && attrs.selectedIndices.length > 0
        ? attrs.selectedIndices
        : (Number.isInteger(attrs.selectedIndex) && attrs.selectedIndex >= 0 ? [attrs.selectedIndex] : []))
        .filter((idx) => Number.isInteger(idx) && idx >= 0)
      if (selectedIndices.length === 0) return true

      const tokens = String(attrs[field] ?? '').trim()
        ? String(attrs[field]).trim().split(/\s+/)
        : []
      const deleteIndices = Array.from(new Set(selectedIndices))
        .filter((idx) => idx < tokens.length)
        .sort((a, b) => b - a)
      if (deleteIndices.length === 0) return true

      deleteIndices.forEach((idx) => {
        tokens.splice(idx, 1)
      })

      const nextAttrs: ScoreAttrs = {
        ...attrs,
        [field]: tokens.join(' '),
        selectedTarget: '',
        selectedIndex: -1,
        selectedIndices: [],
      }

      return editor.commands.command(({ tr, state, dispatch }) => {
        const currentNode = state.doc.nodeAt(nodePos)
        if (!currentNode) return false
        tr.setNodeMarkup(nodePos, undefined, nextAttrs)
        tr.setSelection(NodeSelection.create(tr.doc, nodePos))
        if (dispatch) dispatch(tr)
        return true
      })
    }

    return {
      Delete: handleDeleteSelectedNotes,
      Backspace: handleDeleteSelectedNotes,
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\/score$/,
        handler: ({ range, commands }) => {
          commands.insertContentAt(
            { from: range.from, to: range.to },
            { type: this.name, attrs: defaultScoreAttrs },
            { updateSelection: false },
          )
        },
      }),
    ]
  },
})

export default ScoreExtension
