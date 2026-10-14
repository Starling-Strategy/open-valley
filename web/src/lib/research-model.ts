import { generateText, Output, type LanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

/** AI SDK's documented structured-output boundary; domain checks run afterwards. */
export async function structuredOutput<T extends z.ZodType>(options: {
  name: string; schema: T; system: string; prompt: string; model?: LanguageModel;
  signal?: AbortSignal; timeoutMs?: number; maxTokens?: number;
}): Promise<z.infer<T>> {
  const provider = createOpenAICompatible({
    name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENVALLEY_CHAT_API_KEY, supportsStructuredOutputs: true,
    fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
  });
  const result = await generateText({
    model: options.model ?? provider(process.env.OPENVALLEY_CHAT_MODEL || 'openai/gpt-5.4-mini'),
    output: Output.object({ name: options.name, schema: options.schema }),
    system: options.system, prompt: options.prompt,
    maxRetries: 0, maxOutputTokens: options.maxTokens ?? 4500,
    abortSignal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 45000), ...(options.signal ? [options.signal] : [])]),
    providerOptions: { openrouter: { reasoning: { effort: 'low', exclude: true } } },
    experimental_telemetry: { isEnabled: false },
  });
  return options.schema.parse(result.output) as z.infer<T>;
}
