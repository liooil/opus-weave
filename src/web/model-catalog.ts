import { modelDirectory as snapshot, type ModelDirectoryModel } from './models-directory.ts'
export type { ModelDirectoryModel, ModelDirectoryProvider } from './models-directory.ts'

// Verified official addition over the generated snapshot; survives regeneration.
// https://api-docs.deepseek.com/quick_start/pricing/ (2026-09-12).
// Peak USD rates are conservative estimates; off-peak billing is half this.
const deepSeekFlash: ModelDirectoryModel = {
  id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash',
  context: 1_000_000, output: 384_000,
  reasoning: true, reasoningOptions: ['toggle', 'low', 'high', 'max'],
  temperature: true, attachment: true, toolCall: true, structuredOutput: true,
  modalities: ['text', 'image'],
  cost: { input: 0.3, output: 1.2, cache_read: 0.006 },
}

export const modelDirectory = snapshot.map((provider) => provider.id !== 'deepseek' ? provider : {
  ...provider,
  models: [deepSeekFlash, ...provider.models.filter((model) => model.id !== deepSeekFlash.id)],
})
