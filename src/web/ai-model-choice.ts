export const AI_CUSTOM_MODEL_VALUE = '__custom__'

export interface AiModelChoice {
  selection: string
  customModel: string
}

export function resolveAiModelChoice(
  model: string,
  availableModelIds: readonly string[],
): AiModelChoice {
  const normalizedModel = model.trim()
  const available = availableModelIds.filter((id) => id && id !== AI_CUSTOM_MODEL_VALUE)
  if (normalizedModel && available.includes(normalizedModel)) {
    return { selection: normalizedModel, customModel: '' }
  }
  if (!normalizedModel && available[0]) {
    return { selection: available[0], customModel: '' }
  }
  return { selection: AI_CUSTOM_MODEL_VALUE, customModel: normalizedModel }
}

export function selectedAiModelId(selection: string, customModel: string): string {
  return selection === AI_CUSTOM_MODEL_VALUE ? customModel.trim() : selection.trim()
}
