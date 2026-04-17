import Anthropic from '@anthropic-ai/sdk'

export async function streamPrompt(
  prompt: string,
  model: string,
  apiKey: string,
  onChunk: (text: string) => void,
  onComplete: (usage: { input: number; output: number }) => void,
  onError: (err: Error) => void,
  signal: AbortSignal,
) {
  try {
    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
    })

    const stream = client.messages.stream(
      {
        model,
        max_tokens: 8096,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal },
    )

    for await (const event of stream) {
      if (signal.aborted) break
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        onChunk(event.delta.text)
      }
    }

    if (!signal.aborted) {
      const final = await stream.finalMessage()
      onComplete({
        input: final.usage.input_tokens,
        output: final.usage.output_tokens,
      })
    }
  } catch (err) {
    if (signal.aborted) return
    onError(err instanceof Error ? err : new Error(String(err)))
  }
}
