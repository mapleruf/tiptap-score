// src/ScoreExtension.ts
import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { NodeSelection as NodeSelection2 } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

// src/ScoreNodeView.tsx
import { NodeViewWrapper } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NodeSelection } from "@tiptap/pm/state";

// src/scoreUtils.ts
import { Accidental, Beam, Dot, Formatter, Renderer, Stave, StaveConnector, StaveNote, StaveTie, Tuplet, Voice } from "vexflow";
var DEFAULT_TIME_SIG = "4/4";
var DEFAULT_KEY_SIG = "C";
var MAX_AUTO_MEASURES = 4;
var WIDTH = 560;
var STAFF_HEIGHT = 120;
var STAFF_TOP_Y = 20;
var DRAW_SCALE = 1;
var HORIZONTAL_FILL = 0.98;
var MIN_MEASURE_WIDTH = 180;
var DENSE_MEASURE_PADDING = 22;
var MIN_DISPLAY_ZOOM = 0.72;
var ZOOM_BASE_MEASURE_WIDTH = MIN_MEASURE_WIDTH + 80;
var KEY_SIG_ORDER = ["C", "G", "D", "A", "E", "B", "F#", "C#", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"];
var durationTokens = /* @__PURE__ */ new Set(["w", "h", "q", "8", "16", "32"]);
var SUPPORTED_BEAT_VALUES = /* @__PURE__ */ new Set([1, 2, 4, 8, 16, 32]);
var parseSupportedTimeSig = (value) => {
  const match = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const numBeats = Number(match[1]);
  const beatValue = Number(match[2]);
  if (!Number.isFinite(numBeats) || !Number.isFinite(beatValue)) return null;
  if (numBeats <= 0 || beatValue <= 0) return null;
  if (!SUPPORTED_BEAT_VALUES.has(beatValue)) return null;
  return { numBeats, beatValue };
};
var parseTimeSig = (value) => {
  const parsed = parseSupportedTimeSig(value);
  if (parsed) return parsed;
  return { numBeats: 4, beatValue: 4 };
};
var normalizeRenderableTimeSig = (value) => {
  const parsed = parseSupportedTimeSig(value);
  if (!parsed) return DEFAULT_TIME_SIG;
  return `${parsed.numBeats}/${parsed.beatValue}`;
};
var getKeySigAccidentalCount = (keySig) => {
  const index = KEY_SIG_ORDER.indexOf(keySig || "C");
  if (index < 0) return 0;
  if (index <= 7) return index;
  return index - 7;
};
var durationTokenToBeats = (duration, beatValue, dots = 0) => {
  const dotMultiplier = dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1;
  return durationToWholeNote(duration) * beatValue * dotMultiplier;
};
var isTripletDuration = (duration) => duration === "q" || duration === "8" || duration === "16" || duration === "32";
var durationTokenToBeatsWithTuplet = (duration, beatValue, dots = 0, tuplet = false) => {
  const base = durationTokenToBeats(duration, beatValue, dots);
  if (!tuplet) return base;
  if (!isTripletDuration(duration)) return base;
  return base * (2 / 3);
};
var durationToWholeNote = (duration) => {
  switch (duration) {
    case "w":
      return 1;
    case "h":
      return 0.5;
    case "q":
      return 0.25;
    case "8":
      return 0.125;
    case "16":
      return 0.0625;
    case "32":
      return 0.03125;
    default:
      return 0;
  }
};
var restKeyByClef = (clef) => {
  if (clef === "bass") return "d/3";
  if (clef === "alto") return "c/4";
  if (clef === "tenor") return "a/3";
  return "b/4";
};
var attachDots = (note, count) => {
  const dotCount = Math.max(0, Math.min(2, count));
  for (let i = 0; i < dotCount; i += 1) {
    Dot.buildAndAttach([note], { all: true });
  }
};
var parseNoteToken = (token, beatValue, clef) => {
  const match = token.match(/^([a-gA-G]|r)([#b]?)(\d)?\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
  if (!match) return null;
  const pitch = match[1].toLowerCase();
  const accidental = match[2];
  const octave = match[3];
  const duration = match[4];
  const tuplet = match[5] === "t";
  const dotCount = match[6].length;
  const tieNext = match[7] === "~";
  if (!durationTokens.has(duration)) return null;
  const beats = durationTokenToBeatsWithTuplet(duration, beatValue, dotCount, tuplet);
  if (!beats) return null;
  if (pitch === "r") {
    const restDuration = `${duration}r`;
    const note2 = new StaveNote({ keys: [restKeyByClef(clef)], duration: restDuration, clef });
    attachDots(note2, dotCount);
    return {
      note: note2,
      beats,
      tieNext: false,
      pitchKey: null,
      staffPitch: null,
      pitch,
      accidental,
      octave: "",
      duration,
      dotCount,
      tuplet
    };
  }
  if (!octave) return null;
  const key = `${pitch}${accidental}/${octave}`;
  const note = new StaveNote({ keys: [key], duration, clef });
  attachDots(note, dotCount);
  if (accidental) {
    note.addAccidental(0, new Accidental(accidental));
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
    tuplet
  };
};
var splitBeatsToDurations = (beats, beatValue) => {
  const defs = [
    { token: "w", quarterBeats: 4 },
    { token: "h", quarterBeats: 2 },
    { token: "q", quarterBeats: 1 },
    { token: "8", quarterBeats: 0.5 },
    { token: "16", quarterBeats: 0.25 },
    { token: "32", quarterBeats: 0.125 }
  ];
  const candidates = defs.flatMap((def) => [0, 1, 2].map((dots) => {
    const dotMultiplier = dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1;
    return {
      token: def.token,
      dots,
      beats: def.quarterBeats * (beatValue / 4) * dotMultiplier
    };
  })).sort((a, b) => b.beats - a.beats);
  const parts = [];
  let remaining = beats;
  while (remaining > 1e-4) {
    const found = candidates.find((c) => c.beats <= remaining + 1e-4);
    if (!found) break;
    parts.push({ ...found, tuplet: false });
    remaining -= found.beats;
  }
  return parts;
};
var parseNotes = (value, beatValue, _numBeats, clef) => {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const notes = [];
  const errors = [];
  const beatStarts = [];
  const noteBeats = [];
  const tiesNext = [];
  const pitchKeys = [];
  const staffPitches = [];
  const sourceTokenIndices = [];
  const tuplets = [];
  let totalBeats = 0;
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    const parsed = parseNoteToken(token, beatValue, clef);
    if (!parsed) {
      errors.push(`Invalid token: ${token}`);
      continue;
    }
    let remainingTokenBeats = parsed.beats;
    while (remainingTokenBeats > 1e-4) {
      const beatInMeasure = (totalBeats % _numBeats + _numBeats) % _numBeats;
      const remainInMeasure = beatInMeasure === 0 ? _numBeats : _numBeats - beatInMeasure;
      const chunkBeats = Math.min(remainingTokenBeats, remainInMeasure);
      const canUseOriginalToken = Math.abs(remainingTokenBeats - parsed.beats) <= 1e-4 && Math.abs(chunkBeats - parsed.beats) <= 1e-4;
      const parts = canUseOriginalToken ? [{ token: parsed.duration, dots: parsed.dotCount, beats: parsed.beats, tuplet: parsed.tuplet }] : splitBeatsToDurations(chunkBeats, beatValue);
      if (parts.length === 0) break;
      for (const part of parts) {
        const predictedRemaining = remainingTokenBeats - part.beats;
        const isLastPartOfToken = predictedRemaining <= 1e-4;
        const tieNext = parsed.pitch === "r" ? false : !isLastPartOfToken || parsed.tieNext;
        const tupletMark = part.tuplet ? "t" : "";
        const partToken = parsed.pitch === "r" ? `r/${part.token}${tupletMark}${".".repeat(part.dots)}` : `${parsed.pitch}${parsed.accidental}${parsed.octave}/${part.token}${tupletMark}${".".repeat(part.dots)}${tieNext ? "~" : ""}`;
        const parsedPart = parseNoteToken(partToken, beatValue, clef);
        if (!parsedPart) continue;
        beatStarts.push(totalBeats);
        noteBeats.push(parsedPart.beats);
        tiesNext.push(parsedPart.tieNext);
        pitchKeys.push(parsedPart.pitchKey);
        staffPitches.push(parsedPart.staffPitch);
        sourceTokenIndices.push(tokenIndex);
        tuplets.push(parsedPart.tuplet);
        notes.push(parsedPart.note);
        totalBeats += parsedPart.beats;
        remainingTokenBeats -= parsedPart.beats;
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
    tuplets
  };
};
var buildVoice = (notes, numBeats, beatValue) => {
  const voice = new Voice({ num_beats: numBeats, beat_value: beatValue });
  voice.setStrict(false);
  voice.addTickables(notes);
  return voice;
};
var drawMeasureLines = (context, stave, measureBoundaries) => {
  if (measureBoundaries.length <= 2) return;
  const topY = stave.getYForLine(0);
  const bottomY = stave.getYForLine(4);
  for (let i = 1; i < measureBoundaries.length - 1; i += 1) {
    const x = measureBoundaries[i];
    context.beginPath();
    context.moveTo(x, topY);
    context.lineTo(x, bottomY);
    context.stroke();
  }
};
var getMeasureBoundaries = (stave, totalMeasures) => {
  const startX = stave.getNoteStartX();
  const endX = stave.getNoteEndX();
  const width = endX - startX;
  if (totalMeasures <= 1 || width <= 0) return [Math.round(startX), Math.round(endX)];
  const boundaries = [Math.round(startX)];
  for (let i = 1; i < totalMeasures; i += 1) {
    boundaries.push(Math.round(startX + i / totalMeasures * width));
  }
  boundaries.push(Math.round(endX));
  return boundaries;
};
var getRequiredMeasureWidth = (groupedNotes, groupedBeats, beatsPerMeasure, beatValue, clef) => {
  let required = MIN_MEASURE_WIDTH;
  groupedNotes.forEach((measureNotes, idx) => {
    const tickables = [...measureNotes];
    let remainingBeats = Math.max(0, beatsPerMeasure - (groupedBeats[idx] ?? 0));
    const fillDurations = ["w", "h", "q", "8", "16", "32"];
    while (remainingBeats > 1e-4) {
      let picked = null;
      for (const duration of fillDurations) {
        const beats = durationTokenToBeats(duration, beatValue);
        if (beats <= remainingBeats + 1e-4) {
          picked = duration;
          break;
        }
      }
      if (!picked) break;
      const rest = new StaveNote({ keys: [restKeyByClef(clef)], duration: `${picked}r`, clef });
      tickables.push(rest);
      remainingBeats -= durationTokenToBeats(picked, beatValue);
    }
    if (tickables.length === 0) return;
    const voice = buildVoice(tickables, beatsPerMeasure, beatValue);
    const formatter = new Formatter();
    formatter.joinVoices([voice]);
    let minWidth = MIN_MEASURE_WIDTH;
    try {
      minWidth = Math.ceil(formatter.preCalculateMinTotalWidth([voice]));
    } catch {
      minWidth = MIN_MEASURE_WIDTH;
    }
    required = Math.max(required, minWidth + DENSE_MEASURE_PADDING);
  });
  return required;
};
var groupNotesByMeasure = (notes, beatStarts, noteBeats, sourceTokenIndices = [], tuplets = [], beatsPerMeasure, totalMeasures) => {
  const grouped = Array.from({ length: totalMeasures }, () => []);
  const groupedBeats = Array.from({ length: totalMeasures }, () => 0);
  const groupedSourceTokenIndices = Array.from({ length: totalMeasures }, () => []);
  const groupedTuplets = Array.from({ length: totalMeasures }, () => []);
  notes.forEach((note, idx) => {
    const beat = beatStarts[idx] ?? 0;
    const measureIndex = Math.max(0, Math.min(totalMeasures - 1, Math.floor(beat / beatsPerMeasure)));
    grouped[measureIndex].push(note);
    groupedBeats[measureIndex] += noteBeats[idx] ?? 0;
    groupedSourceTokenIndices[measureIndex].push(sourceTokenIndices[idx] ?? idx);
    groupedTuplets[measureIndex].push(Boolean(tuplets[idx]));
  });
  return { grouped, groupedBeats, groupedSourceTokenIndices, groupedTuplets };
};
var drawMeasureVoices = (context, stave, groupedNotes, groupedBeats, groupedSourceTokenIndices, groupedTuplets, measureBoundaries, beatsPerMeasure, beatValue, clef, selectedTokenIndices = []) => {
  const selectedSet = new Set(selectedTokenIndices);
  const isBeamable = (note) => {
    if (note.isRest()) return false;
    const duration = note.getDuration();
    return duration === "8" || duration === "16" || duration === "32";
  };
  const buildBeams = (notes, forceSingle = false) => {
    if (notes.length < 2) return [];
    if (forceSingle) return [new Beam(notes)];
    return Beam.generateBeams(notes, {
      maintain_stem_directions: false,
      beam_rests: false
    });
  };
  const noteXs = [];
  const noteYs = [];
  const noteStartX = stave.getNoteStartX();
  const noteEndX = stave.getNoteEndX();
  const noteWidth = noteEndX - noteStartX;
  const totalMeasures = groupedNotes.length;
  if (totalMeasures <= 0 || noteWidth <= 0) return { noteXs, noteYs };
  groupedNotes.forEach((measureNotes, idx) => {
    if (measureNotes.length === 0) return;
    measureNotes.forEach((note, localIdx) => {
      const sourceTokenIndex = groupedSourceTokenIndices[idx]?.[localIdx];
      if (sourceTokenIndex != null && selectedSet.has(sourceTokenIndex)) {
        note.setStyle({ fillStyle: "#2563eb", strokeStyle: "#2563eb" });
      }
    });
    const startX = measureBoundaries[idx] ?? Math.round(noteStartX + idx / totalMeasures * noteWidth);
    const endX = measureBoundaries[idx + 1] ?? Math.round(noteStartX + (idx + 1) / totalMeasures * noteWidth);
    const measureStave = new Stave(startX, stave.getY(), endX - startX);
    measureStave.setContext(context);
    measureStave.setNoteStartX(startX);
    const tickables = [...measureNotes];
    let remainingBeats = Math.max(0, beatsPerMeasure - (groupedBeats[idx] ?? 0));
    const fillDurations = ["w", "h", "q", "8", "16", "32"];
    while (remainingBeats > 1e-4) {
      let picked = null;
      for (const duration of fillDurations) {
        const beats = durationTokenToBeats(duration, beatValue);
        if (beats <= remainingBeats + 1e-4) {
          picked = duration;
          break;
        }
      }
      if (!picked) break;
      const rest = new StaveNote({ keys: [restKeyByClef(clef)], duration: `${picked}r`, clef });
      rest.setStyle({ fillStyle: "transparent", strokeStyle: "transparent" });
      tickables.push(rest);
      remainingBeats -= durationTokenToBeats(picked, beatValue);
    }
    const voice = buildVoice(tickables, beatsPerMeasure, beatValue);
    const formatWidth = Math.max(10, endX - measureStave.getNoteStartX());
    const formatter = new Formatter();
    formatter.joinVoices([voice]);
    formatter.format([voice], formatWidth);
    const beams = [];
    const tupletFlags = groupedTuplets[idx] ?? [];
    let noteIdx = 0;
    while (noteIdx < measureNotes.length) {
      const note = measureNotes[noteIdx];
      if (!isBeamable(note)) {
        noteIdx += 1;
        continue;
      }
      const isTuplet = Boolean(tupletFlags[noteIdx]);
      const duration = note.getDuration();
      const run = [];
      while (noteIdx < measureNotes.length) {
        const candidate = measureNotes[noteIdx];
        if (!isBeamable(candidate)) break;
        if (Boolean(tupletFlags[noteIdx]) !== isTuplet) break;
        if (candidate.getDuration() !== duration) break;
        run.push(candidate);
        noteIdx += 1;
      }
      if (isTuplet) {
        let i = 0;
        for (; i + 2 < run.length; i += 3) {
          const group = run.slice(i, i + 3);
          beams.push(...buildBeams(group, true));
        }
        const remainder = run.slice(i);
        if (remainder.length >= 2) {
          beams.push(...buildBeams(remainder));
        }
      } else if (run.length >= 2) {
        if (run.length === 3) {
          beams.push(...buildBeams(run, true));
        } else if (run.length === 4) {
          beams.push(...buildBeams(run, true));
        } else {
          for (let i = 0; i < run.length; i += 4) {
            const chunk = run.slice(i, i + 4);
            if (chunk.length >= 2) {
              beams.push(...buildBeams(chunk, chunk.length <= 4));
            }
          }
        }
      }
    }
    voice.draw(context, measureStave);
    beams.forEach((beam) => {
      beam.setContext(context).draw();
    });
    let tupletStart = 0;
    while (tupletStart < measureNotes.length) {
      if (!groupedTuplets[idx]?.[tupletStart]) {
        tupletStart += 1;
        continue;
      }
      const first = measureNotes[tupletStart];
      const duration = first.getDuration();
      const run = [];
      while (tupletStart < measureNotes.length && groupedTuplets[idx]?.[tupletStart] && !measureNotes[tupletStart].isRest() && measureNotes[tupletStart].getDuration() === duration) {
        run.push(measureNotes[tupletStart]);
        tupletStart += 1;
      }
      for (let i = 0; i + 2 < run.length; i += 3) {
        const group = run.slice(i, i + 3);
        const bracketed = !group.every((note) => isBeamable(note));
        const tuplet = new Tuplet(group, {
          num_notes: 3,
          notes_occupied: 2,
          bracketed,
          ratioed: false
        });
        tuplet.setContext(context).draw();
      }
    }
    measureNotes.forEach((note) => {
      noteXs.push(note.getAbsoluteX());
      const ys = note.getYs();
      noteYs.push(Array.isArray(ys) && ys.length > 0 ? ys[0] : stave.getYForLine(2));
    });
  });
  return { noteXs, noteYs };
};
var drawTies = (context, notes, tiesNext, pitchKeys) => {
  for (let i = 0; i < notes.length - 1; i += 1) {
    if (!tiesNext[i]) continue;
    if (!pitchKeys[i] || !pitchKeys[i + 1]) continue;
    if (pitchKeys[i] !== pitchKeys[i + 1]) continue;
    const tie = new StaveTie({
      firstNote: notes[i],
      lastNote: notes[i + 1],
      firstIndexes: [0],
      lastIndexes: [0]
    });
    tie.setContext(context).draw();
  }
};
var renderScoreSvg = (container, attrs, selectedNotes = null) => {
  const errors = [];
  const parentWidth = Math.floor(container.parentElement?.clientWidth || 0);
  const rootWidth = Math.floor(container.closest(".ProseMirror")?.clientWidth || 0);
  const liveMeasuredWidth = Math.max(container.clientWidth, parentWidth, rootWidth, WIDTH);
  const measuredWidth = Math.max(320, liveMeasuredWidth);
  const initialWidth = Number(container.dataset.initialRenderWidth || 0);
  const availableWidth = initialWidth > 0 ? Math.max(initialWidth, measuredWidth) : measuredWidth;
  container.dataset.initialRenderWidth = String(availableWidth);
  container.innerHTML = "";
  const safeWidth = Math.max(320, availableWidth - 12);
  const viewportWidth = Math.max(280, Math.floor(safeWidth * HORIZONTAL_FILL));
  const scaledStaffHeight = Math.max(80, Math.floor(STAFF_HEIGHT * DRAW_SCALE));
  const scaledTopY = Math.max(12, Math.floor(STAFF_TOP_Y * DRAW_SCALE));
  const scaledPadding = Math.max(6, Math.floor(8 * DRAW_SCALE));
  const scaledTailPadding = Math.max(20, Math.floor(40 * DRAW_SCALE));
  const leftInset = attrs.staff === "grand" ? Math.max(16, scaledPadding * 2) : scaledPadding;
  const { numBeats, beatValue } = parseTimeSig(attrs.timeSig || DEFAULT_TIME_SIG);
  const renderableTimeSig = normalizeRenderableTimeSig(attrs.timeSig || DEFAULT_TIME_SIG);
  const singleStaffCount = attrs.staff === "single" ? Math.max(1, Math.min(4, Number(attrs.singleStaffCount || 1))) : 1;
  const singleStaffSources = [attrs.notes, attrs.singleNotes2, attrs.singleNotes3, attrs.singleNotes4];
  const singleStaffClefs = [attrs.singleClef, attrs.singleClef2, attrs.singleClef3, attrs.singleClef4];
  const singleParsedList = attrs.staff === "single" ? Array.from({ length: singleStaffCount }, (_, i) => parseNotes(singleStaffSources[i] || "", beatValue, numBeats, singleStaffClefs[i] || attrs.singleClef)) : [];
  const upperParsed = attrs.staff === "grand" ? parseNotes(attrs.upperNotes, beatValue, numBeats, attrs.upperClef) : null;
  const lowerParsed = attrs.staff === "grand" ? parseNotes(attrs.lowerNotes, beatValue, numBeats, attrs.lowerClef) : null;
  singleParsedList.forEach((parsed) => errors.push(...parsed.errors));
  if (upperParsed) {
    errors.push(...upperParsed.errors);
  }
  if (lowerParsed) {
    errors.push(...lowerParsed.errors);
  }
  const activeMeasures = attrs.staff === "grand" ? Math.max(1, Math.ceil(Math.max(upperParsed?.totalBeats ?? 0, lowerParsed?.totalBeats ?? 0) / numBeats)) : Math.max(1, ...singleParsedList.map((parsed) => Math.ceil((parsed.totalBeats ?? 0) / numBeats)));
  let requiredMeasureWidth = MIN_MEASURE_WIDTH;
  singleParsedList.forEach((parsed, idx) => {
    const totalMeasures = Math.max(1, Math.ceil(parsed.totalBeats / numBeats));
    const { grouped, groupedBeats } = groupNotesByMeasure(
      parsed.notes,
      parsed.beatStarts,
      parsed.noteBeats,
      parsed.sourceTokenIndices,
      parsed.tuplets,
      numBeats,
      totalMeasures
    );
    requiredMeasureWidth = Math.max(
      requiredMeasureWidth,
      getRequiredMeasureWidth(grouped, groupedBeats, numBeats, beatValue, singleStaffClefs[idx] || attrs.singleClef)
    );
  });
  if (upperParsed && lowerParsed) {
    const totalMeasures = Math.max(1, Math.ceil(Math.max(upperParsed.totalBeats, lowerParsed.totalBeats) / numBeats));
    const { grouped: upperGrouped, groupedBeats: upperGroupedBeats } = groupNotesByMeasure(
      upperParsed.notes,
      upperParsed.beatStarts,
      upperParsed.noteBeats,
      upperParsed.sourceTokenIndices,
      upperParsed.tuplets,
      numBeats,
      totalMeasures
    );
    const { grouped: lowerGrouped, groupedBeats: lowerGroupedBeats } = groupNotesByMeasure(
      lowerParsed.notes,
      lowerParsed.beatStarts,
      lowerParsed.noteBeats,
      lowerParsed.sourceTokenIndices,
      lowerParsed.tuplets,
      numBeats,
      totalMeasures
    );
    requiredMeasureWidth = Math.max(
      requiredMeasureWidth,
      getRequiredMeasureWidth(upperGrouped, upperGroupedBeats, numBeats, beatValue, attrs.upperClef),
      getRequiredMeasureWidth(lowerGrouped, lowerGroupedBeats, numBeats, beatValue, attrs.lowerClef)
    );
  }
  const requiredStaveWidth = Math.max(120, activeMeasures * requiredMeasureWidth);
  const baseStaveWidth = Math.max(120, viewportWidth - leftInset - scaledPadding);
  const staveWidth = Math.max(baseStaveWidth, requiredStaveWidth);
  const scaledWidth = Math.max(280, Math.ceil(staveWidth + leftInset + scaledPadding));
  const zoomBaseStaveWidth = Math.max(120, MAX_AUTO_MEASURES * ZOOM_BASE_MEASURE_WIDTH);
  const zoomBaseScaledWidth = Math.max(280, Math.ceil(zoomBaseStaveWidth + leftInset + scaledPadding));
  const targetZoom = Math.max(MIN_DISPLAY_ZOOM, Math.min(1, viewportWidth / zoomBaseScaledWidth));
  const prevZoom = Number(container.dataset.fixedZoom || 0);
  const displayZoom = prevZoom > 0 ? Math.min(prevZoom, targetZoom) : targetZoom;
  container.dataset.fixedZoom = String(displayZoom);
  container.style.setProperty("--score-zoom", String(displayZoom));
  const renderer = new Renderer(container, Renderer.Backends.SVG);
  const height = attrs.staff === "grand" ? scaledStaffHeight * 2 + scaledTailPadding : scaledStaffHeight * singleStaffCount + scaledTailPadding;
  renderer.resize(scaledWidth, height);
  const context = renderer.getContext();
  const stave = new Stave(leftInset, scaledTopY, staveWidth);
  stave.addClef(attrs.staff === "single" ? attrs.singleClef : attrs.upperClef);
  stave.addKeySignature(attrs.keySig || DEFAULT_KEY_SIG);
  stave.addTimeSignature(renderableTimeSig);
  if (attrs.staff === "grand") {
    const lowerY = scaledTopY + scaledStaffHeight;
    const lowerStave = new Stave(leftInset, lowerY, staveWidth);
    lowerStave.addClef(attrs.lowerClef);
    lowerStave.addKeySignature(attrs.keySig || DEFAULT_KEY_SIG);
    lowerStave.addTimeSignature(renderableTimeSig);
    Stave.formatBegModifiers([stave, lowerStave]);
    stave.setContext(context).draw();
    lowerStave.setContext(context).draw();
    container.dataset.staffTopY = String(stave.getYForLine(0));
    container.dataset.staffLineSpacing = String(stave.getSpacingBetweenLines());
    container.dataset.lowerStaffTopY = String(lowerStave.getYForLine(0));
    container.dataset.lowerStaffLineSpacing = String(lowerStave.getSpacingBetweenLines());
    const connector = new StaveConnector(stave, lowerStave);
    connector.setType(StaveConnector.type.BRACE);
    connector.setContext(context).draw();
    const line = new StaveConnector(stave, lowerStave);
    line.setType(StaveConnector.type.SINGLE);
    line.setContext(context).draw();
    const upperNotes = upperParsed?.notes ?? [];
    const upperBeatStarts = upperParsed?.beatStarts ?? [];
    const upperNoteBeats = upperParsed?.noteBeats ?? [];
    const upperTiesNext = upperParsed?.tiesNext ?? [];
    const upperPitchKeys = upperParsed?.pitchKeys ?? [];
    const upperTotalBeats = upperParsed?.totalBeats ?? 0;
    const lowerNotes = lowerParsed?.notes ?? [];
    const lowerBeatStarts = lowerParsed?.beatStarts ?? [];
    const lowerNoteBeats = lowerParsed?.noteBeats ?? [];
    const lowerTiesNext = lowerParsed?.tiesNext ?? [];
    const lowerPitchKeys = lowerParsed?.pitchKeys ?? [];
    const lowerTotalBeats = lowerParsed?.totalBeats ?? 0;
    container.dataset.upperBeatStarts = JSON.stringify(upperBeatStarts);
    container.dataset.upperTotalBeats = String(upperTotalBeats);
    container.dataset.lowerBeatStarts = JSON.stringify(lowerBeatStarts);
    container.dataset.lowerTotalBeats = String(lowerTotalBeats);
    container.dataset.upperNoteTokenMap = JSON.stringify(upperParsed?.sourceTokenIndices ?? []);
    container.dataset.lowerNoteTokenMap = JSON.stringify(lowerParsed?.sourceTokenIndices ?? []);
    container.dataset.upperRenderedPitches = JSON.stringify(upperParsed?.staffPitches ?? []);
    container.dataset.lowerRenderedPitches = JSON.stringify(lowerParsed?.staffPitches ?? []);
    const grandTotalBeats = Math.max(upperTotalBeats, lowerTotalBeats);
    const totalMeasures = Math.max(1, Math.ceil(grandTotalBeats / numBeats));
    const measureBoundaries = getMeasureBoundaries(stave, totalMeasures);
    drawMeasureLines(context, stave, measureBoundaries);
    drawMeasureLines(context, lowerStave, measureBoundaries);
    const {
      grouped: upperByMeasure,
      groupedBeats: upperBeatsByMeasure,
      groupedSourceTokenIndices: upperTokenMapByMeasure,
      groupedTuplets: upperTupletsByMeasure
    } = groupNotesByMeasure(
      upperNotes,
      upperBeatStarts,
      upperNoteBeats,
      upperParsed?.sourceTokenIndices ?? [],
      upperParsed?.tuplets ?? [],
      numBeats,
      totalMeasures
    );
    const {
      grouped: lowerByMeasure,
      groupedBeats: lowerBeatsByMeasure,
      groupedSourceTokenIndices: lowerTokenMapByMeasure,
      groupedTuplets: lowerTupletsByMeasure
    } = groupNotesByMeasure(
      lowerNotes,
      lowerBeatStarts,
      lowerNoteBeats,
      lowerParsed?.sourceTokenIndices ?? [],
      lowerParsed?.tuplets ?? [],
      numBeats,
      totalMeasures
    );
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
      selectedNotes?.target === "upper" ? selectedNotes.indices : []
    );
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
      selectedNotes?.target === "lower" ? selectedNotes.indices : []
    );
    drawTies(context, upperNotes, upperTiesNext, upperPitchKeys);
    drawTies(context, lowerNotes, lowerTiesNext, lowerPitchKeys);
    container.dataset.upperNoteStartX = String(stave.getNoteStartX());
    container.dataset.upperNoteEndX = String(stave.getNoteEndX());
    container.dataset.lowerNoteStartX = String(lowerStave.getNoteStartX());
    container.dataset.lowerNoteEndX = String(lowerStave.getNoteEndX());
    container.dataset.upperNoteXs = JSON.stringify(upperNoteXs);
    container.dataset.lowerNoteXs = JSON.stringify(lowerNoteXs);
    container.dataset.upperNoteYs = JSON.stringify(upperNoteYs);
    container.dataset.lowerNoteYs = JSON.stringify(lowerNoteYs);
    container.dataset.upperMeasureBoundaries = JSON.stringify(measureBoundaries);
    container.dataset.lowerMeasureBoundaries = JSON.stringify(measureBoundaries);
    const keySigCount = getKeySigAccidentalCount(attrs.keySig || DEFAULT_KEY_SIG);
    const keySigX1 = leftInset + Math.round(28 * DRAW_SCALE);
    const keySigWidth = keySigCount === 0 ? Math.round(30 * DRAW_SCALE) : Math.round((20 + keySigCount * 10) * DRAW_SCALE);
    const keySigX2 = keySigX1 + keySigWidth;
    const upperY1 = stave.getYForLine(0) - Math.round(12 * DRAW_SCALE);
    const upperY2 = stave.getYForLine(4) + Math.round(12 * DRAW_SCALE);
    const lowerY1 = lowerStave.getYForLine(0) - Math.round(12 * DRAW_SCALE);
    const lowerY2 = lowerStave.getYForLine(4) + Math.round(12 * DRAW_SCALE);
    container.dataset.upperKeySigHit = JSON.stringify({ x1: keySigX1, x2: keySigX2, y1: upperY1, y2: upperY2 });
    container.dataset.lowerKeySigHit = JSON.stringify({ x1: keySigX1, x2: keySigX2, y1: lowerY1, y2: lowerY2 });
    const clefX1 = leftInset - Math.round(6 * DRAW_SCALE);
    const clefX2 = leftInset + Math.round(34 * DRAW_SCALE);
    container.dataset.upperClefHit = JSON.stringify({ x1: clefX1, x2: clefX2, y1: upperY1, y2: upperY2 });
    container.dataset.lowerClefHit = JSON.stringify({ x1: clefX1, x2: clefX2, y1: lowerY1, y2: lowerY2 });
    container.dataset.singleClefHit = JSON.stringify({});
    container.dataset.single2ClefHit = JSON.stringify({});
    container.dataset.single3ClefHit = JSON.stringify({});
    container.dataset.single4ClefHit = JSON.stringify({});
  } else {
    const singleStaves = Array.from({ length: singleStaffCount }, (_, i) => {
      const staffY = scaledTopY + i * scaledStaffHeight;
      const staff = new Stave(leftInset, staffY, staveWidth);
      staff.addClef(singleStaffClefs[i] || attrs.singleClef);
      staff.addKeySignature(attrs.keySig || DEFAULT_KEY_SIG);
      staff.addTimeSignature(renderableTimeSig);
      staff.setContext(context).draw();
      return staff;
    });
    const primaryStave = singleStaves[0];
    if (!primaryStave) return { errors };
    container.dataset.staffTopY = String(primaryStave.getYForLine(0));
    container.dataset.staffLineSpacing = String(primaryStave.getSpacingBetweenLines());
    container.dataset.singleStaffTopYs = JSON.stringify(singleStaves.map((staff) => staff.getYForLine(0)));
    container.dataset.singleStaffCount = String(singleStaffCount);
    const totalMeasures = Math.max(1, activeMeasures);
    const measureBoundaries = getMeasureBoundaries(primaryStave, totalMeasures);
    const targetNames = ["single", "single2", "single3", "single4"];
    targetNames.forEach((name, idx) => {
      const parsed = idx < singleParsedList.length ? singleParsedList[idx] : null;
      const staff = singleStaves[idx];
      if (!parsed || !staff) {
        container.dataset[`${name}BeatStarts`] = JSON.stringify([]);
        container.dataset[`${name}TotalBeats`] = "0";
        container.dataset[`${name}NoteTokenMap`] = JSON.stringify([]);
        container.dataset[`${name}RenderedPitches`] = JSON.stringify([]);
        container.dataset[`${name}NoteStartX`] = "0";
        container.dataset[`${name}NoteEndX`] = "0";
        container.dataset[`${name}NoteXs`] = JSON.stringify([]);
        container.dataset[`${name}NoteYs`] = JSON.stringify([]);
        container.dataset[`${name}MeasureBoundaries`] = JSON.stringify([]);
        return;
      }
      drawMeasureLines(context, staff, measureBoundaries);
      const {
        grouped: notesByMeasure,
        groupedBeats: beatsByMeasure,
        groupedSourceTokenIndices: tokenMapByMeasure,
        groupedTuplets: tupletsByMeasure
      } = groupNotesByMeasure(
        parsed.notes,
        parsed.beatStarts,
        parsed.noteBeats,
        parsed.sourceTokenIndices,
        parsed.tuplets,
        numBeats,
        totalMeasures
      );
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
        selectedNotes?.target === name ? selectedNotes.indices : []
      );
      drawTies(context, parsed.notes, parsed.tiesNext, parsed.pitchKeys);
      container.dataset[`${name}BeatStarts`] = JSON.stringify(parsed.beatStarts);
      container.dataset[`${name}TotalBeats`] = String(parsed.totalBeats);
      container.dataset[`${name}NoteTokenMap`] = JSON.stringify(parsed.sourceTokenIndices);
      container.dataset[`${name}RenderedPitches`] = JSON.stringify(parsed.staffPitches);
      container.dataset[`${name}NoteStartX`] = String(staff.getNoteStartX());
      container.dataset[`${name}NoteEndX`] = String(staff.getNoteEndX());
      container.dataset[`${name}NoteXs`] = JSON.stringify(noteXs);
      container.dataset[`${name}NoteYs`] = JSON.stringify(noteYs);
      container.dataset[`${name}MeasureBoundaries`] = JSON.stringify(measureBoundaries);
    });
    container.dataset.upperBeatStarts = container.dataset.singleBeatStarts || JSON.stringify([]);
    container.dataset.upperTotalBeats = container.dataset.singleTotalBeats || "0";
    container.dataset.upperNoteTokenMap = container.dataset.singleNoteTokenMap || JSON.stringify([]);
    container.dataset.upperRenderedPitches = container.dataset.singleRenderedPitches || JSON.stringify([]);
    container.dataset.upperNoteStartX = container.dataset.singleNoteStartX || "0";
    container.dataset.upperNoteEndX = container.dataset.singleNoteEndX || "0";
    container.dataset.upperNoteXs = container.dataset.singleNoteXs || JSON.stringify([]);
    container.dataset.upperNoteYs = container.dataset.singleNoteYs || JSON.stringify([]);
    container.dataset.upperMeasureBoundaries = container.dataset.singleMeasureBoundaries || JSON.stringify([]);
    container.dataset.lowerBeatStarts = JSON.stringify([]);
    container.dataset.lowerTotalBeats = "0";
    container.dataset.lowerNoteTokenMap = JSON.stringify([]);
    container.dataset.lowerRenderedPitches = JSON.stringify([]);
    container.dataset.lowerNoteStartX = "0";
    container.dataset.lowerNoteEndX = "0";
    container.dataset.lowerNoteXs = JSON.stringify([]);
    container.dataset.lowerNoteYs = JSON.stringify([]);
    container.dataset.lowerMeasureBoundaries = JSON.stringify([]);
    const keySigCount = getKeySigAccidentalCount(attrs.keySig || DEFAULT_KEY_SIG);
    const keySigX1 = leftInset + Math.round(28 * DRAW_SCALE);
    const keySigWidth = keySigCount === 0 ? Math.round(30 * DRAW_SCALE) : Math.round((20 + keySigCount * 10) * DRAW_SCALE);
    const keySigX2 = keySigX1 + keySigWidth;
    const y1 = primaryStave.getYForLine(0) - Math.round(12 * DRAW_SCALE);
    const y2 = primaryStave.getYForLine(4) + Math.round(12 * DRAW_SCALE);
    container.dataset.upperKeySigHit = JSON.stringify({ x1: keySigX1, x2: keySigX2, y1, y2 });
    container.dataset.lowerKeySigHit = JSON.stringify({});
    const clefX1 = leftInset - Math.round(6 * DRAW_SCALE);
    const clefX2 = leftInset + Math.round(34 * DRAW_SCALE);
    container.dataset.upperClefHit = JSON.stringify({ x1: clefX1, x2: clefX2, y1, y2 });
    container.dataset.lowerClefHit = JSON.stringify({});
    const singleTargets = ["single", "single2", "single3", "single4"];
    singleTargets.forEach((target, idx) => {
      const staff = singleStaves[idx];
      if (!staff) {
        container.dataset[`${target}ClefHit`] = JSON.stringify({});
        return;
      }
      const hitY1 = staff.getYForLine(0) - Math.round(12 * DRAW_SCALE);
      const hitY2 = staff.getYForLine(4) + Math.round(12 * DRAW_SCALE);
      container.dataset[`${target}ClefHit`] = JSON.stringify({ x1: clefX1, x2: clefX2, y1: hitY1, y2: hitY2 });
    });
  }
  return { errors };
};
var defaultScoreAttrs = {
  timeSig: DEFAULT_TIME_SIG,
  keySig: DEFAULT_KEY_SIG,
  staff: "single",
  singleClef: "treble",
  singleClef2: "treble",
  singleClef3: "treble",
  singleClef4: "treble",
  upperClef: "treble",
  lowerClef: "bass",
  singleStaffCount: 1,
  notes: "",
  singleNotes2: "",
  singleNotes3: "",
  singleNotes4: "",
  upperNotes: "",
  lowerNotes: "",
  inputMode: "note",
  inputDuration: "q",
  inputDots: 0,
  inputTuplet: false,
  inputAccidental: "",
  selectedTarget: "",
  selectedIndex: -1,
  selectedIndices: []
};
var TREBLE_STAFF_STEPS = [
  "f5",
  "e5",
  "d5",
  "c5",
  "b4",
  "a4",
  "g4",
  "f4",
  "e4",
  "d4",
  "c4",
  "b3",
  "a3",
  "g3",
  "f3"
];
var BASS_STAFF_STEPS = [
  "a3",
  "g3",
  "f3",
  "e3",
  "d3",
  "c3",
  "b2",
  "a2",
  "g2",
  "f2",
  "e2",
  "d2",
  "c2",
  "b1",
  "a1"
];
var ALTO_STAFF_STEPS = [
  "g4",
  "f4",
  "e4",
  "d4",
  "c4",
  "b3",
  "a3",
  "g3",
  "f3",
  "e3",
  "d3",
  "c3",
  "b2",
  "a2",
  "g2"
];
var TENOR_STAFF_STEPS = [
  "e4",
  "d4",
  "c4",
  "b3",
  "a3",
  "g3",
  "f3",
  "e3",
  "d3",
  "c3",
  "b2",
  "a2",
  "g2",
  "f2",
  "e2"
];
var TREBLE_EXTENDED_STEPS = ["e6", "d6", "c6", "b5", "a5", "g5", ...TREBLE_STAFF_STEPS];
var BASS_EXTENDED_STEPS = ["g4", "f4", "e4", "d4", "c4", "b3", ...BASS_STAFF_STEPS];
var ALTO_EXTENDED_STEPS = ["f5", "e5", "d5", "c5", "b4", "a4", ...ALTO_STAFF_STEPS];
var TENOR_EXTENDED_STEPS = ["d5", "c5", "b4", "a4", "g4", "f4", ...TENOR_STAFF_STEPS];
var getStaffStepsByClef = (clef) => {
  if (clef === "treble") return TREBLE_STAFF_STEPS;
  if (clef === "bass") return BASS_STAFF_STEPS;
  if (clef === "alto") return ALTO_STAFF_STEPS;
  return TENOR_STAFF_STEPS;
};
var getExtendedStepsByClef = (clef) => {
  if (clef === "treble") return TREBLE_EXTENDED_STEPS;
  if (clef === "bass") return BASS_EXTENDED_STEPS;
  if (clef === "alto") return ALTO_EXTENDED_STEPS;
  return TENOR_EXTENDED_STEPS;
};
var pitchFromY = (y, staffTopY, lineSpacing, clef) => {
  const step = lineSpacing / 2;
  const steps = getStaffStepsByClef(clef);
  const rawIndex = Math.round((y - staffTopY) / step);
  const index = Math.max(0, Math.min(steps.length - 1, rawIndex));
  const pitch = steps[index];
  return pitch;
};
var transposeTokenByStep = (token, deltaSteps, clef) => {
  const match = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
  if (!match) return token;
  const letter = match[1].toLowerCase();
  const accidental = match[2];
  const octave = match[3];
  const duration = match[4];
  const tuplet = match[5] || "";
  const dots = match[6] || "";
  const tie = match[7] || "";
  const steps = getExtendedStepsByClef(clef);
  const currentPitch = `${letter}${octave}`;
  const currentIdx = steps.indexOf(currentPitch);
  if (currentIdx < 0) return token;
  const nextIdx = Math.max(0, Math.min(steps.length - 1, currentIdx - deltaSteps));
  const nextPitch = steps[nextIdx];
  const nextLetter = nextPitch[0];
  const nextOctave = nextPitch.slice(1);
  return `${nextLetter}${accidental}${nextOctave}/${duration}${tuplet}${dots}${tie}`;
};
var isYWithinStaff = (y, staffTopY, lineSpacing, extraSteps = 8) => {
  const staffBottomY = staffTopY + lineSpacing * 4;
  const padding = Math.max(12, lineSpacing) + lineSpacing / 2 * extraSteps;
  return y >= staffTopY - padding && y <= staffBottomY + padding;
};

// src/scoreFeatureFlags.ts
var defaultScoreExtraFeatures = {
  multiSingleStaff: false,
  doubleDotted: false
};
var resolveScoreExtraFeatures = (input) => ({
  multiSingleStaff: Boolean(input?.multiSingleStaff),
  doubleDotted: Boolean(input?.doubleDotted)
});

// src/ScoreNodeView.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var SINGLE_TARGETS = ["single", "single2", "single3", "single4"];
var DND_BLOCK_DRAG_HANDLE_MS = 900;
var clearDndSuppress = () => {
  if (typeof window === "undefined") return;
  window.__scoreDndSuppress = false;
  window.__scoreDndSuppressUntil = 0;
  window.__scoreDndBlockDragHandleUntil = 0;
  window.__scoreRequireClickAfterDnd = false;
  window.dispatchEvent(new CustomEvent("score-node-dnd-clear"));
};
var KEY_SIG_OPTIONS = [
  { value: "C", label: "C\uFF08\u30CF\u9577\u8ABF / \u30A4\u77ED\u8ABF\uFF09" },
  { value: "G", label: "G\uFF08\u30C8\u9577\u8ABF / \u30DB\u77ED\u8ABF\uFF09" },
  { value: "D", label: "D\uFF08\u30CB\u9577\u8ABF / \u30ED\u77ED\u8ABF\uFF09" },
  { value: "A", label: "A\uFF08\u30A4\u9577\u8ABF / \u5B30\u30D8\u77ED\u8ABF\uFF09" },
  { value: "E", label: "E\uFF08\u30DB\u9577\u8ABF / \u5B30\u30CF\u77ED\u8ABF\uFF09" },
  { value: "B", label: "B\uFF08\u30ED\u9577\u8ABF / \u5B30\u30C8\u77ED\u8ABF\uFF09" },
  { value: "F#", label: "F#\uFF08\u5B30\u30D8\u9577\u8ABF / \u5B30\u30CB\u77ED\u8ABF\uFF09" },
  { value: "C#", label: "C#\uFF08\u5B30\u30CF\u9577\u8ABF / \u5B30\u30A4\u77ED\u8ABF\uFF09" },
  { value: "F", label: "F\uFF08\u30D8\u9577\u8ABF / \u30CB\u77ED\u8ABF\uFF09" },
  { value: "Bb", label: "Bb\uFF08\u5909\u30ED\u9577\u8ABF / \u30C8\u77ED\u8ABF\uFF09" },
  { value: "Eb", label: "Eb\uFF08\u5909\u30DB\u9577\u8ABF / \u30CF\u77ED\u8ABF\uFF09" },
  { value: "Ab", label: "Ab\uFF08\u5909\u30A4\u9577\u8ABF / \u30D8\u77ED\u8ABF\uFF09" },
  { value: "Db", label: "Db\uFF08\u5909\u30CB\u9577\u8ABF / \u5909\u30ED\u77ED\u8ABF\uFF09" },
  { value: "Gb", label: "Gb\uFF08\u5909\u30C8\u9577\u8ABF / \u5909\u30DB\u77ED\u8ABF\uFF09" },
  { value: "Cb", label: "Cb\uFF08\u5909\u30CF\u9577\u8ABF / \u5909\u30A4\u77ED\u8ABF\uFF09" }
];
var parseHitBox = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Number.isFinite(parsed.x1) || !Number.isFinite(parsed.x2) || !Number.isFinite(parsed.y1) || !Number.isFinite(parsed.y2)) {
      return null;
    }
    return {
      x1: Number(parsed.x1),
      x2: Number(parsed.x2),
      y1: Number(parsed.y1),
      y2: Number(parsed.y2)
    };
  } catch {
    return null;
  }
};
var isInHitBox = (x, y, box) => {
  if (!box) return false;
  return x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2;
};
var isNodeSelectionAt = (selection, pos) => {
  if (!selection || typeof selection !== "object") return false;
  const candidate = selection;
  if (candidate.constructor?.name !== "NodeSelection") return false;
  return typeof candidate.from === "number" && candidate.from === pos;
};
var getClefByTarget = (attrs, target) => {
  if (target === "single") return attrs.singleClef;
  if (target === "single2") return attrs.singleClef2;
  if (target === "single3") return attrs.singleClef3;
  if (target === "single4") return attrs.singleClef4;
  if (target === "upper") return attrs.upperClef;
  return attrs.lowerClef;
};
var getClefPatchByTarget = (target, value) => {
  if (target === "single") return { singleClef: value };
  if (target === "single2") return { singleClef2: value };
  if (target === "single3") return { singleClef3: value };
  if (target === "single4") return { singleClef4: value };
  if (target === "upper") return { upperClef: value };
  return { lowerClef: value };
};
var getNotesByTarget = (attrs, target) => {
  switch (target) {
    case "single":
      return attrs.notes;
    case "single2":
      return attrs.singleNotes2;
    case "single3":
      return attrs.singleNotes3;
    case "single4":
      return attrs.singleNotes4;
    case "upper":
      return attrs.upperNotes;
    case "lower":
      return attrs.lowerNotes;
    default:
      return "";
  }
};
var getNotesPatchByTarget = (target, value) => {
  switch (target) {
    case "single":
      return { notes: value };
    case "single2":
      return { singleNotes2: value };
    case "single3":
      return { singleNotes3: value };
    case "single4":
      return { singleNotes4: value };
    case "upper":
      return { upperNotes: value };
    case "lower":
      return { lowerNotes: value };
    default:
      return {};
  }
};
var getDataPrefixByTarget = (target) => target;
var getClefTargetFromPoint = (container, staffType, x, y) => {
  if (staffType === "grand") {
    const upperClefHit = parseHitBox(container.dataset.upperClefHit);
    const lowerClefHit = parseHitBox(container.dataset.lowerClefHit);
    if (isInHitBox(x, y, upperClefHit)) return "upper";
    if (isInHitBox(x, y, lowerClefHit)) return "lower";
    return null;
  }
  for (const target of SINGLE_TARGETS) {
    const hit = parseHitBox(container.dataset[`${target}ClefHit`]);
    if (isInHitBox(x, y, hit)) return target;
  }
  return null;
};
var parseNumberList = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  } catch {
    return [];
  }
};
var parseStringList = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => item == null ? "" : String(item));
  } catch {
    return [];
  }
};
var getTokenBeatStarts = (tokens, beatValue) => {
  const starts = [];
  let totalBeats = 0;
  for (const token of tokens) {
    starts.push(totalBeats);
    const match = token.match(/^([a-gA-G]|r)([#b]?)(\d)?\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
    if (!match) continue;
    const duration = match[4];
    const tuplet = match[5] === "t";
    const dots = match[6]?.length ?? 0;
    totalBeats += durationTokenToBeatsWithTuplet(duration, beatValue, dots, tuplet);
  }
  return { starts, totalBeats };
};
var getInsertIndexByBeat = (beatStarts, clickBeat) => {
  for (let i = 0; i < beatStarts.length; i += 1) {
    if (clickBeat < beatStarts[i]) return i;
  }
  return beatStarts.length;
};
var getInsertIndexByX = (noteXs, clickX) => {
  if (noteXs.length === 0) return 0;
  let lastLeftIndex = -1;
  noteXs.forEach((x, idx) => {
    if (x <= clickX && idx > lastLeftIndex) {
      lastLeftIndex = idx;
    }
  });
  return lastLeftIndex + 1;
};
var durationDefs = [
  { token: "w", quarterBeats: 4 },
  { token: "h", quarterBeats: 2 },
  { token: "q", quarterBeats: 1 },
  { token: "8", quarterBeats: 0.5 },
  { token: "16", quarterBeats: 0.25 },
  { token: "32", quarterBeats: 0.125 }
];
var splitBeatsIntoDurations = (beats, beatValue) => {
  const parts = [];
  let remaining = beats;
  const defs = durationDefs.flatMap((def) => [0, 1, 2].map((dots) => {
    const dotMultiplier = dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1;
    return {
      token: def.token,
      dots,
      beats: def.quarterBeats * (beatValue / 4) * dotMultiplier
    };
  })).sort((a, b) => b.beats - a.beats);
  while (remaining > 1e-4) {
    const picked = defs.find((def) => def.beats <= remaining + 1e-4);
    if (!picked) break;
    parts.push({ token: picked.token, dots: picked.dots });
    remaining -= picked.beats;
  }
  return parts;
};
var isScoreBubbleVisible = () => {
  const bubble = document.querySelector(".score-bubble");
  if (!bubble) return false;
  const style = window.getComputedStyle(bubble);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = bubble.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};
var getScoreTargetFromY = (container, staffType, y, staffTopY, staffLineSpacing, lowerStaffTopY, lowerStaffLineSpacing) => {
  let target = null;
  if (staffType === "grand") {
    const inUpper = isYWithinStaff(y, staffTopY, staffLineSpacing, 10);
    const inLower = isYWithinStaff(y, lowerStaffTopY, lowerStaffLineSpacing, 10);
    if (inUpper && inLower) {
      const upperCenterY = staffTopY + staffLineSpacing * 2;
      const lowerCenterY = lowerStaffTopY + lowerStaffLineSpacing * 2;
      const distToUpper = Math.abs(y - upperCenterY);
      const distToLower = Math.abs(y - lowerCenterY);
      target = distToLower < distToUpper ? "lower" : "upper";
    } else if (inUpper) {
      target = "upper";
    } else if (inLower) {
      target = "lower";
    }
  } else {
    const tops = parseNumberList(container.dataset.singleStaffTopYs);
    const count = Math.max(1, Math.min(4, Number(container.dataset.singleStaffCount || 1)));
    if (tops.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      let found = false;
      for (let i = 0; i < Math.min(count, tops.length); i += 1) {
        const top = tops[i];
        if (!isYWithinStaff(y, top, staffLineSpacing, 10)) continue;
        const centerY = top + staffLineSpacing * 2;
        const dist = Math.abs(y - centerY);
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestIndex = i;
          found = true;
        }
      }
      if (found) {
        target = SINGLE_TARGETS[nearestIndex] ?? "single";
      }
    } else {
      if (isYWithinStaff(y, staffTopY, staffLineSpacing, 10)) {
        target = "single";
      }
    }
  }
  return target;
};
var getLocalPointFromClient = (svg, clientX, clientY) => {
  const rect = svg.getBoundingClientRect();
  const ctm = svg.getScreenCTM();
  if (ctm) {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(ctm.inverse());
    const svgWidth2 = Number(svg.getAttribute("width")) || svg.viewBox.baseVal.width || rect.width;
    return { x: local.x, y: local.y, svgWidth: svgWidth2 };
  }
  const svgWidth = Number(svg.getAttribute("width")) || svg.viewBox.baseVal.width || rect.width;
  const svgHeight = Number(svg.getAttribute("height")) || svg.viewBox.baseVal.height || rect.height;
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width * svgWidth;
  const y = (clientY - rect.top) / rect.height * svgHeight;
  return { x, y, svgWidth };
};
var getLocalPointFromMouse = (svg, event) => getLocalPointFromClient(svg, event.clientX, event.clientY);
var findNearestTokenIndexFromRendered = ({
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
  maxDy
}) => {
  let nearestTokenIdx = -1;
  let nearestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < noteXs.length; i += 1) {
    const tokenIdx = tokenMap[i] ?? i;
    if (tokenIdx < 0 || tokenIdx >= tokens.length) continue;
    const dx = Math.abs(x - noteXs[i]);
    if (dx > maxDx) continue;
    let dy = 0;
    const noteY = noteYs[i];
    if (Number.isFinite(noteY)) {
      dy = Math.abs(y - noteY);
      if (dy > maxDy) continue;
    } else {
      const renderedPitch = renderedPitches[i];
      if (renderedPitch) {
        dy = Math.abs(y - (staffTopY + staffLineSpacing * 2));
        if (dy > maxDy) continue;
      }
    }
    const score = dx * dx + dy * dy;
    if (score < nearestScore) {
      nearestScore = score;
      nearestTokenIdx = tokenIdx;
    }
  }
  return nearestTokenIdx;
};
var ScoreNodeView = ({ node, editor, getPos, extension }) => {
  const extraFeatures = resolveScoreExtraFeatures(extension.options?.extraFeatures);
  const allowMultiSingleStaff = extraFeatures.multiSingleStaff;
  const allowDoubleDotted = extraFeatures.doubleDotted;
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const finalizeDragSelectionRef = useRef(() => {
  });
  const suppressClickRef = useRef(false);
  const [errors, setErrors] = useState([]);
  const [layoutTick, setLayoutTick] = useState(0);
  const [cursorMode, setCursorMode] = useState("default");
  const [dragBox, setDragBox] = useState(null);
  const [dragHandleDisabledAfterDrop, setDragHandleDisabledAfterDrop] = useState(
    typeof window !== "undefined" && Boolean(window.__scoreDndBlockDragHandleUntil)
  );
  const [clefMenu, setClefMenu] = useState(null);
  const [settingsMenu, setSettingsMenu] = useState(null);
  const attrs = node.attrs;
  const normalizedSingleStaffCount = allowMultiSingleStaff ? Math.max(1, Math.min(4, Number(attrs.singleStaffCount || 1))) : 1;
  const normalizedInputDots = allowDoubleDotted ? Math.max(0, Math.min(2, Number(attrs.inputDots ?? 0))) : Math.max(0, Math.min(1, Number(attrs.inputDots ?? 0)));
  const canDragNode = !clefMenu && !settingsMenu && !attrs.selectedTarget && (attrs.selectedIndices?.length ?? 0) === 0 && attrs.selectedIndex < 0;
  const canDragByCursor = canDragNode && cursorMode !== "insert";
  const selectedNotes = useMemo(() => {
    if (!attrs.selectedTarget) return null;
    const unique = Array.from(new Set(
      (attrs.selectedIndices?.length ? attrs.selectedIndices : attrs.selectedIndex >= 0 ? [attrs.selectedIndex] : []).filter((idx) => Number.isInteger(idx) && idx >= 0)
    )).sort((a, b) => a - b);
    if (unique.length === 0) return null;
    return { target: attrs.selectedTarget, indices: unique };
  }, [attrs.selectedIndex, attrs.selectedIndices, attrs.selectedTarget]);
  const updateNodeAttrs = (partial) => {
    if (!editor || typeof getPos !== "function") return;
    const nodePos = getPos();
    editor.commands.command(({ tr, state, dispatch }) => {
      const currentNode = state.doc.nodeAt(nodePos);
      if (!currentNode) return false;
      tr.setNodeMarkup(nodePos, void 0, {
        ...node.attrs,
        ...partial
      });
      tr.setSelection(NodeSelection.create(tr.doc, nodePos));
      if (dispatch) dispatch(tr);
      return true;
    });
  };
  const clearSelectedNotes = () => {
    if (!attrs.selectedTarget && (attrs.selectedIndices?.length ?? 0) === 0 && attrs.selectedIndex < 0) return;
    updateNodeAttrs({
      selectedTarget: "",
      selectedIndex: -1,
      selectedIndices: []
    });
  };
  const updateScoreAttrsFromMenu = (partial) => {
    const next = { ...partial };
    if (!allowMultiSingleStaff) {
      next.singleStaffCount = 1;
    }
    if (!allowDoubleDotted && next.inputDots != null) {
      next.inputDots = Math.min(1, Number(next.inputDots));
    }
    if (next.staff === "grand" && attrs.staff === "single" && Number(attrs.singleStaffCount || 1) >= 2) {
      next.staff = "single";
    }
    if (next.staff === "single" && attrs.staff === "grand") {
      const sourceTarget = clefMenu?.target === "lower" ? "lower" : "upper";
      next.notes = sourceTarget === "lower" ? attrs.lowerNotes : attrs.upperNotes;
      next.singleNotes2 = "";
      next.singleNotes3 = "";
      next.singleNotes4 = "";
      next.singleStaffCount = 1;
      next.singleClef = "treble";
      next.singleClef2 = "treble";
      next.singleClef3 = "treble";
      next.singleClef4 = "treble";
    }
    if (next.staff === "grand" && attrs.staff === "single") {
      const sourceTarget = clefMenu?.target && SINGLE_TARGETS.includes(clefMenu.target) ? clefMenu.target : "single";
      const sourceSingleNotes = getNotesByTarget(attrs, sourceTarget);
      const sourceSingleClef = getClefByTarget(attrs, sourceTarget);
      next.upperClef = "treble";
      next.lowerClef = "bass";
      if (sourceSingleClef === "bass") {
        next.lowerNotes = sourceSingleNotes;
      } else {
        next.upperNotes = sourceSingleNotes;
      }
    }
    updateNodeAttrs(next);
  };
  useEffect(() => {
    const patch = {};
    if (!allowMultiSingleStaff && Number(attrs.singleStaffCount || 1) !== 1) {
      patch.singleStaffCount = 1;
    }
    if (!allowDoubleDotted && Number(attrs.inputDots ?? 0) > 1) {
      patch.inputDots = 1;
    }
    if (Object.keys(patch).length > 0) {
      updateNodeAttrs(patch);
    }
  }, [allowDoubleDotted, allowMultiSingleStaff, attrs.inputDots, attrs.singleStaffCount]);
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return void 0;
    const rafId = window.requestAnimationFrame(() => {
      setLayoutTick((value) => value + 1);
    });
    const observer = new ResizeObserver(() => {
      setLayoutTick((value) => value + 1);
    });
    observer.observe(container);
    if (container.parentElement) {
      observer.observe(container.parentElement);
    }
    const editorRoot = container.closest(".ProseMirror");
    if (editorRoot) {
      observer.observe(editorRoot);
    }
    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;
    const { errors: renderErrors } = renderScoreSvg(
      container,
      {
        ...attrs,
        singleStaffCount: normalizedSingleStaffCount,
        inputDots: normalizedInputDots
      },
      selectedNotes
    );
    setErrors(renderErrors);
  }, [attrs, layoutTick, selectedNotes]);
  useEffect(() => {
    if (!editor || typeof getPos !== "function") return void 0;
    const onKeyDown = (event) => {
      if (!selectedNotes || selectedNotes.indices.length !== 1) return;
      const isVerticalMove = event.key === "ArrowUp" || event.key === "ArrowDown";
      const isHorizontalMove = event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (!isVerticalMove && !isHorizontalMove) return;
      const nodePos = getPos();
      const isSelected = isNodeSelectionAt(editor.state.selection, nodePos);
      if (!isSelected) return;
      const current = getNotesByTarget(attrs, selectedNotes.target);
      const tokens = current?.trim() ? current.trim().split(/\s+/) : [];
      if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const selectedIndex = selectedNotes.indices[0];
      if (selectedIndex < 0 || selectedIndex >= tokens.length) return;
      if (isHorizontalMove) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        const nextIndex = event.key === "ArrowLeft" ? Math.max(0, selectedIndex - 1) : Math.min(tokens.length - 1, selectedIndex + 1);
        if (nextIndex === selectedIndex) return;
        const nextAttrs2 = {
          ...attrs,
          selectedTarget: selectedNotes.target,
          selectedIndex: nextIndex,
          selectedIndices: [nextIndex]
        };
        editor.commands.command(({ tr, state, dispatch }) => {
          const currentNode = state.doc.nodeAt(nodePos);
          if (!currentNode) return false;
          tr.setNodeMarkup(nodePos, void 0, nextAttrs2);
          tr.setSelection(NodeSelection.create(tr.doc, nodePos));
          if (dispatch) dispatch(tr);
          return true;
        });
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      const clef = getClefByTarget(attrs, selectedNotes.target);
      const delta = event.key === "ArrowUp" ? 1 : -1;
      const moved = transposeTokenByStep(tokens[selectedIndex], delta, clef);
      if (moved === tokens[selectedIndex]) return;
      tokens[selectedIndex] = moved;
      const next = tokens.join(" ");
      const nextAttrs = {
        ...attrs,
        ...getNotesPatchByTarget(selectedNotes.target, next)
      };
      editor.commands.command(({ tr, state, dispatch }) => {
        const currentNode = state.doc.nodeAt(nodePos);
        if (!currentNode) return false;
        tr.setNodeMarkup(nodePos, void 0, nextAttrs);
        tr.setSelection(NodeSelection.create(tr.doc, nodePos));
        if (dispatch) dispatch(tr);
        return true;
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editor, getPos, attrs, selectedNotes]);
  useEffect(() => {
    if (!editor || typeof getPos !== "function") return void 0;
    const onDeleteKeyDown = (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!selectedNotes || selectedNotes.indices.length === 0) return;
      const nodePos = getPos();
      const isNodeSelected = isNodeSelectionAt(editor.state.selection, nodePos);
      if (!isNodeSelected) return;
      const current = getNotesByTarget(attrs, selectedNotes.target);
      const tokens = current?.trim() ? current.trim().split(/\s+/) : [];
      const indices = Array.from(new Set(selectedNotes.indices)).filter((idx) => idx >= 0 && idx < tokens.length).sort((a, b) => b - a);
      if (indices.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      indices.forEach((idx) => {
        tokens.splice(idx, 1);
      });
      const nextAttrs = {
        ...attrs,
        ...getNotesPatchByTarget(selectedNotes.target, tokens.join(" ")),
        selectedTarget: "",
        selectedIndex: -1,
        selectedIndices: []
      };
      editor.commands.command(({ tr, state, dispatch }) => {
        const currentNode = state.doc.nodeAt(nodePos);
        if (!currentNode) return false;
        tr.setNodeMarkup(nodePos, void 0, nextAttrs);
        tr.setSelection(NodeSelection.create(tr.doc, nodePos));
        if (dispatch) dispatch(tr);
        return true;
      });
    };
    window.addEventListener("keydown", onDeleteKeyDown, true);
    return () => window.removeEventListener("keydown", onDeleteKeyDown, true);
  }, [editor, getPos, attrs, selectedNotes]);
  const handleClick = (event) => {
    if (!editor || typeof getPos !== "function") return;
    const nodePos = getPos();
    if (dragHandleDisabledAfterDrop) {
      clearDndSuppress();
      setDragHandleDisabledAfterDrop(false);
    }
    if (typeof window !== "undefined" && window.__scoreDndSuppress === true) {
      clearDndSuppress();
      editor.commands.command(({ tr, dispatch }) => {
        tr.setMeta("score-force-bubble-refresh", Date.now());
        if (dispatch) dispatch(tr);
        return true;
      });
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (event.detail > 1) return;
    if (!editor) return;
    const container = canvasRef.current;
    if (!container) return;
    const isSelected = editor.state.selection instanceof NodeSelection && editor.state.selection.from === nodePos;
    const svg = container.querySelector("svg");
    if (!svg) return;
    const localPoint = getLocalPointFromMouse(svg, event);
    if (!localPoint) return;
    const { x, y, svgWidth } = localPoint;
    const clefTarget = getClefTargetFromPoint(container, attrs.staff, x, y);
    if (clefTarget) {
      setSettingsMenu(null);
      if (attrs.staff !== "single") return;
      if (!isSelected) {
        editor.commands.focus();
        editor.commands.setNodeSelection(nodePos);
      }
      if (clefMenu && clefMenu.target === clefTarget) {
        setClefMenu(null);
        clearSelectedNotes();
        return;
      }
      const menuWidth = 240;
      const menuHeight = 260;
      const padding = 12;
      const left = Math.max(
        padding,
        Math.min(window.innerWidth - menuWidth - padding, event.clientX + 8)
      );
      const top = Math.max(
        padding,
        Math.min(window.innerHeight - menuHeight - padding, event.clientY + 8)
      );
      setClefMenu({ target: clefTarget, left, top });
      return;
    }
    if (clefMenu) {
      setClefMenu(null);
      clearSelectedNotes();
    }
    if (settingsMenu) {
      setSettingsMenu(null);
      clearSelectedNotes();
    }
    const canInsert = isSelected && editor.isFocused && isScoreBubbleVisible();
    if (!canInsert) {
      if (!isSelected || !editor.isFocused) {
        editor.commands.focus();
        editor.commands.setNodeSelection(nodePos);
      } else {
        editor.commands.command(({ tr, dispatch }) => {
          tr.setMeta("score-force-bubble-refresh", Date.now());
          if (dispatch) dispatch(tr);
          return true;
        });
      }
      return;
    }
    const staffTopY = Number(container.dataset.staffTopY ?? 20);
    const staffLineSpacing = Number(container.dataset.staffLineSpacing ?? 10);
    const lowerStaffTopY = Number(
      container.dataset.lowerStaffTopY ?? staffTopY + staffLineSpacing * 8
    );
    const lowerStaffLineSpacing = Number(container.dataset.lowerStaffLineSpacing ?? staffLineSpacing);
    const inStrictUpper = isYWithinStaff(y, staffTopY, staffLineSpacing, 0);
    const inStrictLower = isYWithinStaff(y, lowerStaffTopY, lowerStaffLineSpacing, 0);
    const singleTops = parseNumberList(container.dataset.singleStaffTopYs);
    const inStrictSingle = attrs.staff === "single" ? singleTops.some((top) => isYWithinStaff(y, top, staffLineSpacing, 0)) : false;
    const inStrictTarget = attrs.staff === "grand" ? inStrictUpper || inStrictLower : inStrictSingle;
    if (!inStrictTarget) {
      if (attrs.selectedTarget || (attrs.selectedIndices?.length ?? 0) > 0 || attrs.selectedIndex >= 0) {
        updateNodeAttrs({
          selectedTarget: "",
          selectedIndex: -1,
          selectedIndices: []
        });
      }
      return;
    }
    const target = getScoreTargetFromY(
      container,
      attrs.staff,
      y,
      staffTopY,
      staffLineSpacing,
      lowerStaffTopY,
      lowerStaffLineSpacing
    );
    if (!target) {
      if (attrs.selectedTarget || (attrs.selectedIndices?.length ?? 0) > 0 || attrs.selectedIndex >= 0) {
        updateNodeAttrs({
          selectedTarget: "",
          selectedIndex: -1,
          selectedIndices: []
        });
      }
      return;
    }
    const singleIndex = SINGLE_TARGETS.indexOf(target);
    const targetStaffTopY = target === "lower" ? lowerStaffTopY : singleIndex >= 0 ? singleTops[singleIndex] ?? staffTopY : staffTopY;
    const targetLineSpacing = target === "lower" ? lowerStaffLineSpacing : staffLineSpacing;
    const clef = getClefByTarget(attrs, target);
    const pitch = pitchFromY(
      y,
      targetStaffTopY,
      targetLineSpacing,
      clef
    );
    const accidental = attrs.inputAccidental || "";
    const duration = attrs.inputDuration || "q";
    const dots = normalizedInputDots;
    const tuplet = Boolean(attrs.inputTuplet);
    const dotSuffix = ".".repeat(dots);
    const inputMode = attrs.inputMode || "note";
    const { numBeats, beatValue } = parseTimeSig(attrs.timeSig || "4/4");
    const nextBeats = durationTokenToBeatsWithTuplet(duration, beatValue, dots, tuplet);
    const current = getNotesByTarget(attrs, target);
    const tokens = current?.trim() ? current.trim().split(/\s+/) : [];
    const prefix = getDataPrefixByTarget(target);
    const noteXs = parseNumberList(container.dataset[`${prefix}NoteXs`]);
    const noteYs = parseNumberList(container.dataset[`${prefix}NoteYs`]);
    const localStaffTopY = target === "lower" ? lowerStaffTopY : singleIndex >= 0 ? singleTops[singleIndex] ?? staffTopY : staffTopY;
    const localStaffLineSpacing = targetLineSpacing;
    const tokenMap = parseNumberList(container.dataset[`${prefix}NoteTokenMap`]);
    const renderedPitches = parseStringList(container.dataset[`${prefix}RenderedPitches`]);
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
      maxDy: 24
    });
    const hasSelectedNotes = Boolean(selectedNotes && selectedNotes.indices.length > 0);
    if (hasSelectedNotes) {
      const clickedSelectedNote = Boolean(
        selectedNotes && selectedNotes.target === target && nearestIdx >= 0 && selectedNotes.indices.includes(nearestIdx)
      );
      if (clickedSelectedNote) {
        updateNodeAttrs({ selectedTarget: target, selectedIndex: nearestIdx, selectedIndices: [nearestIdx] });
        return;
      }
      if (nearestIdx >= 0) {
        updateNodeAttrs({ selectedTarget: target, selectedIndex: nearestIdx, selectedIndices: [nearestIdx] });
        return;
      }
      updateNodeAttrs({
        selectedTarget: "",
        selectedIndex: -1,
        selectedIndices: []
      });
      return;
    }
    if (nearestIdx >= 0) {
      updateNodeAttrs({ selectedTarget: target, selectedIndex: nearestIdx, selectedIndices: [nearestIdx] });
      return;
    }
    const { starts: beatStarts, totalBeats } = getTokenBeatStarts(tokens, beatValue);
    const maxBeats = numBeats * MAX_AUTO_MEASURES;
    if (totalBeats + nextBeats > maxBeats) {
      return;
    }
    const noteStartX = Number(
      container.dataset[`${prefix}NoteStartX`]
    ) || 0;
    const noteEndX = Number(
      container.dataset[`${prefix}NoteEndX`]
    ) || svgWidth;
    const clampedX = Math.max(noteStartX, Math.min(noteEndX, x));
    const insertIndex = noteXs.length === tokens.length && noteXs.length > 0 ? Math.max(0, Math.min(tokens.length, getInsertIndexByX(noteXs, clampedX))) : (() => {
      const boundaries = parseNumberList(
        container.dataset[`${prefix}MeasureBoundaries`]
      );
      let clickBeat = 0;
      if (boundaries.length >= 2) {
        const firstX = boundaries[0];
        const lastX = boundaries[boundaries.length - 1];
        const clampedXFromBoundaries = Math.max(firstX, Math.min(lastX, x));
        let measureIndex = 0;
        for (let i = 0; i < boundaries.length - 1; i += 1) {
          if (clampedXFromBoundaries <= boundaries[i + 1]) {
            measureIndex = i;
            break;
          }
        }
        const measureStartX = boundaries[measureIndex];
        const measureEndX = boundaries[measureIndex + 1];
        const measureWidth = Math.max(1, measureEndX - measureStartX);
        const inMeasure = (clampedXFromBoundaries - measureStartX) / measureWidth;
        clickBeat = measureIndex * numBeats + inMeasure * numBeats;
      } else {
        const noteWidth = Math.max(1, noteEndX - noteStartX);
        clickBeat = (clampedX - noteStartX) / noteWidth * totalBeats;
      }
      return Math.max(0, Math.min(tokens.length, getInsertIndexByBeat(beatStarts, clickBeat)));
    })();
    const insertBeat = beatStarts[insertIndex] ?? totalBeats;
    const generatedTokens = [];
    if (tuplet) {
      const tupletMark = "t";
      generatedTokens.push(
        inputMode === "rest" ? `r/${duration}${tupletMark}${dotSuffix}` : `${pitch}${accidental}/${duration}${tupletMark}${dotSuffix}`
      );
    } else {
      const segments = [];
      let remaining = nextBeats;
      let cursorBeat = insertBeat;
      while (remaining > 1e-4) {
        const beatInMeasure = (cursorBeat % numBeats + numBeats) % numBeats;
        const remainInMeasure = beatInMeasure === 0 ? numBeats : numBeats - beatInMeasure;
        const chunk = Math.min(remaining, remainInMeasure);
        segments.push(chunk);
        cursorBeat += chunk;
        remaining -= chunk;
      }
      segments.forEach((segmentBeats, segIdx) => {
        const durations = splitBeatsIntoDurations(segmentBeats, beatValue);
        durations.forEach((dur, durIdx) => {
          const isLast = segIdx === segments.length - 1 && durIdx === durations.length - 1;
          const tieMark = inputMode === "note" && !isLast ? "~" : "";
          const dotsSuffixForPart = ".".repeat(dur.dots);
          const nextToken = inputMode === "rest" ? `r/${dur.token}${dotsSuffixForPart}` : `${pitch}${accidental}/${dur.token}${dotsSuffixForPart}${tieMark}`;
          generatedTokens.push(nextToken);
        });
      });
    }
    if (generatedTokens.length === 0) {
      const tupletMark = tuplet ? "t" : "";
      generatedTokens.push(inputMode === "rest" ? `r/${duration}${tupletMark}${dotSuffix}` : `${pitch}${accidental}/${duration}${tupletMark}${dotSuffix}`);
    }
    tokens.splice(insertIndex, 0, ...generatedTokens);
    const next = tokens.join(" ");
    const nextAttrs = {
      ...attrs,
      ...getNotesPatchByTarget(target, next),
      selectedTarget: target,
      selectedIndex: insertIndex,
      selectedIndices: [insertIndex]
    };
    editor.commands.command(({ tr, state, dispatch }) => {
      const currentNode = state.doc.nodeAt(nodePos);
      if (!currentNode) return false;
      tr.setNodeMarkup(nodePos, void 0, nextAttrs);
      tr.setSelection(NodeSelection.create(tr.doc, nodePos));
      if (dispatch) dispatch(tr);
      return true;
    });
  };
  const handleDoubleClick = (event) => {
    if (!editor) return;
    const container = canvasRef.current;
    if (!container) return;
    if (typeof getPos !== "function") return;
    const nodePos = getPos();
    const isSelected = editor.state.selection instanceof NodeSelection && editor.state.selection.from === nodePos;
    const canEdit = isSelected && editor.isFocused;
    if (!canEdit) {
      editor.commands.focus();
      editor.commands.setNodeSelection(nodePos);
      return;
    }
    const svg = container.querySelector("svg");
    if (!svg) return;
    const localPoint = getLocalPointFromMouse(svg, event);
    if (!localPoint) return;
    const { x, y } = localPoint;
    const staffTopY = Number(container.dataset.staffTopY ?? 20);
    const staffLineSpacing = Number(container.dataset.staffLineSpacing ?? 10);
    const lowerStaffTopY = Number(
      container.dataset.lowerStaffTopY ?? staffTopY + staffLineSpacing * 8
    );
    const lowerStaffLineSpacing = Number(container.dataset.lowerStaffLineSpacing ?? staffLineSpacing);
    const singleTops = parseNumberList(container.dataset.singleStaffTopYs);
    const target = getScoreTargetFromY(
      container,
      attrs.staff,
      y,
      staffTopY,
      staffLineSpacing,
      lowerStaffTopY,
      lowerStaffLineSpacing
    );
    if (!target) {
      if (typeof getPos !== "function") return;
      const nodePos2 = getPos();
      const isNodeSelected = isNodeSelectionAt(editor.state.selection, nodePos2);
      if (!isNodeSelected) {
        editor.commands.focus();
        editor.commands.setNodeSelection(nodePos2);
      }
      return;
    }
    const current = getNotesByTarget(attrs, target);
    const tokens = current?.trim() ? current.trim().split(/\s+/) : [];
    if (tokens.length === 0) return;
    const prefix = getDataPrefixByTarget(target);
    const noteXs = parseNumberList(container.dataset[`${prefix}NoteXs`]);
    const noteYs = parseNumberList(container.dataset[`${prefix}NoteYs`]);
    if (noteXs.length === 0) return;
    const singleIndex = SINGLE_TARGETS.indexOf(target);
    const localStaffTopY = target === "lower" ? lowerStaffTopY : singleIndex >= 0 ? singleTops[singleIndex] ?? staffTopY : staffTopY;
    const localStaffLineSpacing = target === "lower" ? lowerStaffLineSpacing : staffLineSpacing;
    const tokenMap = parseNumberList(container.dataset[`${prefix}NoteTokenMap`]);
    const renderedPitches = parseStringList(container.dataset[`${prefix}RenderedPitches`]);
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
      maxDy: 28
    });
    if (nearestIdx < 0) return;
    tokens.splice(nearestIdx, 1);
    const next = tokens.join(" ");
    let nextSelectedTarget = "";
    let nextSelectedIndex = -1;
    if (selectedNotes && selectedNotes.target === target && selectedNotes.indices.length === 1) {
      const selectedIndex = selectedNotes.indices[0];
      if (selectedIndex < nearestIdx) {
        nextSelectedTarget = target;
        nextSelectedIndex = selectedIndex;
      } else if (selectedIndex > nearestIdx) {
        nextSelectedTarget = target;
        nextSelectedIndex = selectedIndex - 1;
      }
    }
    const nextAttrs = {
      ...attrs,
      ...getNotesPatchByTarget(target, next),
      selectedTarget: nextSelectedTarget,
      selectedIndex: nextSelectedIndex,
      selectedIndices: nextSelectedIndex >= 0 ? [nextSelectedIndex] : []
    };
    editor.commands.command(({ tr, state, dispatch }) => {
      const currentNode = state.doc.nodeAt(nodePos);
      if (!currentNode) return false;
      tr.setNodeMarkup(nodePos, void 0, nextAttrs);
      tr.setSelection(NodeSelection.create(tr.doc, nodePos));
      if (dispatch) dispatch(tr);
      return true;
    });
  };
  const handleContextMenu = (event) => {
    event.preventDefault();
    if (!editor || typeof getPos !== "function") return;
    const nodePos = getPos();
    const isSelected = editor.state.selection instanceof NodeSelection && editor.state.selection.from === nodePos;
    if (!isSelected) {
      editor.commands.focus();
      editor.commands.setNodeSelection(nodePos);
    }
    setClefMenu(null);
    const menuWidth = 260;
    const menuHeight = 320;
    const padding = 12;
    const left = Math.max(
      padding,
      Math.min(window.innerWidth - menuWidth - padding, event.clientX + 8)
    );
    const top = Math.max(
      padding,
      Math.min(window.innerHeight - menuHeight - padding, event.clientY + 8)
    );
    setSettingsMenu({ left, top });
  };
  const handleMouseDown = (event) => {
    if (!editor) return;
    if (dragHandleDisabledAfterDrop) {
      if (typeof window !== "undefined") {
        window.__scoreDndBlockDragHandleUntil = 0;
      }
      setDragHandleDisabledAfterDrop(false);
    }
    if (canDragByCursor) {
      return;
    }
    const container = canvasRef.current;
    if (!container) return;
    const svg = container.querySelector("svg");
    if (!svg) return;
    const localPoint = getLocalPointFromMouse(svg, event);
    if (!localPoint) return;
    const { x, y } = localPoint;
    const staffTopY = Number(container.dataset.staffTopY ?? 20);
    const staffLineSpacing = Number(container.dataset.staffLineSpacing ?? 10);
    const lowerStaffTopY = Number(
      container.dataset.lowerStaffTopY ?? staffTopY + staffLineSpacing * 8
    );
    const lowerStaffLineSpacing = Number(container.dataset.lowerStaffLineSpacing ?? staffLineSpacing);
    const target = getScoreTargetFromY(
      container,
      attrs.staff,
      y,
      staffTopY,
      staffLineSpacing,
      lowerStaffTopY,
      lowerStaffLineSpacing
    );
    if (!target) return;
    const preview = containerRef.current;
    if (!preview) return;
    const previewRect = preview.getBoundingClientRect();
    dragRef.current = {
      target,
      startX: x,
      startY: y,
      startClientX: event.clientX - previewRect.left + preview.scrollLeft,
      startClientY: event.clientY - previewRect.top + preview.scrollTop,
      moved: false
    };
  };
  const handleMouseDownCapture = (event) => {
    if (event.button !== 0) return;
    suppressClickRef.current = false;
    clearDndSuppress();
    if (!editor || typeof getPos !== "function") return;
    const nodePos = getPos();
    const isNodeSelected = isNodeSelectionAt(editor.state.selection, nodePos);
    if (!editor.isFocused || !isNodeSelected) {
      editor.commands.focus();
      editor.commands.setNodeSelection(nodePos);
      window.setTimeout(() => {
        try {
          if (!isNodeSelectionAt(editor.state.selection, nodePos)) {
            editor.commands.focus();
            editor.commands.setNodeSelection(nodePos);
          }
        } catch {
        }
      }, 0);
    }
  };
  const handlePointerDownCapture = (event) => {
    if (event.button !== 0) return;
    suppressClickRef.current = false;
    clearDndSuppress();
    if (!editor || typeof getPos !== "function") return;
    const nodePos = getPos();
    const isNodeSelected = isNodeSelectionAt(editor.state.selection, nodePos);
    if (!editor.isFocused || !isNodeSelected) {
      editor.commands.focus();
      editor.commands.setNodeSelection(nodePos);
      window.setTimeout(() => {
        try {
          if (!isNodeSelectionAt(editor.state.selection, nodePos)) {
            editor.commands.focus();
            editor.commands.setNodeSelection(nodePos);
          }
        } catch {
        }
      }, 0);
    }
  };
  const finalizeDragSelection = (clientX, clientY) => {
    if (!editor) return;
    const drag = dragRef.current;
    dragRef.current = null;
    setDragBox(null);
    if (!drag || !drag.moved) return;
    const container = canvasRef.current;
    if (!container) return;
    const svg = container.querySelector("svg");
    if (!svg) return;
    const localPoint = getLocalPointFromClient(svg, clientX, clientY);
    if (!localPoint) return;
    const { x, y } = localPoint;
    const minX = Math.min(drag.startX, x);
    const maxX = Math.max(drag.startX, x);
    const minY = Math.min(drag.startY, y);
    const maxY = Math.max(drag.startY, y);
    const tokensSource = getNotesByTarget(attrs, drag.target);
    const tokens = tokensSource?.trim() ? tokensSource.trim().split(/\s+/) : [];
    const dragPrefix = getDataPrefixByTarget(drag.target);
    const noteXs = parseNumberList(container.dataset[`${dragPrefix}NoteXs`]);
    const noteYs = parseNumberList(container.dataset[`${dragPrefix}NoteYs`]);
    const tokenMap = parseNumberList(container.dataset[`${dragPrefix}NoteTokenMap`]);
    const staffTopY = Number(container.dataset.staffTopY ?? 20);
    const staffLineSpacing = Number(container.dataset.staffLineSpacing ?? 10);
    const lowerStaffTopY = Number(container.dataset.lowerStaffTopY ?? staffTopY + staffLineSpacing * 8);
    const lowerStaffLineSpacing = Number(container.dataset.lowerStaffLineSpacing ?? staffLineSpacing);
    const singleTops = parseNumberList(container.dataset.singleStaffTopYs);
    const dragSingleIndex = SINGLE_TARGETS.indexOf(drag.target);
    const localStaffTopY = drag.target === "lower" ? lowerStaffTopY : dragSingleIndex >= 0 ? singleTops[dragSingleIndex] ?? staffTopY : staffTopY;
    const localStaffLineSpacing = drag.target === "lower" ? lowerStaffLineSpacing : staffLineSpacing;
    const selected = /* @__PURE__ */ new Set();
    for (let i = 0; i < noteXs.length; i += 1) {
      const tokenIdx = tokenMap[i] ?? i;
      if (tokenIdx < 0 || tokenIdx >= tokens.length) continue;
      const nx = noteXs[i];
      if (nx < minX || nx > maxX) continue;
      const ny = Number.isFinite(noteYs[i]) ? noteYs[i] : localStaffTopY + localStaffLineSpacing * 2;
      if (ny < minY - 16 || ny > maxY + 16) continue;
      selected.add(tokenIdx);
    }
    const indices = Array.from(selected).sort((a, b) => a - b);
    if (indices.length > 0) {
      updateNodeAttrs({
        selectedTarget: drag.target,
        selectedIndices: indices,
        selectedIndex: indices[0]
      });
      suppressClickRef.current = true;
    }
  };
  const handleMouseUp = (event) => {
    finalizeDragSelection(event.clientX, event.clientY);
  };
  useEffect(() => {
    finalizeDragSelectionRef.current = finalizeDragSelection;
  });
  useEffect(() => {
    const hasSelection = Boolean(
      attrs.selectedTarget && ((attrs.selectedIndices?.length ?? 0) > 0 || attrs.selectedIndex >= 0)
    );
    if (!hasSelection) return void 0;
    const handleDocumentMouseDown = (event) => {
      const target = event.target;
      const preview = containerRef.current;
      if (!target || !preview) return;
      if (preview.contains(target)) return;
      if (target.closest(".score-bubble")) return;
      if (!editor || typeof getPos !== "function") return;
      const nodePos = getPos();
      editor.commands.command(({ tr, state, dispatch }) => {
        const currentNode = state.doc.nodeAt(nodePos);
        if (!currentNode) return false;
        tr.setNodeMarkup(nodePos, void 0, {
          ...attrs,
          selectedTarget: "",
          selectedIndex: -1,
          selectedIndices: []
        });
        if (dispatch) dispatch(tr);
        return true;
      });
    };
    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [attrs, attrs.selectedTarget, attrs.selectedIndex, attrs.selectedIndices, editor, getPos]);
  useEffect(() => {
    if (!clefMenu && !settingsMenu) return void 0;
    const onDocumentMouseDown = (event) => {
      const target = event.target;
      if (!target) return;
      if (target.closest(".score-clef-menu")) return;
      if (target.closest(".score-settings-menu")) return;
      setClefMenu(null);
      setSettingsMenu(null);
      if (attrs.selectedTarget || (attrs.selectedIndices?.length ?? 0) > 0 || attrs.selectedIndex >= 0) {
        if (!editor || typeof getPos !== "function") return;
        const nodePos = getPos();
        editor.commands.command(({ tr, state, dispatch }) => {
          const currentNode = state.doc.nodeAt(nodePos);
          if (!currentNode) return false;
          tr.setNodeMarkup(nodePos, void 0, {
            ...attrs,
            selectedTarget: "",
            selectedIndex: -1,
            selectedIndices: []
          });
          if (dispatch) dispatch(tr);
          return true;
        });
      }
      if (editor && typeof getPos === "function") {
        const nodePos = getPos();
        const isNodeSelected = editor.state.selection instanceof NodeSelection && editor.state.selection.from === nodePos;
        if (isNodeSelected) {
          editor.commands.blur();
        }
      }
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [clefMenu, settingsMenu, attrs, attrs.selectedTarget, attrs.selectedIndices, attrs.selectedIndex, editor, getPos]);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (!editor || typeof getPos !== "function") return;
      const nodePos = getPos();
      const isNodeSelected = isNodeSelectionAt(editor.state.selection, nodePos);
      const hasSelectedNotes = Boolean(
        attrs.selectedTarget || (attrs.selectedIndices?.length ?? 0) > 0 || attrs.selectedIndex >= 0
      );
      if (!clefMenu && !settingsMenu && !hasSelectedNotes && !isNodeSelected) return;
      setClefMenu(null);
      setSettingsMenu(null);
      if (hasSelectedNotes) {
        editor.commands.command(({ tr, state, dispatch }) => {
          const currentNode = state.doc.nodeAt(nodePos);
          if (!currentNode) return false;
          tr.setNodeMarkup(nodePos, void 0, {
            ...attrs,
            selectedTarget: "",
            selectedIndex: -1,
            selectedIndices: []
          });
          if (dispatch) dispatch(tr);
          return true;
        });
        return;
      }
      if (isNodeSelected) {
        editor.commands.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clefMenu, settingsMenu, attrs, attrs.selectedTarget, attrs.selectedIndices, attrs.selectedIndex, editor, getPos]);
  const handleMouseMove = (event) => {
    const drag = dragRef.current;
    if (drag) {
      const container2 = canvasRef.current;
      if (container2) {
        const svg2 = container2.querySelector("svg");
        if (svg2) {
          const localPoint2 = getLocalPointFromMouse(svg2, event);
          if (localPoint2) {
            const moved = Math.abs(localPoint2.x - drag.startX) > 4 || Math.abs(localPoint2.y - drag.startY) > 4;
            if (moved) {
              drag.moved = true;
              suppressClickRef.current = true;
              const preview = containerRef.current;
              if (!preview) return;
              const rect = preview.getBoundingClientRect();
              const currentX = event.clientX - rect.left + preview.scrollLeft;
              const currentY = event.clientY - rect.top + preview.scrollTop;
              setDragBox({
                left: Math.min(drag.startClientX, currentX),
                top: Math.min(drag.startClientY, currentY),
                width: Math.abs(currentX - drag.startClientX),
                height: Math.abs(currentY - drag.startClientY)
              });
              setCursorMode("select");
              return;
            }
          }
        }
      }
    }
    const container = canvasRef.current;
    if (!container) return;
    const svg = container.querySelector("svg");
    if (!svg) {
      setCursorMode("default");
      return;
    }
    const localPoint = getLocalPointFromMouse(svg, event);
    if (!localPoint) {
      setCursorMode("default");
      return;
    }
    const { x, y } = localPoint;
    const staffTopY = Number(container.dataset.staffTopY ?? 20);
    const staffLineSpacing = Number(container.dataset.staffLineSpacing ?? 10);
    const lowerStaffTopY = Number(
      container.dataset.lowerStaffTopY ?? staffTopY + staffLineSpacing * 8
    );
    const lowerStaffLineSpacing = Number(container.dataset.lowerStaffLineSpacing ?? staffLineSpacing);
    const singleTops = parseNumberList(container.dataset.singleStaffTopYs);
    const target = getScoreTargetFromY(
      container,
      attrs.staff,
      y,
      staffTopY,
      staffLineSpacing,
      lowerStaffTopY,
      lowerStaffLineSpacing
    );
    if (!target) {
      setCursorMode("default");
      return;
    }
    const onClef = Boolean(getClefTargetFromPoint(container, attrs.staff, x, y));
    if (onClef) {
      setCursorMode("select");
      return;
    }
    const current = getNotesByTarget(attrs, target);
    const tokens = current?.trim() ? current.trim().split(/\s+/) : [];
    const prefix = getDataPrefixByTarget(target);
    const noteXs = parseNumberList(container.dataset[`${prefix}NoteXs`]);
    const noteYs = parseNumberList(container.dataset[`${prefix}NoteYs`]);
    const singleIndex = SINGLE_TARGETS.indexOf(target);
    const localStaffTopY = target === "lower" ? lowerStaffTopY : singleIndex >= 0 ? singleTops[singleIndex] ?? staffTopY : staffTopY;
    const localStaffLineSpacing = target === "lower" ? lowerStaffLineSpacing : staffLineSpacing;
    const tokenMap = parseNumberList(container.dataset[`${prefix}NoteTokenMap`]);
    const renderedPitches = parseStringList(container.dataset[`${prefix}RenderedPitches`]);
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
      maxDy: 24
    });
    if (nearestIdx >= 0) {
      setCursorMode("select");
      return;
    }
    const nodePos = typeof getPos === "function" ? getPos() : -1;
    const isSelected = editor.state.selection instanceof NodeSelection && editor.state.selection.from === nodePos;
    const canInsert = isSelected && editor.isFocused && isScoreBubbleVisible();
    setCursorMode(canInsert ? "insert" : "default");
  };
  const handleMouseLeave = () => {
    if (!dragRef.current) {
      setDragBox(null);
    }
    setCursorMode("default");
  };
  const handleDragStart = () => {
    if (typeof window === "undefined") return;
    window.__scoreRequireClickAfterDnd = true;
    window.__scoreDndSuppress = true;
    window.__scoreDndSuppressUntil = Date.now() + 700;
    window.dispatchEvent(new CustomEvent("score-node-dnd", { detail: { phase: "start" } }));
  };
  const handleDragEnd = () => {
    if (typeof window === "undefined") return;
    window.__scoreRequireClickAfterDnd = true;
    window.__scoreDndBlockDragHandleUntil = Date.now() + DND_BLOCK_DRAG_HANDLE_MS;
    setDragHandleDisabledAfterDrop(true);
    window.__scoreDndSuppress = true;
    window.__scoreDndSuppressUntil = Date.now() + 700;
    window.dispatchEvent(new CustomEvent("score-node-dnd", { detail: { phase: "end" } }));
    if (!editor || typeof getPos !== "function") return;
    window.setTimeout(() => {
      try {
        const nodePos = getPos();
        if (typeof nodePos !== "number" || nodePos < 0) return;
        editor.commands.focus();
        editor.commands.setNodeSelection(nodePos);
      } catch {
      }
    }, 0);
  };
  useEffect(() => {
    if (!dragHandleDisabledAfterDrop || typeof window === "undefined") return void 0;
    const remaining = Math.max(0, (window.__scoreDndBlockDragHandleUntil ?? 0) - Date.now());
    const timer = window.setTimeout(() => {
      window.__scoreDndBlockDragHandleUntil = 0;
      setDragHandleDisabledAfterDrop(false);
    }, remaining + 20);
    return () => window.clearTimeout(timer);
  }, [dragHandleDisabledAfterDrop]);
  useEffect(() => {
    const onWindowMouseMove = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const preview = containerRef.current;
      if (!preview) return;
      const rect = preview.getBoundingClientRect();
      const currentX = event.clientX - rect.left + preview.scrollLeft;
      const currentY = event.clientY - rect.top + preview.scrollTop;
      const moved = Math.abs(currentX - drag.startClientX) > 4 || Math.abs(currentY - drag.startClientY) > 4;
      if (!moved) return;
      drag.moved = true;
      suppressClickRef.current = true;
      setDragBox({
        left: Math.min(drag.startClientX, currentX),
        top: Math.min(drag.startClientY, currentY),
        width: Math.abs(currentX - drag.startClientX),
        height: Math.abs(currentY - drag.startClientY)
      });
    };
    const onWindowMouseUp = (event) => {
      finalizeDragSelectionRef.current(event.clientX, event.clientY);
    };
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
    };
  }, []);
  return /* @__PURE__ */ jsxs(NodeViewWrapper, { className: "score-node", "data-score-staff": node.attrs.staff, children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        className: `score-node__preview score-node__preview--${cursorMode}`,
        ref: containerRef,
        "data-drag-handle": canDragByCursor && !dragHandleDisabledAfterDrop ? "" : void 0,
        onDragStart: handleDragStart,
        onDragEnd: handleDragEnd,
        onDrop: handleDragEnd,
        onPointerDownCapture: handlePointerDownCapture,
        onMouseDownCapture: handleMouseDownCapture,
        onClick: handleClick,
        onDoubleClick: handleDoubleClick,
        onMouseDown: handleMouseDown,
        onMouseMove: handleMouseMove,
        onMouseUp: handleMouseUp,
        onMouseLeave: handleMouseLeave,
        onContextMenu: handleContextMenu,
        children: [
          /* @__PURE__ */ jsx("div", { className: "score-node__canvas", ref: canvasRef }),
          dragBox && /* @__PURE__ */ jsx(
            "div",
            {
              className: "score-node__selection-box",
              style: {
                left: `${dragBox.left}px`,
                top: `${dragBox.top}px`,
                width: `${dragBox.width}px`,
                height: `${dragBox.height}px`
              }
            }
          ),
          clefMenu && /* @__PURE__ */ jsx(
            "div",
            {
              className: "score-clef-menu",
              style: { left: `${clefMenu.left}px`, top: `${clefMenu.top}px`, position: "fixed" },
              onClick: (event) => event.stopPropagation(),
              onMouseDown: (event) => event.stopPropagation(),
              children: attrs.staff === "single" && /* @__PURE__ */ jsxs("label", { children: [
                /* @__PURE__ */ jsx("span", { children: "\u97F3\u90E8\u8A18\u53F7" }),
                /* @__PURE__ */ jsxs(
                  "select",
                  {
                    value: getClefByTarget(attrs, clefMenu.target),
                    onChange: (event) => {
                      const nextClef = event.target.value;
                      updateScoreAttrsFromMenu(getClefPatchByTarget(clefMenu.target, nextClef));
                    },
                    children: [
                      /* @__PURE__ */ jsx("option", { value: "treble", children: "\u30C8\u97F3\u8A18\u53F7" }),
                      /* @__PURE__ */ jsx("option", { value: "bass", children: "\u30D8\u97F3\u8A18\u53F7" }),
                      /* @__PURE__ */ jsx("option", { value: "alto", children: "\u30CF\u97F3\u8A18\u53F7(\u30A2\u30EB\u30C8)" }),
                      /* @__PURE__ */ jsx("option", { value: "tenor", children: "\u30CF\u97F3\u8A18\u53F7(\u30C6\u30CA\u30FC)" })
                    ]
                  }
                )
              ] })
            }
          ),
          settingsMenu && /* @__PURE__ */ jsxs(
            "div",
            {
              className: "score-settings-menu",
              style: { left: `${settingsMenu.left}px`, top: `${settingsMenu.top}px`, position: "fixed" },
              onClick: (event) => event.stopPropagation(),
              onMouseDown: (event) => event.stopPropagation(),
              children: [
                /* @__PURE__ */ jsxs("label", { children: [
                  /* @__PURE__ */ jsx("span", { children: "\u62CD\u5B50" }),
                  /* @__PURE__ */ jsx(
                    "input",
                    {
                      value: attrs.timeSig,
                      onChange: (event) => updateScoreAttrsFromMenu({ timeSig: event.target.value }),
                      placeholder: "4/4"
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxs("label", { children: [
                  /* @__PURE__ */ jsx("span", { children: "\u8ABF\u53F7" }),
                  /* @__PURE__ */ jsx(
                    "select",
                    {
                      value: KEY_SIG_OPTIONS.some((option) => option.value === attrs.keySig) ? attrs.keySig : "C",
                      onChange: (event) => updateScoreAttrsFromMenu({ keySig: event.target.value }),
                      children: KEY_SIG_OPTIONS.map((option) => /* @__PURE__ */ jsx("option", { value: option.value, children: option.label }, option.value))
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxs("label", { children: [
                  /* @__PURE__ */ jsx("span", { children: "\u8B5C\u8868" }),
                  /* @__PURE__ */ jsxs(
                    "select",
                    {
                      value: attrs.staff,
                      disabled: attrs.staff === "single" && normalizedSingleStaffCount >= 2,
                      onChange: (event) => updateScoreAttrsFromMenu({ staff: event.target.value }),
                      children: [
                        /* @__PURE__ */ jsx("option", { value: "single", children: "\u5358\u8B5C\u8868" }),
                        /* @__PURE__ */ jsx("option", { value: "grand", children: "\u5927\u8B5C\u8868" })
                      ]
                    }
                  )
                ] }),
                attrs.staff === "single" && allowMultiSingleStaff && /* @__PURE__ */ jsxs("label", { children: [
                  /* @__PURE__ */ jsx("span", { children: "\u6BB5\u6570" }),
                  /* @__PURE__ */ jsxs(
                    "select",
                    {
                      value: String(normalizedSingleStaffCount),
                      onChange: (event) => updateScoreAttrsFromMenu({ singleStaffCount: Number(event.target.value) }),
                      children: [
                        /* @__PURE__ */ jsx("option", { value: "1", children: "1\u6BB5" }),
                        /* @__PURE__ */ jsx("option", { value: "2", children: "2\u6BB5" }),
                        /* @__PURE__ */ jsx("option", { value: "3", children: "3\u6BB5" }),
                        /* @__PURE__ */ jsx("option", { value: "4", children: "4\u6BB5" })
                      ]
                    }
                  )
                ] })
              ]
            }
          )
        ]
      }
    ),
    errors.length > 0 && /* @__PURE__ */ jsx("div", { className: "score-node__errors", children: errors.slice(0, 3).map((error) => /* @__PURE__ */ jsx("div", { children: error }, error)) })
  ] });
};
var ScoreNodeView_default = ScoreNodeView;

// src/ScoreExtension.ts
var isNodeSelectionLike = (selection) => {
  if (!selection || typeof selection !== "object") return false;
  const candidate = selection;
  return candidate.constructor?.name === "NodeSelection";
};
var getNotesFieldByTarget = (target) => {
  if (target === "lower") return "lowerNotes";
  if (target === "upper") return "upperNotes";
  if (target === "single2") return "singleNotes2";
  if (target === "single3") return "singleNotes3";
  if (target === "single4") return "singleNotes4";
  if (target === "single") return "notes";
  return null;
};
var ScoreExtension = Node.create({
  name: "score",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return {
      extraFeatures: defaultScoreExtraFeatures
    };
  },
  addAttributes() {
    return {
      timeSig: {
        default: defaultScoreAttrs.timeSig,
        parseHTML: (element) => element.getAttribute("data-time-sig") ?? defaultScoreAttrs.timeSig,
        renderHTML: (attributes) => ({ "data-time-sig": attributes.timeSig })
      },
      keySig: {
        default: defaultScoreAttrs.keySig,
        parseHTML: (element) => element.getAttribute("data-key-sig") ?? defaultScoreAttrs.keySig,
        renderHTML: (attributes) => ({ "data-key-sig": attributes.keySig })
      },
      staff: {
        default: defaultScoreAttrs.staff,
        parseHTML: (element) => element.getAttribute("data-staff") ?? defaultScoreAttrs.staff,
        renderHTML: (attributes) => ({ "data-staff": attributes.staff })
      },
      singleClef: {
        default: defaultScoreAttrs.singleClef,
        parseHTML: (element) => element.getAttribute("data-single-clef") ?? defaultScoreAttrs.singleClef,
        renderHTML: (attributes) => ({ "data-single-clef": attributes.singleClef })
      },
      singleClef2: {
        default: defaultScoreAttrs.singleClef2,
        parseHTML: (element) => element.getAttribute("data-single-clef-2") ?? defaultScoreAttrs.singleClef2,
        renderHTML: (attributes) => ({ "data-single-clef-2": attributes.singleClef2 })
      },
      singleClef3: {
        default: defaultScoreAttrs.singleClef3,
        parseHTML: (element) => element.getAttribute("data-single-clef-3") ?? defaultScoreAttrs.singleClef3,
        renderHTML: (attributes) => ({ "data-single-clef-3": attributes.singleClef3 })
      },
      singleClef4: {
        default: defaultScoreAttrs.singleClef4,
        parseHTML: (element) => element.getAttribute("data-single-clef-4") ?? defaultScoreAttrs.singleClef4,
        renderHTML: (attributes) => ({ "data-single-clef-4": attributes.singleClef4 })
      },
      upperClef: {
        default: defaultScoreAttrs.upperClef,
        parseHTML: (element) => element.getAttribute("data-upper-clef") ?? defaultScoreAttrs.upperClef,
        renderHTML: (attributes) => ({ "data-upper-clef": attributes.upperClef })
      },
      lowerClef: {
        default: defaultScoreAttrs.lowerClef,
        parseHTML: (element) => element.getAttribute("data-lower-clef") ?? defaultScoreAttrs.lowerClef,
        renderHTML: (attributes) => ({ "data-lower-clef": attributes.lowerClef })
      },
      singleStaffCount: {
        default: defaultScoreAttrs.singleStaffCount,
        parseHTML: (element) => {
          const raw = Number(element.getAttribute("data-single-staff-count"));
          if (!Number.isFinite(raw)) return defaultScoreAttrs.singleStaffCount;
          return Math.max(1, Math.min(4, Math.floor(raw)));
        },
        renderHTML: (attributes) => ({ "data-single-staff-count": attributes.singleStaffCount })
      },
      notes: {
        default: defaultScoreAttrs.notes,
        parseHTML: (element) => element.getAttribute("data-notes") ?? defaultScoreAttrs.notes,
        renderHTML: (attributes) => ({ "data-notes": attributes.notes })
      },
      singleNotes2: {
        default: defaultScoreAttrs.singleNotes2,
        parseHTML: (element) => element.getAttribute("data-single-notes-2") ?? defaultScoreAttrs.singleNotes2,
        renderHTML: (attributes) => ({ "data-single-notes-2": attributes.singleNotes2 })
      },
      singleNotes3: {
        default: defaultScoreAttrs.singleNotes3,
        parseHTML: (element) => element.getAttribute("data-single-notes-3") ?? defaultScoreAttrs.singleNotes3,
        renderHTML: (attributes) => ({ "data-single-notes-3": attributes.singleNotes3 })
      },
      singleNotes4: {
        default: defaultScoreAttrs.singleNotes4,
        parseHTML: (element) => element.getAttribute("data-single-notes-4") ?? defaultScoreAttrs.singleNotes4,
        renderHTML: (attributes) => ({ "data-single-notes-4": attributes.singleNotes4 })
      },
      upperNotes: {
        default: defaultScoreAttrs.upperNotes,
        parseHTML: (element) => element.getAttribute("data-upper-notes") ?? defaultScoreAttrs.upperNotes,
        renderHTML: (attributes) => ({ "data-upper-notes": attributes.upperNotes })
      },
      lowerNotes: {
        default: defaultScoreAttrs.lowerNotes,
        parseHTML: (element) => element.getAttribute("data-lower-notes") ?? defaultScoreAttrs.lowerNotes,
        renderHTML: (attributes) => ({ "data-lower-notes": attributes.lowerNotes })
      },
      inputDuration: {
        default: defaultScoreAttrs.inputDuration,
        parseHTML: (element) => element.getAttribute("data-input-duration") ?? defaultScoreAttrs.inputDuration,
        renderHTML: (attributes) => ({ "data-input-duration": attributes.inputDuration })
      },
      inputDots: {
        default: defaultScoreAttrs.inputDots,
        parseHTML: (element) => {
          const raw = Number(element.getAttribute("data-input-dots"));
          return Number.isFinite(raw) && raw >= 0 && raw <= 2 ? raw : defaultScoreAttrs.inputDots;
        },
        renderHTML: (attributes) => ({ "data-input-dots": attributes.inputDots })
      },
      inputTuplet: {
        default: defaultScoreAttrs.inputTuplet,
        parseHTML: (element) => element.getAttribute("data-input-tuplet") === "true",
        renderHTML: (attributes) => ({ "data-input-tuplet": String(Boolean(attributes.inputTuplet)) })
      },
      inputMode: {
        default: defaultScoreAttrs.inputMode,
        parseHTML: (element) => element.getAttribute("data-input-mode") ?? defaultScoreAttrs.inputMode,
        renderHTML: (attributes) => ({ "data-input-mode": attributes.inputMode })
      },
      inputAccidental: {
        default: defaultScoreAttrs.inputAccidental,
        parseHTML: (element) => element.getAttribute("data-input-accidental") ?? defaultScoreAttrs.inputAccidental,
        renderHTML: (attributes) => ({ "data-input-accidental": attributes.inputAccidental })
      },
      selectedTarget: {
        default: defaultScoreAttrs.selectedTarget,
        parseHTML: (element) => element.getAttribute("data-selected-target") ?? defaultScoreAttrs.selectedTarget,
        renderHTML: (attributes) => ({ "data-selected-target": attributes.selectedTarget })
      },
      selectedIndex: {
        default: defaultScoreAttrs.selectedIndex,
        parseHTML: (element) => {
          const raw = Number(element.getAttribute("data-selected-index"));
          return Number.isFinite(raw) ? raw : defaultScoreAttrs.selectedIndex;
        },
        renderHTML: (attributes) => ({ "data-selected-index": attributes.selectedIndex })
      },
      selectedIndices: {
        default: defaultScoreAttrs.selectedIndices,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-selected-indices");
          if (!raw) return defaultScoreAttrs.selectedIndices;
          try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return defaultScoreAttrs.selectedIndices;
            return parsed.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0);
          } catch {
            return defaultScoreAttrs.selectedIndices;
          }
        },
        renderHTML: (attributes) => ({
          "data-selected-indices": JSON.stringify(Array.isArray(attributes.selectedIndices) ? attributes.selectedIndices : [])
        })
      }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="score"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "score" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ScoreNodeView_default);
  },
  addKeyboardShortcuts() {
    const handleDeleteSelectedNotes = () => {
      const { editor } = this;
      const { selection, doc } = editor.state;
      let nodePos = -1;
      let attrs = null;
      if (isNodeSelectionLike(selection) && selection.node.type.name === this.name) {
        nodePos = selection.from;
        attrs = selection.node.attrs;
      } else {
        doc.descendants((node, pos) => {
          if (node.type.name !== this.name) return true;
          const candidate = node.attrs;
          const hasSelectedNotes = Boolean(
            candidate.selectedTarget && (Array.isArray(candidate.selectedIndices) && candidate.selectedIndices.length > 0 || Number.isInteger(candidate.selectedIndex) && candidate.selectedIndex >= 0)
          );
          if (!hasSelectedNotes) return true;
          nodePos = pos;
          attrs = candidate;
          return false;
        });
      }
      if (!attrs || nodePos < 0) return false;
      const field = getNotesFieldByTarget(attrs.selectedTarget);
      if (!field) return true;
      const selectedIndices = (Array.isArray(attrs.selectedIndices) && attrs.selectedIndices.length > 0 ? attrs.selectedIndices : Number.isInteger(attrs.selectedIndex) && attrs.selectedIndex >= 0 ? [attrs.selectedIndex] : []).filter((idx) => Number.isInteger(idx) && idx >= 0);
      if (selectedIndices.length === 0) return true;
      const tokens = String(attrs[field] ?? "").trim() ? String(attrs[field]).trim().split(/\s+/) : [];
      const deleteIndices = Array.from(new Set(selectedIndices)).filter((idx) => idx < tokens.length).sort((a, b) => b - a);
      if (deleteIndices.length === 0) return true;
      deleteIndices.forEach((idx) => {
        tokens.splice(idx, 1);
      });
      const nextAttrs = {
        ...attrs,
        [field]: tokens.join(" "),
        selectedTarget: "",
        selectedIndex: -1,
        selectedIndices: []
      };
      return editor.commands.command(({ tr, state, dispatch }) => {
        const currentNode = state.doc.nodeAt(nodePos);
        if (!currentNode) return false;
        tr.setNodeMarkup(nodePos, void 0, nextAttrs);
        tr.setSelection(NodeSelection2.create(tr.doc, nodePos));
        if (dispatch) dispatch(tr);
        return true;
      });
    };
    return {
      Delete: handleDeleteSelectedNotes,
      Backspace: handleDeleteSelectedNotes
    };
  },
  addInputRules() {
    const extraFeatures = resolveScoreExtraFeatures(this.options.extraFeatures);
    const initialAttrs = {
      ...defaultScoreAttrs,
      singleStaffCount: extraFeatures.multiSingleStaff ? defaultScoreAttrs.singleStaffCount : 1,
      inputDots: extraFeatures.doubleDotted ? defaultScoreAttrs.inputDots : Math.min(1, defaultScoreAttrs.inputDots)
    };
    return [
      new InputRule({
        find: /\/score$/,
        handler: ({ range, commands }) => {
          commands.insertContentAt(
            { from: range.from, to: range.to },
            { type: this.name, attrs: initialAttrs },
            { updateSelection: false }
          );
        }
      })
    ];
  }
});
var ScoreExtension_default = ScoreExtension;

// src/ScoreBubbleMenu.tsx
import { BubbleMenu } from "@tiptap/react/menus";
import { useEffect as useEffect2, useState as useState2 } from "react";
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var isNodeSelectionLike2 = (selection) => {
  if (!selection || typeof selection !== "object") return false;
  const candidate = selection;
  return candidate.constructor?.name === "NodeSelection";
};
var isScoreSelection = (editor) => {
  const { selection } = editor.state;
  if (!isNodeSelectionLike2(selection)) return false;
  const candidate = selection;
  return candidate.node.type.name === "score";
};
var getScoreAttrs = (editor) => {
  const { selection } = editor.state;
  if (!isNodeSelectionLike2(selection)) return null;
  const candidate = selection;
  if (candidate.node.type.name !== "score") return null;
  return candidate.node.attrs;
};
var stripTupletFromToken = (token) => {
  const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
  if (note) return `${note[1].toLowerCase()}${note[2]}${note[3]}/${note[4]}${note[6] || ""}${note[7] || ""}`;
  const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
  if (rest) return `r/${rest[1]}${rest[3] || ""}${rest[4] || ""}`;
  return token;
};
var getTupletMeta = (token) => {
  const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
  if (note) {
    return { duration: note[4], hasTuplet: note[5] === "t" };
  }
  const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
  if (rest) {
    return { duration: rest[1], hasTuplet: rest[2] === "t" };
  }
  return null;
};
var normalizeTupletFlags = (tokens) => {
  const next = [...tokens];
  let i = 0;
  while (i < next.length) {
    const meta = getTupletMeta(next[i]);
    if (!meta?.hasTuplet) {
      i += 1;
      continue;
    }
    const start = i;
    const duration = meta.duration;
    while (i < next.length) {
      const m = getTupletMeta(next[i]);
      if (!m?.hasTuplet || m.duration !== duration) break;
      i += 1;
    }
    const runLength = i - start;
    const complete = Math.floor(runLength / 3) * 3;
    for (let idx = start + complete; idx < start + runLength; idx += 1) {
      next[idx] = stripTupletFromToken(next[idx]);
    }
  }
  return next;
};
var ScoreBubbleMenu = ({ editor }) => {
  const [attrs, setAttrs] = useState2(null);
  const [, setSuppressByDnd] = useState2(
    typeof window !== "undefined" && window.__scoreDndSuppress === true
  );
  useEffect2(() => {
    if (!editor) return void 0;
    const update = () => {
      setAttrs(getScoreAttrs(editor));
    };
    update();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);
  useEffect2(() => {
    if (typeof window === "undefined") return void 0;
    let clearTimer = null;
    const clearSuppression = () => {
      window.__scoreDndSuppress = false;
      window.__scoreDndSuppressUntil = 0;
      setSuppressByDnd(false);
    };
    const scheduleClear = (delayMs) => {
      if (clearTimer !== null) {
        window.clearTimeout(clearTimer);
      }
      clearTimer = window.setTimeout(() => {
        clearSuppression();
        clearTimer = null;
      }, Math.max(0, delayMs));
    };
    const onDnd = (event) => {
      const custom = event;
      if (custom.detail?.phase === "start" || custom.detail?.phase === "end") {
        window.__scoreDndSuppress = true;
        window.__scoreDndSuppressUntil = Date.now() + 700;
        setSuppressByDnd(true);
        scheduleClear(720);
      }
    };
    const onMouseDown = () => {
      clearSuppression();
    };
    const onNativeDragLike = () => {
      window.__scoreDndSuppress = true;
      window.__scoreDndSuppressUntil = Date.now() + 700;
      setSuppressByDnd(true);
      scheduleClear(720);
    };
    const onClear = () => {
      clearSuppression();
    };
    window.addEventListener("score-node-dnd", onDnd);
    window.addEventListener("score-node-dnd-clear", onClear);
    window.addEventListener("dragstart", onNativeDragLike, true);
    window.addEventListener("drop", onNativeDragLike, true);
    window.addEventListener("dragend", onNativeDragLike, true);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("score-node-dnd", onDnd);
      window.removeEventListener("score-node-dnd-clear", onClear);
      window.removeEventListener("dragstart", onNativeDragLike, true);
      window.removeEventListener("drop", onNativeDragLike, true);
      window.removeEventListener("dragend", onNativeDragLike, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      if (clearTimer !== null) {
        window.clearTimeout(clearTimer);
      }
    };
  }, []);
  if (!editor) return null;
  const scoreExtension = editor.extensionManager.extensions.find((ext) => ext.name === "score");
  const extraFeatures = resolveScoreExtraFeatures(scoreExtension?.options?.extraFeatures);
  const allowDoubleDotted = extraFeatures.doubleDotted;
  const updateAttrs = (next) => {
    editor.commands.updateAttributes("score", next);
  };
  useEffect2(() => {
    if (!attrs) return;
    if (allowDoubleDotted) return;
    if (Number(attrs.inputDots ?? 0) <= 1) return;
    updateAttrs({ inputDots: 1 });
  }, [allowDoubleDotted, attrs?.inputDots]);
  const getSelectedTokens = (currentAttrs) => {
    if (!currentAttrs.selectedTarget) return null;
    const source = currentAttrs.selectedTarget === "lower" ? currentAttrs.lowerNotes : currentAttrs.selectedTarget === "upper" ? currentAttrs.upperNotes : currentAttrs.selectedTarget === "single2" ? currentAttrs.singleNotes2 : currentAttrs.selectedTarget === "single3" ? currentAttrs.singleNotes3 : currentAttrs.selectedTarget === "single4" ? currentAttrs.singleNotes4 : currentAttrs.notes;
    const tokens = source?.trim() ? source.trim().split(/\s+/) : [];
    const indices = Array.from(new Set(
      (currentAttrs.selectedIndices?.length ? currentAttrs.selectedIndices : currentAttrs.selectedIndex >= 0 ? [currentAttrs.selectedIndex] : []).filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < tokens.length)
    )).sort((a, b) => a - b);
    if (indices.length === 0) return null;
    return {
      tokens,
      token: tokens[indices[0]],
      target: currentAttrs.selectedTarget,
      indices
    };
  };
  const updateSelectedToken = (currentAttrs, updater) => {
    const selected = getSelectedTokens(currentAttrs);
    if (!selected) return;
    let changed = false;
    selected.indices.forEach((idx) => {
      const currentToken = selected.tokens[idx];
      const nextToken = updater(currentToken, selected.target);
      if (!nextToken || nextToken === currentToken) return;
      selected.tokens[idx] = nextToken;
      changed = true;
    });
    if (!changed) return;
    const normalized = normalizeTupletFlags(selected.tokens);
    const joined = normalized.join(" ");
    updateAttrs(selected.target === "lower" ? { lowerNotes: joined } : selected.target === "upper" ? { upperNotes: joined } : selected.target === "single2" ? { singleNotes2: joined } : selected.target === "single3" ? { singleNotes3: joined } : selected.target === "single4" ? { singleNotes4: joined } : { notes: joined });
  };
  return /* @__PURE__ */ jsx2(
    BubbleMenu,
    {
      editor,
      shouldShow: () => {
        const scoreSelected = isScoreSelection(editor);
        const requireClick = typeof window !== "undefined" && window.__scoreRequireClickAfterDnd === true;
        return scoreSelected && !requireClick;
      },
      options: { placement: "top-start" },
      className: "score-bubble",
      children: attrs && /* @__PURE__ */ jsxs2(Fragment, { children: [
        (() => {
          const selected = getSelectedTokens(attrs);
          if (selected) return null;
          return /* @__PURE__ */ jsxs2("div", { className: "score-bubble__stack", children: [
            /* @__PURE__ */ jsxs2("div", { className: "score-bubble__row score-bubble__row--selected-primary", children: [
              /* @__PURE__ */ jsxs2("label", { children: [
                /* @__PURE__ */ jsx2("span", { children: "\u7A2E\u985E" }),
                /* @__PURE__ */ jsxs2(
                  "select",
                  {
                    value: attrs.inputMode,
                    onChange: (event) => {
                      const mode = event.target.value;
                      updateAttrs({
                        inputMode: mode,
                        inputAccidental: mode === "rest" ? "" : attrs.inputAccidental
                      });
                    },
                    children: [
                      /* @__PURE__ */ jsx2("option", { value: "note", children: "\u97F3\u7B26" }),
                      /* @__PURE__ */ jsx2("option", { value: "rest", children: "\u4F11\u7B26" })
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs2("label", { children: [
                /* @__PURE__ */ jsx2("span", { children: "\u97F3\u4FA1" }),
                /* @__PURE__ */ jsxs2(
                  "select",
                  {
                    value: attrs.inputDuration,
                    onChange: (event) => updateAttrs({ inputDuration: event.target.value }),
                    children: [
                      /* @__PURE__ */ jsx2("option", { value: "w", children: "\u5168\u97F3\u7B26" }),
                      /* @__PURE__ */ jsx2("option", { value: "h", children: "2\u5206\u97F3\u7B26" }),
                      /* @__PURE__ */ jsx2("option", { value: "q", children: "4\u5206\u97F3\u7B26" }),
                      /* @__PURE__ */ jsx2("option", { value: "8", children: "8\u5206\u97F3\u7B26" }),
                      /* @__PURE__ */ jsx2("option", { value: "16", children: "16\u5206\u97F3\u7B26" })
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs2("label", { children: [
                /* @__PURE__ */ jsx2("span", { children: "\u4ED8\u70B9" }),
                /* @__PURE__ */ jsxs2(
                  "select",
                  {
                    value: String(allowDoubleDotted ? attrs.inputDots : Math.min(1, Number(attrs.inputDots ?? 0))),
                    onChange: (event) => updateAttrs({
                      inputDots: Math.min(
                        allowDoubleDotted ? 2 : 1,
                        Number(event.target.value)
                      )
                    }),
                    children: [
                      /* @__PURE__ */ jsx2("option", { value: "0", children: "\u306A\u3057" }),
                      /* @__PURE__ */ jsx2("option", { value: "1", children: "\u4ED8\u70B9" }),
                      allowDoubleDotted && /* @__PURE__ */ jsx2("option", { value: "2", children: "\u8907\u4ED8\u70B9" })
                    ]
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ jsxs2("div", { className: "score-bubble__row score-bubble__row--selected-secondary", children: [
              /* @__PURE__ */ jsxs2("label", { children: [
                /* @__PURE__ */ jsx2("span", { children: "\u9023\u7B26" }),
                /* @__PURE__ */ jsxs2(
                  "select",
                  {
                    value: attrs.inputTuplet ? "triplet" : "none",
                    onChange: (event) => updateAttrs({ inputTuplet: event.target.value === "triplet" }),
                    children: [
                      /* @__PURE__ */ jsx2("option", { value: "none", children: "\u306A\u3057" }),
                      /* @__PURE__ */ jsx2("option", { value: "triplet", children: "3\u9023\u7B26" })
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs2("label", { children: [
                /* @__PURE__ */ jsx2("span", { children: "\u81E8\u6642\u8A18\u53F7" }),
                /* @__PURE__ */ jsxs2(
                  "select",
                  {
                    value: attrs.inputAccidental,
                    disabled: attrs.inputMode === "rest",
                    onChange: (event) => updateAttrs({ inputAccidental: event.target.value }),
                    children: [
                      /* @__PURE__ */ jsx2("option", { value: "", children: "\u306A\u3057" }),
                      /* @__PURE__ */ jsx2("option", { value: "#", children: "\u30B7\u30E3\u30FC\u30D7" }),
                      /* @__PURE__ */ jsx2("option", { value: "b", children: "\u30D5\u30E9\u30C3\u30C8" })
                    ]
                  }
                )
              ] })
            ] })
          ] });
        })(),
        (() => {
          const selected = getSelectedTokens(attrs);
          if (!selected) return null;
          const noteMatch = selected.token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
          const restMatch = selected.token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
          const mode = restMatch ? "rest" : "note";
          const duration = restMatch?.[1] ?? noteMatch?.[4] ?? attrs.inputDuration;
          const isTuplet = (restMatch?.[2] ?? noteMatch?.[5] ?? "") === "t";
          const dots = Math.min(allowDoubleDotted ? 2 : 1, (restMatch?.[3] ?? noteMatch?.[6] ?? "").length);
          const accidental = noteMatch?.[2] ?? "";
          return /* @__PURE__ */ jsxs2("div", { className: "score-bubble__stack", children: [
            /* @__PURE__ */ jsxs2("div", { className: "score-bubble__row score-bubble__row--selected-primary", children: [
              /* @__PURE__ */ jsxs2("label", { children: [
                /* @__PURE__ */ jsx2("span", { children: "\u7A2E\u985E" }),
                /* @__PURE__ */ jsxs2(
                  "select",
                  {
                    value: mode,
                    onChange: (event) => {
                      const nextMode = event.target.value;
                      updateSelectedToken(attrs, (token, target) => {
                        const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
                        const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
                        const tokenDuration = rest?.[1] ?? note?.[4] ?? "q";
                        const tokenTuplet = rest?.[2] ?? note?.[5] ?? "";
                        const tokenDots = rest?.[3] ?? note?.[6] ?? "";
                        const tokenTie = rest?.[4] ?? note?.[7] ?? "";
                        if (nextMode === "rest") return `r/${tokenDuration}${tokenTuplet}${tokenDots}${tokenTie}`;
                        if (note) return token;
                        const fallbackPitch = target === "lower" ? "c3" : "c4";
                        return `${fallbackPitch}/${tokenDuration}${tokenTuplet}${tokenDots}${tokenTie}`;
                      });
                    },
                    children: [
                      /* @__PURE__ */ jsx2("option", { value: "note", children: "\u97F3\u7B26" }),
                      /* @__PURE__ */ jsx2("option", { value: "rest", children: "\u4F11\u7B26" })
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs2("label", { children: [
                /* @__PURE__ */ jsx2("span", { children: "\u97F3\u4FA1" }),
                /* @__PURE__ */ jsxs2(
                  "select",
                  {
                    value: duration,
                    onChange: (event) => {
                      const nextDuration = event.target.value;
                      updateSelectedToken(attrs, (token) => {
                        const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
                        if (note) return `${note[1].toLowerCase()}${note[2]}${note[3]}/${nextDuration}${note[5] || ""}${note[6] || ""}${note[7] || ""}`;
                        const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
                        return `r/${nextDuration}${rest?.[2] || ""}${rest?.[3] || ""}${rest?.[4] || ""}`;
                      });
                    },
                    children: [
                      /* @__PURE__ */ jsx2("option", { value: "w", children: "\u5168\u97F3\u7B26" }),
                      /* @__PURE__ */ jsx2("option", { value: "h", children: "2\u5206\u97F3\u7B26" }),
                      /* @__PURE__ */ jsx2("option", { value: "q", children: "4\u5206\u97F3\u7B26" }),
                      /* @__PURE__ */ jsx2("option", { value: "8", children: "8\u5206\u97F3\u7B26" }),
                      /* @__PURE__ */ jsx2("option", { value: "16", children: "16\u5206\u97F3\u7B26" })
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs2("label", { children: [
                /* @__PURE__ */ jsx2("span", { children: "\u4ED8\u70B9" }),
                /* @__PURE__ */ jsxs2(
                  "select",
                  {
                    value: String(dots),
                    onChange: (event) => {
                      const nextDots = Math.min(allowDoubleDotted ? 2 : 1, Number(event.target.value));
                      const dotSuffix = ".".repeat(nextDots);
                      updateSelectedToken(attrs, (token) => {
                        const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
                        if (note) return `${note[1].toLowerCase()}${note[2]}${note[3]}/${note[4]}${note[5] || ""}${dotSuffix}${note[7] || ""}`;
                        const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
                        if (rest) return `r/${rest[1]}${rest[2] || ""}${dotSuffix}${rest[4] || ""}`;
                        return token;
                      });
                    },
                    children: [
                      /* @__PURE__ */ jsx2("option", { value: "0", children: "\u306A\u3057" }),
                      /* @__PURE__ */ jsx2("option", { value: "1", children: "\u4ED8\u70B9" }),
                      allowDoubleDotted && /* @__PURE__ */ jsx2("option", { value: "2", children: "\u8907\u4ED8\u70B9" })
                    ]
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ jsxs2("div", { className: "score-bubble__row score-bubble__row--selected-secondary", children: [
              /* @__PURE__ */ jsxs2("label", { children: [
                /* @__PURE__ */ jsx2("span", { children: "\u9023\u7B26" }),
                /* @__PURE__ */ jsxs2(
                  "select",
                  {
                    value: isTuplet ? "triplet" : "none",
                    onChange: (event) => {
                      const triplet = event.target.value === "triplet";
                      if (triplet && selected.indices.length % 3 !== 0) return;
                      updateSelectedToken(attrs, (token) => {
                        const tupletMark = triplet ? "t" : "";
                        const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
                        if (note) return `${note[1].toLowerCase()}${note[2]}${note[3]}/${note[4]}${tupletMark}${note[6] || ""}${note[7] || ""}`;
                        const rest = token.match(/^r\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
                        if (rest) return `r/${rest[1]}${tupletMark}${rest[3] || ""}${rest[4] || ""}`;
                        return token;
                      });
                    },
                    children: [
                      /* @__PURE__ */ jsx2("option", { value: "none", children: "\u306A\u3057" }),
                      /* @__PURE__ */ jsx2("option", { value: "triplet", children: "3\u9023\u7B26" })
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs2("label", { children: [
                /* @__PURE__ */ jsx2("span", { children: "\u81E8\u6642\u8A18\u53F7" }),
                /* @__PURE__ */ jsxs2(
                  "select",
                  {
                    value: accidental,
                    disabled: mode === "rest",
                    onChange: (event) => {
                      const nextAccidental = event.target.value;
                      updateSelectedToken(attrs, (token) => {
                        const note = token.match(/^([a-gA-G])([#b]?)(\d)\/(w|h|q|8|16|32)(t?)(\.{0,2})(~?)$/);
                        if (!note) return token;
                        return `${note[1].toLowerCase()}${nextAccidental}${note[3]}/${note[4]}${note[5] || ""}${note[6] || ""}${note[7] || ""}`;
                      });
                    },
                    children: [
                      /* @__PURE__ */ jsx2("option", { value: "", children: "\u306A\u3057" }),
                      /* @__PURE__ */ jsx2("option", { value: "#", children: "\u30B7\u30E3\u30FC\u30D7" }),
                      /* @__PURE__ */ jsx2("option", { value: "b", children: "\u30D5\u30E9\u30C3\u30C8" })
                    ]
                  }
                )
              ] })
            ] }),
            selected.indices.length > 1 && selected.indices.length % 3 !== 0 && /* @__PURE__ */ jsxs2("label", { children: [
              /* @__PURE__ */ jsx2("span", { children: "\u9023\u7B26\u6CE8\u610F" }),
              /* @__PURE__ */ jsx2("input", { value: "\u8907\u6570\u9078\u629E\u30673\u9023\u7B26\u5316\u3059\u308B\u5834\u5408\u306F3\u306E\u500D\u6570\u3092\u9078\u629E", readOnly: true })
            ] }),
            /* @__PURE__ */ jsxs2("div", { className: "score-bubble__hint", children: [
              "\u9078\u629E\u4E2D: ",
              selected.target === "upper" ? "\u4E0A\u6BB5" : selected.target === "lower" ? "\u4E0B\u6BB5" : selected.target === "single" ? "1\u6BB5\u76EE" : selected.target === "single2" ? "2\u6BB5\u76EE" : selected.target === "single3" ? "3\u6BB5\u76EE" : "4\u6BB5\u76EE",
              " ",
              selected.indices.length === 1 ? `#${selected.indices[0] + 1}` : `${selected.indices.length}\u4EF6`,
              selected.indices.length === 1 ? "\uFF08Shift+\u2191/\u2193\u3067\u79FB\u52D5\uFF09" : "\uFF08\u7BC4\u56F2\u9078\u629E\uFF09"
            ] })
          ] });
        })(),
        !getSelectedTokens(attrs) && /* @__PURE__ */ jsx2("div", { className: "score-bubble__hint", children: "\u8B5C\u9762\u3092\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u97F3\u7B26\u3092\u8FFD\u52A0" })
      ] })
    }
  );
};
var ScoreBubbleMenu_default = ScoreBubbleMenu;
export {
  ScoreBubbleMenu_default as ScoreBubbleMenu,
  ScoreExtension_default as ScoreExtension,
  defaultScoreAttrs,
  parseTimeSig
};
//# sourceMappingURL=index.mjs.map