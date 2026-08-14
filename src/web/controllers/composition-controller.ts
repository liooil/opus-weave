import { aiRequestEndpoint, aiRequestHeaders, readAiTextResponse, resolvedAiProtocol, sendAiProviderRequest } from '../../domain/ai/providers.ts'
import { FullCompositionWorkflow, type FullCompositionStage, type FullCompositionStreamUpdate } from '../../domain/ai/full-composition.ts'
import { applyOwtAiReasoningParameters, buildOwtAiMessages, type OwtAiConfig, type OwtAiTransportOptions } from '../../domain/ai/owt-ai.ts'


export function createFullCompositionWorkflow(
  config: OwtAiConfig,
  options: OwtAiTransportOptions,
  onStage: (stage: FullCompositionStage) => void,
  onStream: (update: FullCompositionStreamUpdate) => void,
): FullCompositionWorkflow {
  return new FullCompositionWorkflow(async (phase, prompt, signal, onUpdate, onReasoningUpdate) => {
    const protocol = resolvedAiProtocol(config)
    const systemContent = phase === 'plan'
      ? 'Return the requested plain-text PLAN 0.1 format only. Never return JSON or Markdown.'
      : String(buildOwtAiMessages({ task: 'prompt', instruction: prompt, currentOwt: '' }, config)[0]!.content)
    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ]
    let body: Record<string, unknown> = { model: config.model, messages, temperature: config.temperature ?? 0.35, max_tokens: config.maxTokens ?? 4096, stream: true }
    if (protocol === 'openai-responses') body = { model: config.model, instructions: messages[0]!.content, input: [messages[1]], temperature: config.temperature ?? 0.35, max_output_tokens: config.maxTokens ?? 4096, stream: true }
    else if (protocol === 'openai-completions') body = { model: config.model, prompt: `${messages[0]!.content}\n\n${prompt}`, temperature: config.temperature ?? 0.35, max_tokens: config.maxTokens ?? 4096, stream: true }
    else if (protocol === 'anthropic-messages') body = { model: config.model, system: messages[0]!.content, messages: [messages[1]], temperature: config.temperature ?? 0.35, max_tokens: config.maxTokens ?? 4096, stream: true }
    else if (protocol === 'ollama-native') body = { model: config.model, messages, options: { temperature: config.temperature ?? 0.35, num_predict: config.maxTokens ?? 4096 }, stream: true }
    body = applyOwtAiReasoningParameters(body, config, protocol)
    const read = async (bodyToSend: Record<string, unknown>): Promise<string> => {
      const response = await sendAiProviderRequest({ endpoint: aiRequestEndpoint(config), headers: aiRequestHeaders(config, protocol), body: bodyToSend }, { ...options, signal })
      return readAiTextResponse(response, protocol, onUpdate, onReasoningUpdate)
    }
    return read(body)
  }, onStage, onStream, config.autoRepair === false ? 0 : Math.max(0, Math.min(10, Math.trunc(config.retryCount ?? 0))), config.promptTemplates)
}
