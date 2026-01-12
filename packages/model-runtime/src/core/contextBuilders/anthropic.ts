import Anthropic from '@anthropic-ai/sdk';
import { imageUrlToBase64 } from '@lobechat/utils';
import OpenAI from 'openai';

import { OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { parseDataUri } from '../../utils/uriParser';

/**
 * Extracts all valid JSON objects from a string that may contain multiple concatenated
 * JSON objects. Returns array of parsed objects.
 * This handles cases where Anthropic's model generates malformed tool arguments.
 */
const extractAllValidJSONs = (jsonString: string): any[] => {
  // First, try normal parse - if it works, return single-element array
  try {
    return [JSON.parse(jsonString)];
  } catch (error) {
    // If it fails with "non-whitespace character after JSON", extract all valid JSONs
    if (error instanceof SyntaxError && error.message.includes('non-whitespace character after JSON')) {
      const extractedJSONs: any[] = [];
      let currentPos = 0;

      while (currentPos < jsonString.length) {
        // Skip whitespace
        while (currentPos < jsonString.length && /\s/.test(jsonString[currentPos])) {
          currentPos++;
        }
        if (currentPos >= jsonString.length) break;

        // Try to parse JSON starting at currentPos
        let depth = 0;
        let inString = false;
        let escape = false;
        let startPos = currentPos;

        for (let i = currentPos; i < jsonString.length; i++) {
          const char = jsonString[i];

          if (escape) {
            escape = false;
            continue;
          }

          if (char === '\\') {
            escape = true;
            continue;
          }

          if (char === '"' && !escape) {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{' || char === '[') {
              depth++;
            } else if (char === '}' || char === ']') {
              depth--;
              if (depth === 0) {
                // Found a complete JSON object
                const jsonStr = jsonString.substring(startPos, i + 1);
                try {
                  extractedJSONs.push(JSON.parse(jsonStr));
                  currentPos = i + 1;
                  break;
                } catch {
                  // Invalid JSON, skip
                  currentPos = i + 1;
                  break;
                }
              }
            }
          }
        }

        // If we didn't find a complete object, break
        if (currentPos === startPos) break;
      }

      if (extractedJSONs.length > 1) {
        console.warn(
          `[Anthropic] MODEL BUG: Detected ${extractedJSONs.length} concatenated JSON objects in tool arguments!`,
          {
            toolArgumentsPreview: jsonString.substring(0, 150) + '...',
            extractedObjects: extractedJSONs,
            note: `Creating ${extractedJSONs.length} separate tool_use blocks. Some may fail schema validation but all will be attempted.`,
          }
        );
      }

      return extractedJSONs;
    }

    // If we couldn't extract any valid JSON, return empty array
    return [];
  }
};

export const buildAnthropicBlock = async (
  content: UserMessageContentPart,
): Promise<Anthropic.ContentBlock | Anthropic.ImageBlockParam | undefined> => {
  switch (content.type) {
    case 'thinking': {
      // just pass-through the content
      return content as any;
    }

    case 'text': {
      if (!!content.text) return content as any;

      return undefined;
    }

    case 'image_url': {
      const { mimeType, base64, type } = parseDataUri(content.image_url.url);

      if (type === 'base64')
        return {
          source: {
            data: base64 as string,
            media_type: mimeType as Anthropic.Base64ImageSource['media_type'],
            type: 'base64',
          },
          type: 'image',
        };

      if (type === 'url') {
        const { base64, mimeType } = await imageUrlToBase64(content.image_url.url);
        return {
          source: {
            data: base64 as string,
            media_type: mimeType as Anthropic.Base64ImageSource['media_type'],
            type: 'base64',
          },
          type: 'image',
        };
      }

      throw new Error(`Invalid image URL: ${content.image_url.url}`);
    }
  }
};

const buildArrayContent = async (content: UserMessageContentPart[]) => {
  let messageContent = (await Promise.all(
    (content as UserMessageContentPart[]).map(async (c) => await buildAnthropicBlock(c)),
  )) as Anthropic.Messages.ContentBlockParam[];

  messageContent = messageContent.filter(Boolean);

  return messageContent;
};

export const buildAnthropicMessage = async (
  message: OpenAIChatMessage,
): Promise<Anthropic.Messages.MessageParam | undefined> => {
  const content = message.content as string | UserMessageContentPart[];

  switch (message.role) {
    case 'system': {
      return { content: content as string, role: 'user' };
    }

    case 'user': {
      return {
        content: typeof content === 'string' ? content : await buildArrayContent(content),
        role: 'user',
      };
    }

    case 'tool': {
      // refs: https://docs.anthropic.com/claude/docs/tool-use#tool-use-and-tool-result-content-blocks
      return {
        content: [
          {
            content: message.content,
            tool_use_id: message.tool_call_id,
            type: 'tool_result',
          } as any,
        ],
        role: 'user',
      };
    }

    case 'assistant': {
      // if there is tool_calls , we need to covert the tool_calls to tool_use content block
      // refs: https://docs.anthropic.com/claude/docs/tool-use#tool-use-and-tool-result-content-blocks
      if (message.tool_calls && message.tool_calls.length > 0) {
        const rawContent =
          typeof content === 'string'
            ? ([{ text: message.content, type: 'text' }] as UserMessageContentPart[])
            : content;

        const messageContent = await buildArrayContent(rawContent);

        const toolUseBlocks = message.tool_calls
          .flatMap((tool) => {
            try {
              const extractedJSONs = extractAllValidJSONs(tool.function.arguments);

              if (extractedJSONs.length === 0) {
                // No valid JSON found
                console.error(
                  `[Anthropic] Failed to parse tool arguments for tool ${tool.function.name}:`,
                  {
                    arguments: tool.function.arguments,
                    error: 'No valid JSON objects found',
                  }
                );
                return [];
              }

              // Create a tool_use block for each extracted JSON
              return extractedJSONs.map((input, index) => ({
                id: index === 0 ? tool.id : `${tool.id}_split_${index}`,
                input,
                name: tool.function.name,
                type: 'tool_use',
              }));
            } catch (error) {
              console.error(
                `[Anthropic] Failed to parse tool arguments for tool ${tool.function.name}:`,
                {
                  arguments: tool.function.arguments,
                  error: error instanceof Error ? error.message : String(error),
                },
              );
              // Skip this tool call if arguments are completely malformed
              return [];
            }
          })
          .filter(Boolean);

        return {
          content: [
            // avoid empty text content block
            ...messageContent,
            ...(toolUseBlocks as any),
          ].filter(Boolean),
          role: 'assistant',
        };
      }

      // or it's a plain assistant message
      // Handle array content (e.g., content with thinking blocks)
      if (Array.isArray(content)) {
        const messageContent = await buildArrayContent(content);
        if (messageContent.length === 0) return undefined;
        return { content: messageContent, role: 'assistant' };
      }

      // Anthropic API requires non-empty content, filter out empty/whitespace-only content
      const textContent = content?.trim();
      if (!textContent) return undefined;
      return { content: textContent, role: 'assistant' };
    }

    case 'function': {
      return { content: content as string, role: 'assistant' };
    }
  }
};

export const buildAnthropicMessages = async (
  oaiMessages: OpenAIChatMessage[],
  options: { enabledContextCaching?: boolean } = {},
): Promise<Anthropic.Messages.MessageParam[]> => {
  const messages: Anthropic.Messages.MessageParam[] = [];
  let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

  // 首先收集所有 assistant 消息中的 tool_call_id 以便后续查找
  const validToolCallIds = new Set<string>();
  for (const message of oaiMessages) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      message.tool_calls.forEach((call) => {
        if (call.id) {
          validToolCallIds.add(call.id);
        }
      });
    }
  }

  for (const message of oaiMessages) {
    const index = oaiMessages.indexOf(message);

    // refs: https://docs.anthropic.com/claude/docs/tool-use#tool-use-and-tool-result-content-blocks
    if (message.role === 'tool') {
      // 检查这个工具消息是否有对应的 assistant 工具调用
      if (message.tool_call_id && validToolCallIds.has(message.tool_call_id)) {
        pendingToolResults.push({
          content: [{ text: message.content as string, type: 'text' }],
          tool_use_id: message.tool_call_id,
          type: 'tool_result',
        });

        // 如果这是最后一个消息或者下一个消息不是 'tool'，则添加累积的工具结果作为一个 'user' 消息
        if (index === oaiMessages.length - 1 || oaiMessages[index + 1].role !== 'tool') {
          messages.push({
            content: pendingToolResults,
            role: 'user',
          });
          pendingToolResults = [];
        }
      } else {
        // 如果工具消息没有对应的 assistant 工具调用，则作为普通文本处理
        messages.push({
          content: message.content as string,
          role: 'user',
        });
      }
    } else {
      const anthropicMessage = await buildAnthropicMessage(message);
      // Filter out undefined messages (e.g., empty assistant messages)
      if (anthropicMessage) {
        messages.push(anthropicMessage);
      }
    }
  }

  const lastMessage = messages.at(-1);
  if (options.enabledContextCaching && !!lastMessage) {
    if (typeof lastMessage.content === 'string') {
      lastMessage.content = [
        {
          cache_control: { type: 'ephemeral' },
          text: lastMessage.content as string,
          type: 'text',
        },
      ];
    } else {
      const lastContent = lastMessage.content.at(-1);

      if (
        lastContent &&
        lastContent.type !== 'thinking' &&
        lastContent.type !== 'redacted_thinking'
      ) {
        lastContent.cache_control = { type: 'ephemeral' };
      }
    }
  }
  return messages;
};

export const buildAnthropicTools = (
  tools?: OpenAI.ChatCompletionTool[],
  options: { enabledContextCaching?: boolean } = {},
) => {
  if (!tools) return;

  return tools.map(
    (tool, index): Anthropic.Tool => ({
      cache_control:
        options.enabledContextCaching && index === tools.length - 1
          ? { type: 'ephemeral' }
          : undefined,
      description: tool.function.description,
      input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
      name: tool.function.name,
    }),
  );
};

export const buildSearchTool = (): Anthropic.WebSearchTool20250305 => {
  const maxUses = process.env.ANTHROPIC_MAX_USES;

  return {
    name: 'web_search',
    type: 'web_search_20250305',
    ...(maxUses &&
      Number.isInteger(Number(maxUses)) &&
      Number(maxUses) > 0 && {
        max_uses: Number(maxUses),
      }),
  };
};
