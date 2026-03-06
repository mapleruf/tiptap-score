import { Accidental, Beam, Dot, Formatter, Renderer, Stave, StaveConnector, StaveNote, StaveTie, Tuplet, Voice } from 'vexflow'

export type StaffType = 'single' | 'grand'
export type NoteClef = 'treble' | 'bass' | 'alto' | 'tenor'

export type ScoreAttrs = {
  timeSig: string
  keySig: string
  staff: StaffType
  singleClef: NoteClef
  singleClef2: NoteClef
  singleClef3: NoteClef
  singleClef4: NoteClef
  upperClef: NoteClef
  lowerClef: NoteClef
  singleStaffCount: 1 | 2 | 3 | 4
  notes: string
  singleNotes2: string
  singleNotes3: string
  singleNotes4: string
  upperNotes: string
  lowerNotes: string
  inputMode: 'note' | 'rest'
  inputDuration: string
  inputDots: 0 | 1 | 2
  inputTuplet: boolean
  inputAccidental: '' | '#' | 'b'
  selectedTarget: '' | 'single' | 'single2' | 'single3' | 'single4' | 'upper' | 'lower'
  selectedIndex: number
  selectedIndices: number[]
}

export type SelectedScoreNotes = {
  target: 'single' | 'single2' | 'single3' | 'single4' | 'upper' | 'lower'
  indices: number[]
}

const DEFAULT_TIME_SIG = '4/4'
const DEFAULT_KEY_SIG = 'C'
export const MAX_AUTO_MEASURES = 4

const WIDTH = 560
const STAFF_HEIGHT = 120
const STAFF_TOP_Y = 20
const DRAW_SCALE = 1
const HORIZONTAL_FILL = 0.98
const MIN_MEASURE_WIDTH = 180
const DENSE_MEASURE_PADDING = 22
const MIN_DISPLAY_ZOOM = 0.72
const ZOOM_BASE_MEASURE_WIDTH = MIN_MEASURE_WIDTH + 80
const KEY_SIG_ORDER = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'] as const

const durationTokens = new Set(['w', 'h', 'q', '8', '16', '32'])

export const parseTimeSig = (value: string) => {
  const match = value.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (!match) return { numBeats: 4, beatValue: 4 }
  const numBeats = Number(match[1])
  const beatValue = Number(match[2])
  if (!Number.isFinite(numBeats) || !Number.isFinite(beatValue)) {
    return { numBeats: 4, beatValue: 4 }
  }
  return { numBeats, beatValue }
}

const getKeySigAccidentalCount = (keySig: string) => {
  const index = KEY_SIG_ORDER.indexOf((keySig || 'C') as (typeof KEY_SIG_ORDER)[number])
  if (index < 0) return 0
  if (index <= 7) return index
  return index - 7
}

export const durationTokenToBeats = (duration: string, beatValue: number, dots = 0) => {
  const dotMultiplier = dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1
  return durationToWholeNote(duration) * beatValue * dotMultiplier
}

const isTripletDuration = (duration: string) => duration === 'q' || duration === '8' || duration === '16' || duration === '32'

export const durationTokenToBeatsWithTuplet = (
  duration: string,
  beatValue: number,
  dots = 0,
  tuplet = false,
) => {
  const base = durationTokenToBeats(duration, beatValue, dots)
  if (!tuplet) return base
  if (!isTripletDuration(duration)) return base
  return base * (2 / 3)
}

type ParsedNote = {
  note: StaveNote
  beats: number
  tieNext: boolean
  pitchKey: string | null
  staffPitch: string | null
  pitch: string
  accidental: string
  octave: string
  duration: string
  dotCount: number
  tuplet: boolean
}
const durationToWholeNote = (duration: string) => {
  switch (duration) {
    case 'w':
      return 1
    case 'h':
      return 0.5
    case 'q':
      return 0.25
    case '8':
      return 0.125
    case '16':
      return 0.0625
    case '32':
      return 0.03125
    default:
      return 0
  }
}

const restKeyByClef = (clef: NoteClef) => {
  if (clef === 'bass') return 'd/3'
  if (clef === 'alto') return 'c/4'
  if (clef === 'tenor') return 'a/3'
  return 'b/4'
}

const attachDots = (note: StaveNote, count: number) => {
  const dotCount = Math.max(0, Math.min(2, count))
  for (let i = 0; i < dotCount; i += 1) {
    Dot.buildAndAttach([note], { all: true })
  }
}

