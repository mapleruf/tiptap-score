export type ScoreExtraFeatures = {
  multiSingleStaff: boolean
  doubleDotted: boolean
}

export const defaultScoreExtraFeatures: ScoreExtraFeatures = {
  multiSingleStaff: false,
  doubleDotted: false,
}

export const resolveScoreExtraFeatures = (
  input?: Partial<ScoreExtraFeatures> | null,
): ScoreExtraFeatures => ({
  multiSingleStaff: Boolean(input?.multiSingleStaff),
  doubleDotted: Boolean(input?.doubleDotted),
})