const parseNoteToken = (token: string, beatValue: number, clef: NoteClef): ParsedNote | null => {
  const match = token.match(/^([a-gA-G]|r)([#b]?)(\d)?\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
  if (!match) return null
  const pitch = match[1].toLowerCase()
  const accidental = match[2]
  const octave = match[3]
  const duration = match[4]
  const tuplet = match[5] === 't'
  const dotCount = match[6].length
  const tieNext = match[7] === '~'

  if (!durationTokens.has(duration)) return null
  const beats = durationTokenToBeatsWithTuplet(duration, beatValue, dotCount, tuplet)
  if (!beats) return null

  if (pitch === 'r') {
    const restDuration = `${duration}r`
    const note = new StaveNote({ keys: [restKeyByClef(clef)], duration: restDuration, clef })
    attachDots(note, dotCount)
    return {
      note,
      beats,
      tieNext: false,
      pitchKey: null,
      staffPitch: null,
      pitch,
      accidental,
      octave: '',
      duration,
      dotCount,
      tuplet,
    }
  }

  if (!octave) return null

  const key = `${pitch}${accidental}/${octave}`
  const note = new StaveNote({ keys: [key], duration, clef })
  attachDots(note, dotCount)
  if (accidental) {
    note.addAccidental(0, new Accidental(accidental))
  }

  return {
    note,
    beats,
    tieNext,
    pitchKey: `${pitch}${accidental}/${octave}`,
    staffPitch: `${pitch}${octave}`,
    pitch,
    accidental,
    octave,
    duration,
    dotCount,
    tuplet,
  }
}

const splitBeatsToDurations = (beats: number, beatValue: number) => {
  const defs = [
    { token: 'w', quarterBeats: 4 },
    { token: 'h', quarterBeats: 2 },
    { token: 'q', quarterBeats: 1 },
    { token: '8', quarterBeats: 0.5 },
    { token: '16', quarterBeats: 0.25 },
    { token: '32', quarterBeats: 0.125 },
  ] as const
  const candidates = defs.flatMap((def) => ([0, 1, 2] as const).map((dots) => {
    const dotMultiplier = dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1
    return {
      token: def.token,
      dots,
      beats: def.quarterBeats * (4 / beatValue) * dotMultiplier,
    }
  })).sort((a, b) => b.beats - a.beats)

  const parts: Array<{ token: string, dots: number, beats: number, tuplet: boolean }> = []
  let remaining = beats
  while (remaining > 0.0001) {
    const found = candidates.find((c) => c.beats <= remaining + 0.0001)
    if (!found) break
    parts.push({ ...found, tuplet: false })
    remaining -= found.beats
  }
  return parts
}

const parseNotes = (value: string, beatValue: number, _numBeats: number, clef: NoteClef) => {
  const tokens = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  const notes: StaveNote[] = []
  const errors: string[] = []
  const beatStarts: number[] = []
  const noteBeats: number[] = []
  const tiesNext: boolean[] = []
  const pitchKeys: Array<string | null> = []
  const staffPitches: Array<string | null> = []
  const sourceTokenIndices: number[] = []
  const tuplets: boolean[] = []
  let totalBeats = 0

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]
    const parsed = parseNoteToken(token, beatValue, clef)
    if (!parsed) {
      errors.push(`Invalid token: ${token}`)
      continue
    }

    let remainingTokenBeats = parsed.beats
    while (remainingTokenBeats > 0.0001) {
      const beatInMeasure = ((totalBeats % _numBeats) + _numBeats) % _numBeats
      const remainInMeasure = beatInMeasure === 0 ? _numBeats : _numBeats - beatInMeasure
      const chunkBeats = Math.min(remainingTokenBeats, remainInMeasure)
      const canUseOriginalToken =
        Math.abs(remainingTokenBeats - parsed.beats) <= 0.0001
        && Math.abs(chunkBeats - parsed.beats) <= 0.0001
      const parts = canUseOriginalToken
        ? [{ token: parsed.duration, dots: parsed.dotCount, beats: parsed.beats, tuplet: parsed.tuplet }]
        : splitBeatsToDurations(chunkBeats, beatValue)
      if (parts.length === 0) break

      for (const part of parts) {
        const predictedRemaining = remainingTokenBeats - part.beats
        const isLastPartOfToken = predictedRemaining <= 0.0001
        const tieNext = parsed.pitch === 'r'
          ? false
          : (!isLastPartOfToken || parsed.tieNext)
        const tupletMark = part.tuplet ? 't' : ''
        const partToken = parsed.pitch === 'r'
          ? `r/${part.token}${tupletMark}${'.'.repeat(part.dots)}`
          : `${parsed.pitch}${parsed.accidental}${parsed.octave}/${part.token}${tupletMark}${'.'.repeat(part.dots)}${tieNext ? '~' : ''}`
        const parsedPart = parseNoteToken(partToken, beatValue, clef)
        if (!parsedPart) continue
        beatStarts.push(totalBeats)
        noteBeats.push(parsedPart.beats)
        tiesNext.push(parsedPart.tieNext)
        pitchKeys.push(parsedPart.pitchKey)
        staffPitches.push(parsedPart.staffPitch)
        sourceTokenIndices.push(tokenIndex)
        tuplets.push(parsedPart.tuplet)
        notes.push(parsedPart.note)
        totalBeats += parsedPart.beats
        remainingTokenBeats -= parsedPart.beats
      }
    }
  }

  return {
    notes,
    errors,
    beatStarts,
    noteBeats,
    totalBeats,
    tiesNext,
    pitchKeys,
    staffPitches,
    sourceTokenIndices,
    tuplets,
  }
}

const buildVoice = (notes: StaveNote[], numBeats: number, beatValue: number) => {
  const voice = new Voice({ num_beats: numBeats, beat_value: beatValue })
  voice.setStrict(false)
  voice.addTickables(notes)
  return voice
}

const drawMeasureLines = (
  context: ReturnType<Renderer['getContext']>,
  stave: Stave,
  measureBoundaries: number[],
) => {
  if (measureBoundaries.length <= 2) return
  const topY = stave.getYForLine(0)
  const bottomY = stave.getYForLine(4)
  for (let i = 1; i < measureBoundaries.length - 1; i += 1) {
    const x = measureBoundaries[i]
    context.beginPath()
    context.moveTo(x, topY)
    context.lineTo(x, bottomY)
    context.stroke()
  }
}

const getMeasureBoundaries = (stave: Stave, totalMeasures: number) => {
  const startX = stave.getNoteStartX()
  const endX = stave.getNoteEndX()
  const width = endX - startX
  if (totalMeasures <= 1 || width <= 0) return [Math.round(startX), Math.round(endX)]

  const boundaries: number[] = [Math.round(startX)]
  for (let i = 1; i < totalMeasures; i += 1) {
    boundaries.push(Math.round(startX + (i / totalMeasures) * width))
  }
  boundaries.push(Math.round(endX))
  return boundaries
}

const getRequiredMeasureWidth = (
  groupedNotes: StaveNote[][],
  groupedBeats: number[],
  beatsPerMeasure: number,
  beatValue: number,
  clef: NoteClef,
) => {
  let required = MIN_MEASURE_WIDTH
  groupedNotes.forEach((measureNotes, idx) => {
    const tickables: StaveNote[] = [...measureNotes]
    let remainingBeats = Math.max(0, beatsPerMeasure - (groupedBeats[idx] ?? 0))
    const fillDurations = ['w', 'h', 'q', '8', '16', '32'] as const
    while (remainingBeats > 0.0001) {
      let picked: string | null = null
      for (const duration of fillDurations) {
        const beats = durationTokenToBeats(duration, beatValue)
        if (beats <= remainingBeats + 0.0001) {
          picked = duration
          break
        }
      }
      if (!picked) break
      const rest = new StaveNote({ keys: [restKeyByClef(clef)], duration: `${picked}r`, clef })
      tickables.push(rest)
      remainingBeats -= durationTokenToBeats(picked, beatValue)
    }
    if (tickables.length === 0) return
    const voice = buildVoice(tickables, beatsPerMeasure, beatValue)
    const formatter = new Formatter()
    formatter.joinVoices([voice])
    let minWidth = MIN_MEASURE_WIDTH
    try {
      minWidth = Math.ceil(formatter.preCalculateMinTotalWidth([voice]))
    } catch {
      minWidth = MIN_MEASURE_WIDTH
    }
    required = Math.max(required, minWidth + DENSE_MEASURE_PADDING)
  })
  return required
}

const groupNotesByMeasure = (
  notes: StaveNote[],
  beatStarts: number[],
  noteBeats: number[],
  sourceTokenIndices: number[] = [],
  tuplets: boolean[] = [],
  beatsPerMeasure: number,
  totalMeasures: number,
) => {
  const grouped = Array.from({ length: totalMeasures }, () => [] as StaveNote[])
  const groupedBeats = Array.from({ length: totalMeasures }, () => 0)
  const groupedSourceTokenIndices = Array.from({ length: totalMeasures }, () => [] as number[])
  const groupedTuplets = Array.from({ length: totalMeasures }, () => [] as boolean[])
  notes.forEach((note, idx) => {
    const beat = beatStarts[idx] ?? 0
    const measureIndex = Math.max(0, Math.min(totalMeasures - 1, Math.floor(beat / beatsPerMeasure)))
    grouped[measureIndex].push(note)
    groupedBeats[measureIndex] += noteBeats[idx] ?? 0
    groupedSourceTokenIndices[measureIndex].push(sourceTokenIndices[idx] ?? idx)
    groupedTuplets[measureIndex].push(Boolean(tuplets[idx]))
  })
  return { grouped, groupedBeats, groupedSourceTokenIndices, groupedTuplets }
}

const drawMeasureVoices = (
  context: ReturnType<Renderer['getContext']>,
  stave: Stave,
  groupedNotes: StaveNote[][],
  groupedBeats: number[],
  groupedSourceTokenIndices: number[][],
  groupedTuplets: boolean[][],
  measureBoundaries: number[],
  beatsPerMeasure: number,
  beatValue: number,
  clef: NoteClef,
  selectedTokenIndices: number[] = [],
) => {
  const selectedSet = new Set(selectedTokenIndices)
  const isBeamable = (note: StaveNote) => {
    if (note.isRest()) return false
    const duration = note.getDuration()
    return duration === '8' || duration === '16' || duration === '32'
  }
  const buildBeams = (notes: StaveNote[], forceSingle = false) => {
    if (notes.length < 2) return [] as Beam[]
    if (forceSingle) return [new Beam(notes)]
    return Beam.generateBeams(notes, {
      maintain_stem_directions: false,
      beam_rests: false,
    })
  }

  const noteXs: number[] = []
  const noteYs: number[] = []
  const noteStartX = stave.getNoteStartX()
  const noteEndX = stave.getNoteEndX()
  const noteWidth = noteEndX - noteStartX
  const totalMeasures = groupedNotes.length
  if (totalMeasures <= 0 || noteWidth <= 0) return { noteXs, noteYs }

  groupedNotes.forEach((measureNotes, idx) => {
    if (measureNotes.length === 0) return
    measureNotes.forEach((note, localIdx) => {
      const sourceTokenIndex = groupedSourceTokenIndices[idx]?.[localIdx]
      if (sourceTokenIndex != null && selectedSet.has(sourceTokenIndex)) {
        note.setStyle({ fillStyle: '#2563eb', strokeStyle: '#2563eb' })
      }
    })
    const startX = measureBoundaries[idx] ?? Math.round(noteStartX + (idx / totalMeasures) * noteWidth)
    const endX = measureBoundaries[idx + 1] ?? Math.round(noteStartX + ((idx + 1) / totalMeasures) * noteWidth)
    const measureStave = new Stave(startX, stave.getY(), endX - startX)
    measureStave.setContext(context)
    measureStave.setNoteStartX(startX)
    const tickables: StaveNote[] = [...measureNotes]
    let remainingBeats = Math.max(0, beatsPerMeasure - (groupedBeats[idx] ?? 0))
    const fillDurations = ['w', 'h', 'q', '8', '16', '32'] as const
    while (remainingBeats > 0.0001) {
      let picked: string | null = null
      for (const duration of fillDurations) {
        const beats = durationTokenToBeats(duration, beatValue)
        if (beats <= remainingBeats + 0.0001) {
          picked = duration
          break
        }
      }
      if (!picked) break
      const rest = new StaveNote({ keys: [restKeyByClef(clef)], duration: `${picked}r`, clef })
      rest.setStyle({ fillStyle: 'transparent', strokeStyle: 'transparent' })
      tickables.push(rest)
      remainingBeats -= durationTokenToBeats(picked, beatValue)
    }

    const voice = buildVoice(tickables, beatsPerMeasure, beatValue)
    const formatWidth = Math.max(10, endX - measureStave.getNoteStartX())
    const formatter = new Formatter()
    formatter.joinVoices([voice])
    formatter.format([voice], formatWidth)
    const beams: Beam[] = []
    const tupletFlags = groupedTuplets[idx] ?? []

    let noteIdx = 0
    while (noteIdx < measureNotes.length) {
      const note = measureNotes[noteIdx]
      if (!isBeamable(note)) {
        noteIdx += 1
        continue
      }

      const isTuplet = Boolean(tupletFlags[noteIdx])
      const duration = note.getDuration()
      const run: StaveNote[] = []

      while (noteIdx < measureNotes.length) {
        const candidate = measureNotes[noteIdx]
        if (!isBeamable(candidate)) break
        if (Boolean(tupletFlags[noteIdx]) !== isTuplet) break
        if (candidate.getDuration() !== duration) break
        run.push(candidate)
        noteIdx += 1
      }

      if (isTuplet) {
        let i = 0
        for (; i + 2 < run.length; i += 3) {
          const group = run.slice(i, i + 3)
          beams.push(...buildBeams(group, true))
        }
        const remainder = run.slice(i)
        if (remainder.length >= 2) {
          beams.push(...buildBeams(remainder))
        }
      } else if (run.length >= 2) {
        if (run.length === 3) {
          beams.push(...buildBeams(run, true))
        } else if (run.length === 4) {
          beams.push(...buildBeams(run, true))
        } else {
          for (let i = 0; i < run.length; i += 4) {
            const chunk = run.slice(i, i + 4)
            if (chunk.length >= 2) {
              beams.push(...buildBeams(chunk, chunk.length <= 4))
            }
          }
        }
      }
    }
    voice.draw(context, measureStave)
    beams.forEach((beam) => {
      beam.setContext(context).draw()
    })
    let tupletStart = 0
    while (tupletStart < measureNotes.length) {
      if (!groupedTuplets[idx]?.[tupletStart]) {
        tupletStart += 1
        continue
      }
      const first = measureNotes[tupletStart]
      const duration = first.getDuration()
      const run: StaveNote[] = []
      while (
        tupletStart < measureNotes.length
        && groupedTuplets[idx]?.[tupletStart]
        && !measureNotes[tupletStart].isRest()
        && measureNotes[tupletStart].getDuration() === duration
      ) {
        run.push(measureNotes[tupletStart])
        tupletStart += 1
      }
      for (let i = 0; i + 2 < run.length; i += 3) {
        const group = run.slice(i, i + 3)
        const bracketed = !group.every((note) => isBeamable(note))
        const tuplet = new Tuplet(group, {
          num_notes: 3,
          notes_occupied: 2,
          bracketed,
          ratioed: false,
        })
        tuplet.setContext(context).draw()
      }
    }
    measureNotes.forEach((note) => {
      noteXs.push(note.getAbsoluteX())
      const ys = note.getYs()
      noteYs.push(Array.isArray(ys) && ys.length > 0 ? ys[0] : stave.getYForLine(2))
    })
  })
  return { noteXs, noteYs }
}

const drawTies = (
  context: ReturnType<Renderer['getContext']>,
  notes: StaveNote[],
  tiesNext: boolean[],
  pitchKeys: Array<string | null>,
) => {
  for (let i = 0; i < notes.length - 1; i += 1) {
    if (!tiesNext[i]) continue
    if (!pitchKeys[i] || !pitchKeys[i + 1]) continue
    if (pitchKeys[i] !== pitchKeys[i + 1]) continue
    const tie = new StaveTie({
      firstNote: notes[i],
      lastNote: notes[i + 1],
      firstIndexes: [0],
      lastIndexes: [0],
    })
    tie.setContext(context).draw()
  }
}

export const renderScoreSvg = (
  container: HTMLElement,
  attrs: ScoreAttrs,
  selectedNotes: SelectedScoreNotes | null = null,
): { errors: string[] } => {
  const errors: string[] = []
  const parentWidth = Math.floor(container.parentElement?.clientWidth || 0)
  const rootWidth = Math.floor(container.closest('.ProseMirror')?.clientWidth || 0)
  const liveMeasuredWidth = Math.max(container.clientWidth, parentWidth, rootWidth, WIDTH)
  const measuredWidth = Math.max(320, liveMeasuredWidth)
  const initialWidth = Number(container.dataset.initialRenderWidth || 0)
  const availableWidth = initialWidth > 0 ? Math.max(initialWidth, measuredWidth) : measuredWidth
  container.dataset.initialRenderWidth = String(availableWidth)

  container.innerHTML = ''
  const safeWidth = Math.max(320, availableWidth - 12)
  const viewportWidth = Math.max(280, Math.floor(safeWidth * HORIZONTAL_FILL))
  const scaledStaffHeight = Math.max(80, Math.floor(STAFF_HEIGHT * DRAW_SCALE))
  const scaledTopY = Math.max(12, Math.floor(STAFF_TOP_Y * DRAW_SCALE))
  const scaledPadding = Math.max(6, Math.floor(8 * DRAW_SCALE))
  const scaledTailPadding = Math.max(20, Math.floor(40 * DRAW_SCALE))
  const leftInset = attrs.staff === 'grand'
    ? Math.max(16, scaledPadding * 2)
    : scaledPadding
  const { numBeats, beatValue } = parseTimeSig(attrs.timeSig || DEFAULT_TIME_SIG)

  const singleStaffCount = attrs.staff === 'single'
    ? Math.max(1, Math.min(4, Number(attrs.singleStaffCount || 1)))
    : 1
  const singleStaffSources = [attrs.notes, attrs.singleNotes2, attrs.singleNotes3, attrs.singleNotes4]
  const singleStaffClefs: NoteClef[] = [attrs.singleClef, attrs.singleClef2, attrs.singleClef3, attrs.singleClef4]
  const singleParsedList = attrs.staff === 'single'
    ? Array.from({ length: singleStaffCount }, (_, i) => parseNotes(singleStaffSources[i] || '', beatValue, numBeats, singleStaffClefs[i] || attrs.singleClef))
    : []
  const upperParsed = attrs.staff === 'grand'
    ? parseNotes(attrs.upperNotes, beatValue, numBeats, attrs.upperClef)
    : null
  const lowerParsed = attrs.staff === 'grand'
    ? parseNotes(attrs.lowerNotes, beatValue, numBeats, attrs.lowerClef)
    : null

  singleParsedList.forEach((parsed) => errors.push(...parsed.errors))
  if (upperParsed) {
    errors.push(...upperParsed.errors)
  }
  if (lowerParsed) {
    errors.push(...lowerParsed.errors)
  }

  const activeMeasures = attrs.staff === 'grand'
    ? Math.max(1, Math.ceil(Math.max(upperParsed?.totalBeats ?? 0, lowerParsed?.totalBeats ?? 0) / numBeats))
    : Math.max(1, ...singleParsedList.map((parsed) => Math.ceil((parsed.totalBeats ?? 0) / numBeats)))

  let requiredMeasureWidth = MIN_MEASURE_WIDTH
  singleParsedList.forEach((parsed, idx) => {
    const totalMeasures = Math.max(1, Math.ceil(parsed.totalBeats / numBeats))
    const { grouped, groupedBeats } = groupNotesByMeasure(
      parsed.notes,
      parsed.beatStarts,
      parsed.noteBeats,
      parsed.sourceTokenIndices,
      parsed.tuplets,
      numBeats,
      totalMeasures,
    )
      requiredMeasureWidth = Math.max(
        requiredMeasureWidth,
      getRequiredMeasureWidth(grouped, groupedBeats, numBeats, beatValue, singleStaffClefs[idx] || attrs.singleClef),
    )
  })
  if (upperParsed && lowerParsed) {
    const totalMeasures = Math.max(1, Math.ceil(Math.max(upperParsed.totalBeats, lowerParsed.totalBeats) / numBeats))
    const { grouped: upperGrouped, groupedBeats: upperGroupedBeats } = groupNotesByMeasure(
      upperParsed.notes,
      upperParsed.beatStarts,
      upperParsed.noteBeats,
      upperParsed.sourceTokenIndices,
      upperParsed.tuplets,
      numBeats,
      totalMeasures,
    )
    const { grouped: lowerGrouped, groupedBeats: lowerGroupedBeats } = groupNotesByMeasure(
      lowerParsed.notes,
      lowerParsed.beatStarts,
      lowerParsed.noteBeats,
      lowerParsed.sourceTokenIndices,
      lowerParsed.tuplets,
      numBeats,
      totalMeasures,
    )
    requiredMeasureWidth = Math.max(
      requiredMeasureWidth,
      getRequiredMeasureWidth(upperGrouped, upperGroupedBeats, numBeats, beatValue, attrs.upperClef),
      getRequiredMeasureWidth(lowerGrouped, lowerGroupedBeats, numBeats, beatValue, attrs.lowerClef),
    )
  }

  const requiredStaveWidth = Math.max(120, activeMeasures * requiredMeasureWidth)

  const baseStaveWidth = Math.max(120, viewportWidth - leftInset - scaledPadding)
  const staveWidth = Math.max(baseStaveWidth, requiredStaveWidth)
  const scaledWidth = Math.max(280, Math.ceil(staveWidth + leftInset + scaledPadding))
  const zoomBaseStaveWidth = Math.max(120, MAX_AUTO_MEASURES * ZOOM_BASE_MEASURE_WIDTH)
  const zoomBaseScaledWidth = Math.max(280, Math.ceil(zoomBaseStaveWidth + leftInset + scaledPadding))
  const targetZoom = Math.max(MIN_DISPLAY_ZOOM, Math.min(1, viewportWidth / zoomBaseScaledWidth))
  const zoomKey = `${attrs.timeSig}`
  const prevZoom = Number(container.dataset.fixedZoom || 0)
  const prevZoomKey = container.dataset.zoomKey || ''
  const displayZoom = prevZoom > 0 && prevZoomKey === zoomKey ? prevZoom : targetZoom
  container.dataset.fixedZoom = String(displayZoom)
  container.dataset.zoomKey = zoomKey
  container.style.setProperty('--score-zoom', String(displayZoom))

  const renderer = new Renderer(container, Renderer.Backends.SVG)
  const height = attrs.staff === 'grand'
    ? scaledStaffHeight * 2 + scaledTailPadding
    : scaledStaffHeight * singleStaffCount + scaledTailPadding
  renderer.resize(scaledWidth, height)
  const context = renderer.getContext()
  const stave = new Stave(leftInset, scaledTopY, staveWidth)
  stave.addClef(attrs.staff === 'single' ? attrs.singleClef : attrs.upperClef)
  stave.addKeySignature(attrs.keySig || DEFAULT_KEY_SIG)
  stave.addTimeSignature(attrs.timeSig || DEFAULT_TIME_SIG)
  if (attrs.staff === 'grand') {
    const lowerY = scaledTopY + scaledStaffHeight
    const lowerStave = new Stave(leftInset, lowerY, staveWidth)
    lowerStave.addClef(attrs.lowerClef)
    lowerStave.addKeySignature(attrs.keySig || DEFAULT_KEY_SIG)
    lowerStave.addTimeSignature(attrs.timeSig || DEFAULT_TIME_SIG)
    Stave.formatBegModifiers([stave, lowerStave])
    stave.setContext(context).draw()
    lowerStave.setContext(context).draw()

    container.dataset.staffTopY = String(stave.getYForLine(0))
    container.dataset.staffLineSpacing = String(stave.getSpacingBetweenLines())
    container.dataset.lowerStaffTopY = String(lowerStave.getYForLine(0))
    container.dataset.lowerStaffLineSpacing = String(lowerStave.getSpacingBetweenLines())

    const connector = new StaveConnector(stave, lowerStave)
    connector.setType(StaveConnector.type.BRACE)
    connector.setContext(context).draw()

    const line = new StaveConnector(stave, lowerStave)
    line.setType(StaveConnector.type.SINGLE)
    line.setContext(context).draw()

    const upperNotes = upperParsed?.notes ?? []
    const upperBeatStarts = upperParsed?.beatStarts ?? []
    const upperNoteBeats = upperParsed?.noteBeats ?? []
    const upperTiesNext = upperParsed?.tiesNext ?? []
    const upperPitchKeys = upperParsed?.pitchKeys ?? []
    const upperTotalBeats = upperParsed?.totalBeats ?? 0
    const lowerNotes = lowerParsed?.notes ?? []
    const lowerBeatStarts = lowerParsed?.beatStarts ?? []
    const lowerNoteBeats = lowerParsed?.noteBeats ?? []
    const lowerTiesNext = lowerParsed?.tiesNext ?? []
    const lowerPitchKeys = lowerParsed?.pitchKeys ?? []
    const lowerTotalBeats = lowerParsed?.totalBeats ?? 0
    container.dataset.upperBeatStarts = JSON.stringify(upperBeatStarts)
    container.dataset.upperTotalBeats = String(upperTotalBeats)
    container.dataset.lowerBeatStarts = JSON.stringify(lowerBeatStarts)
    container.dataset.lowerTotalBeats = String(lowerTotalBeats)
    container.dataset.upperNoteTokenMap = JSON.stringify(upperParsed?.sourceTokenIndices ?? [])
    container.dataset.lowerNoteTokenMap = JSON.stringify(lowerParsed?.sourceTokenIndices ?? [])
    container.dataset.upperRenderedPitches = JSON.stringify(upperParsed?.staffPitches ?? [])
    container.dataset.lowerRenderedPitches = JSON.stringify(lowerParsed?.staffPitches ?? [])

    const grandTotalBeats = Math.max(upperTotalBeats, lowerTotalBeats)
    const totalMeasures = Math.max(1, Math.ceil(grandTotalBeats / numBeats))
    const measureBoundaries = getMeasureBoundaries(stave, totalMeasures)
    drawMeasureLines(context, stave, measureBoundaries)
    drawMeasureLines(context, lowerStave, measureBoundaries)
    const {
      grouped: upperByMeasure,
      groupedBeats: upperBeatsByMeasure,
      groupedSourceTokenIndices: upperTokenMapByMeasure,
      groupedTuplets: upperTupletsByMeasure,
    } = groupNotesByMeasure(
      upperNotes,
      upperBeatStarts,
      upperNoteBeats,
      upperParsed?.sourceTokenIndices ?? [],
      upperParsed?.tuplets ?? [],
      numBeats,
      totalMeasures,
    )
    const {
      grouped: lowerByMeasure,
      groupedBeats: lowerBeatsByMeasure,
      groupedSourceTokenIndices: lowerTokenMapByMeasure,
      groupedTuplets: lowerTupletsByMeasure,
    } = groupNotesByMeasure(
      lowerNotes,
      lowerBeatStarts,
      lowerNoteBeats,
      lowerParsed?.sourceTokenIndices ?? [],
      lowerParsed?.tuplets ?? [],
      numBeats,
      totalMeasures,
    )

    const { noteXs: upperNoteXs, noteYs: upperNoteYs } = drawMeasureVoices(
      context,
      stave,
      upperByMeasure,
      upperBeatsByMeasure,
      upperTokenMapByMeasure,
      upperTupletsByMeasure,
      measureBoundaries,
      numBeats,
      beatValue,
      attrs.upperClef,
      selectedNotes?.target === 'upper' ? selectedNotes.indices : [],
    )
    const { noteXs: lowerNoteXs, noteYs: lowerNoteYs } = drawMeasureVoices(
      context,
      lowerStave,
      lowerByMeasure,
      lowerBeatsByMeasure,
      lowerTokenMapByMeasure,
      lowerTupletsByMeasure,
      measureBoundaries,
      numBeats,
      beatValue,
      attrs.lowerClef,
      selectedNotes?.target === 'lower' ? selectedNotes.indices : [],
    )
    drawTies(context, upperNotes, upperTiesNext, upperPitchKeys)
    drawTies(context, lowerNotes, lowerTiesNext, lowerPitchKeys)

    container.dataset.upperNoteStartX = String(stave.getNoteStartX())
    container.dataset.upperNoteEndX = String(stave.getNoteEndX())
    container.dataset.lowerNoteStartX = String(lowerStave.getNoteStartX())
    container.dataset.lowerNoteEndX = String(lowerStave.getNoteEndX())
    container.dataset.upperNoteXs = JSON.stringify(upperNoteXs)
    container.dataset.lowerNoteXs = JSON.stringify(lowerNoteXs)
    container.dataset.upperNoteYs = JSON.stringify(upperNoteYs)
    container.dataset.lowerNoteYs = JSON.stringify(lowerNoteYs)
    container.dataset.upperMeasureBoundaries = JSON.stringify(measureBoundaries)
    container.dataset.lowerMeasureBoundaries = JSON.stringify(measureBoundaries)
    const keySigCount = getKeySigAccidentalCount(attrs.keySig || DEFAULT_KEY_SIG)
    const keySigX1 = leftInset + Math.round(28 * DRAW_SCALE)
    const keySigWidth = keySigCount === 0 ? Math.round(30 * DRAW_SCALE) : Math.round((20 + keySigCount * 10) * DRAW_SCALE)
    const keySigX2 = keySigX1 + keySigWidth
    const upperY1 = stave.getYForLine(0) - Math.round(12 * DRAW_SCALE)
    const upperY2 = stave.getYForLine(4) + Math.round(12 * DRAW_SCALE)
    const lowerY1 = lowerStave.getYForLine(0) - Math.round(12 * DRAW_SCALE)
    const lowerY2 = lowerStave.getYForLine(4) + Math.round(12 * DRAW_SCALE)
    container.dataset.upperKeySigHit = JSON.stringify({ x1: keySigX1, x2: keySigX2, y1: upperY1, y2: upperY2 })
    container.dataset.lowerKeySigHit = JSON.stringify({ x1: keySigX1, x2: keySigX2, y1: lowerY1, y2: lowerY2 })
    const clefX1 = leftInset - Math.round(6 * DRAW_SCALE)
    const clefX2 = leftInset + Math.round(34 * DRAW_SCALE)
    container.dataset.upperClefHit = JSON.stringify({ x1: clefX1, x2: clefX2, y1: upperY1, y2: upperY2 })
    container.dataset.lowerClefHit = JSON.stringify({ x1: clefX1, x2: clefX2, y1: lowerY1, y2: lowerY2 })
    container.dataset.singleClefHit = JSON.stringify({})
    container.dataset.single2ClefHit = JSON.stringify({})
    container.dataset.single3ClefHit = JSON.stringify({})
    container.dataset.single4ClefHit = JSON.stringify({})
  } else {
    const singleStaves = Array.from({ length: singleStaffCount }, (_, i) => {
      const staffY = scaledTopY + i * scaledStaffHeight
      const staff = new Stave(leftInset, staffY, staveWidth)
      staff.addClef(singleStaffClefs[i] || attrs.singleClef)
      staff.addKeySignature(attrs.keySig || DEFAULT_KEY_SIG)
      staff.addTimeSignature(attrs.timeSig || DEFAULT_TIME_SIG)
      staff.setContext(context).draw()
      return staff
    })

    const primaryStave = singleStaves[0]
    if (!primaryStave) return { errors }
    container.dataset.staffTopY = String(primaryStave.getYForLine(0))
    container.dataset.staffLineSpacing = String(primaryStave.getSpacingBetweenLines())
    container.dataset.singleStaffTopYs = JSON.stringify(singleStaves.map((staff) => staff.getYForLine(0)))
    container.dataset.singleStaffCount = String(singleStaffCount)

    const totalMeasures = Math.max(1, activeMeasures)
    const measureBoundaries = getMeasureBoundaries(primaryStave, totalMeasures)

    const targetNames = ['single', 'single2', 'single3', 'single4'] as const
    targetNames.forEach((name, idx) => {
      const parsed = idx < singleParsedList.length ? singleParsedList[idx] : null
      const staff = singleStaves[idx]
      if (!parsed || !staff) {
        container.dataset[`${name}BeatStarts`] = JSON.stringify([])
        container.dataset[`${name}TotalBeats`] = '0'
        container.dataset[`${name}NoteTokenMap`] = JSON.stringify([])
        container.dataset[`${name}RenderedPitches`] = JSON.stringify([])
        container.dataset[`${name}NoteStartX`] = '0'
        container.dataset[`${name}NoteEndX`] = '0'
        container.dataset[`${name}NoteXs`] = JSON.stringify([])
        container.dataset[`${name}NoteYs`] = JSON.stringify([])
        container.dataset[`${name}MeasureBoundaries`] = JSON.stringify([])
        return
      }

      drawMeasureLines(context, staff, measureBoundaries)
      const {
        grouped: notesByMeasure,
        groupedBeats: beatsByMeasure,
        groupedSourceTokenIndices: tokenMapByMeasure,
        groupedTuplets: tupletsByMeasure,
      } = groupNotesByMeasure(
        parsed.notes,
        parsed.beatStarts,
        parsed.noteBeats,
        parsed.sourceTokenIndices,
        parsed.tuplets,
        numBeats,
        totalMeasures,
      )
      const { noteXs, noteYs } = drawMeasureVoices(
        context,
        staff,
        notesByMeasure,
        beatsByMeasure,
        tokenMapByMeasure,
        tupletsByMeasure,
        measureBoundaries,
        numBeats,
        beatValue,
        singleStaffClefs[idx] || attrs.singleClef,
        selectedNotes?.target === name ? selectedNotes.indices : [],
      )
      drawTies(context, parsed.notes, parsed.tiesNext, parsed.pitchKeys)

      container.dataset[`${name}BeatStarts`] = JSON.stringify(parsed.beatStarts)
      container.dataset[`${name}TotalBeats`] = String(parsed.totalBeats)
      container.dataset[`${name}NoteTokenMap`] = JSON.stringify(parsed.sourceTokenIndices)
      container.dataset[`${name}RenderedPitches`] = JSON.stringify(parsed.staffPitches)
      container.dataset[`${name}NoteStartX`] = String(staff.getNoteStartX())
      container.dataset[`${name}NoteEndX`] = String(staff.getNoteEndX())
      container.dataset[`${name}NoteXs`] = JSON.stringify(noteXs)
      container.dataset[`${name}NoteYs`] = JSON.stringify(noteYs)
      container.dataset[`${name}MeasureBoundaries`] = JSON.stringify(measureBoundaries)
    })

    container.dataset.upperBeatStarts = container.dataset.singleBeatStarts || JSON.stringify([])
    container.dataset.upperTotalBeats = container.dataset.singleTotalBeats || '0'
    container.dataset.upperNoteTokenMap = container.dataset.singleNoteTokenMap || JSON.stringify([])
    container.dataset.upperRenderedPitches = container.dataset.singleRenderedPitches || JSON.stringify([])
    container.dataset.upperNoteStartX = container.dataset.singleNoteStartX || '0'
    container.dataset.upperNoteEndX = container.dataset.singleNoteEndX || '0'
    container.dataset.upperNoteXs = container.dataset.singleNoteXs || JSON.stringify([])
    container.dataset.upperNoteYs = container.dataset.singleNoteYs || JSON.stringify([])
    container.dataset.upperMeasureBoundaries = container.dataset.singleMeasureBoundaries || JSON.stringify([])
    container.dataset.lowerBeatStarts = JSON.stringify([])
    container.dataset.lowerTotalBeats = '0'
    container.dataset.lowerNoteTokenMap = JSON.stringify([])
    container.dataset.lowerRenderedPitches = JSON.stringify([])
    container.dataset.lowerNoteStartX = '0'
    container.dataset.lowerNoteEndX = '0'
    container.dataset.lowerNoteXs = JSON.stringify([])
    container.dataset.lowerNoteYs = JSON.stringify([])
    container.dataset.lowerMeasureBoundaries = JSON.stringify([])

    const keySigCount = getKeySigAccidentalCount(attrs.keySig || DEFAULT_KEY_SIG)
    const keySigX1 = leftInset + Math.round(28 * DRAW_SCALE)
    const keySigWidth = keySigCount === 0 ? Math.round(30 * DRAW_SCALE) : Math.round((20 + keySigCount * 10) * DRAW_SCALE)
    const keySigX2 = keySigX1 + keySigWidth
    const y1 = primaryStave.getYForLine(0) - Math.round(12 * DRAW_SCALE)
    const y2 = primaryStave.getYForLine(4) + Math.round(12 * DRAW_SCALE)
    container.dataset.upperKeySigHit = JSON.stringify({ x1: keySigX1, x2: keySigX2, y1, y2 })
    container.dataset.lowerKeySigHit = JSON.stringify({})
    const clefX1 = leftInset - Math.round(6 * DRAW_SCALE)
    const clefX2 = leftInset + Math.round(34 * DRAW_SCALE)
    container.dataset.upperClefHit = JSON.stringify({ x1: clefX1, x2: clefX2, y1, y2 })
    container.dataset.lowerClefHit = JSON.stringify({})
    const singleTargets = ['single', 'single2', 'single3', 'single4'] as const
    singleTargets.forEach((target, idx) => {
      const staff = singleStaves[idx]
      if (!staff) {
        container.dataset[`${target}ClefHit`] = JSON.stringify({})
        return
      }
      const hitY1 = staff.getYForLine(0) - Math.round(12 * DRAW_SCALE)
      const hitY2 = staff.getYForLine(4) + Math.round(12 * DRAW_SCALE)
      container.dataset[`${target}ClefHit`] = JSON.stringify({ x1: clefX1, x2: clefX2, y1: hitY1, y2: hitY2 })
    })
  }

  return { errors }
}

export const defaultScoreAttrs: ScoreAttrs = {
  timeSig: DEFAULT_TIME_SIG,
  keySig: DEFAULT_KEY_SIG,
  staff: 'single',
  singleClef: 'treble',
  singleClef2: 'treble',
  singleClef3: 'treble',
  singleClef4: 'treble',
  upperClef: 'treble',
  lowerClef: 'bass',
  singleStaffCount: 1,
  notes: '',
  singleNotes2: '',
  singleNotes3: '',
  singleNotes4: '',
  upperNotes: '',
  lowerNotes: '',
  inputMode: 'note',
  inputDuration: 'q',
  inputDots: 0,
  inputTuplet: false,
  inputAccidental: '',
  selectedTarget: '',
  selectedIndex: -1,
  selectedIndices: [],
}

const TREBLE_STAFF_STEPS = [
  'f5', 'e5', 'd5', 'c5', 'b4', 'a4', 'g4', 'f4', 'e4',
  'd4', 'c4', 'b3', 'a3', 'g3', 'f3',
]
const BASS_STAFF_STEPS = [
  'a3', 'g3', 'f3', 'e3', 'd3', 'c3', 'b2', 'a2', 'g2',
  'f2', 'e2', 'd2', 'c2', 'b1', 'a1',
]
const ALTO_STAFF_STEPS = [
  'g4', 'f4', 'e4', 'd4', 'c4', 'b3', 'a3', 'g3', 'f3',
  'e3', 'd3', 'c3', 'b2', 'a2', 'g2',
]
const TENOR_STAFF_STEPS = [
  'e4', 'd4', 'c4', 'b3', 'a3', 'g3', 'f3', 'e3', 'd3',
  'c3', 'b2', 'a2', 'g2', 'f2', 'e2',
]

const TREBLE_EXTENDED_STEPS = ['e6', 'd6', 'c6', 'b5', 'a5', 'g5', ...TREBLE_STAFF_STEPS]
const BASS_EXTENDED_STEPS = ['g4', 'f4', 'e4', 'd4', 'c4', 'b3', ...BASS_STAFF_STEPS]
const ALTO_EXTENDED_STEPS = ['f5', 'e5', 'd5', 'c5', 'b4', 'a4', ...ALTO_STAFF_STEPS]
const TENOR_EXTENDED_STEPS = ['d5', 'c5', 'b4', 'a4', 'g4', 'f4', ...TENOR_STAFF_STEPS]

const getStaffStepsByClef = (clef: NoteClef) => {
  if (clef === 'treble') return TREBLE_STAFF_STEPS
  if (clef === 'bass') return BASS_STAFF_STEPS
  if (clef === 'alto') return ALTO_STAFF_STEPS
  return TENOR_STAFF_STEPS
}

const getExtendedStepsByClef = (clef: NoteClef) => {
  if (clef === 'treble') return TREBLE_EXTENDED_STEPS
  if (clef === 'bass') return BASS_EXTENDED_STEPS
  if (clef === 'alto') return ALTO_EXTENDED_STEPS
  return TENOR_EXTENDED_STEPS
}

export const pitchFromY = (
  y: number,
  staffTopY: number,
  lineSpacing: number,
  clef: NoteClef,
) => {
  const step = lineSpacing / 2
  const steps = getStaffStepsByClef(clef)
  const rawIndex = Math.round((y - staffTopY) / step)
  const index = Math.max(0, Math.min(steps.length - 1, rawIndex))
  const pitch = steps[index]
  return pitch
}

export const yFromPitch = (
  pitch: string,
  staffTopY: number,
  lineSpacing: number,
  clef: NoteClef,
) => {
  const steps = getExtendedStepsByClef(clef)
  const index = steps.indexOf(pitch.toLowerCase())
  if (index < 0) return null
  return staffTopY + (lineSpacing / 2) * index
}

export const transposeTokenByStep = (
  token: string,
  deltaSteps: number,
  clef: NoteClef,
) => {
  const match = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/)
  if (!match) return token
  const letter = match[1].toLowerCase()
  const accidental = match[2]
  const octave = match[3]
  const duration = match[4]
  const tuplet = match[5] || ''
  const dots = match[6] || ''
  const tie = match[7] || ''
  const steps = getExtendedStepsByClef(clef)
  const currentPitch = `${letter}${octave}`
  const currentIdx = steps.indexOf(currentPitch)
  if (currentIdx < 0) return token
  const nextIdx = Math.max(0, Math.min(steps.length - 1, currentIdx - deltaSteps))
  const nextPitch = steps[nextIdx]
  const nextLetter = nextPitch[0]
  const nextOctave = nextPitch.slice(1)
  return `${nextLetter}${accidental}${nextOctave}/${duration}${tuplet}${dots}${tie}`
}

export const isYWithinStaff = (y: number, staffTopY: number, lineSpacing: number, extraSteps = 8) => {
  const staffBottomY = staffTopY + lineSpacing * 4
  const padding = Math.max(12, lineSpacing) + (lineSpacing / 2) * extraSteps
  return y >= staffTopY - padding && y <= staffBottomY + padding
}
