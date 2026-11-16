'use strict';
/* Muse Auto — nhờ Claude sửa prompt bị Muse AI từ chối, giữ nguyên đặc trưng sản xuất.
 * Dùng SDK chính thức @anthropic-ai/sdk (đóng gói sẵn trong vendor/anthropic, không tải code từ mạng).
 * Chỉ gửi lên api.anthropic.com: prompt bị từ chối, thông báo lỗi của Muse, prompt cảnh trước/sau
 * và "đặc trưng sản xuất" bạn khai báo. API key chỉ lưu trong chrome.storage.local của máy này.
 */

const CLAUDE_MODEL = 'claude-opus-5-5';

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    feasible: { type: 'boolean' },
    prompt: { type: 'string' },
    changes: { type: 'string' }
  },
  required: ['feasible', 'prompt', 'changes'],
  additionalProperties: false
};

const FIX_SYSTEM = `You edit text-to-video prompts for an animation production pipeline that uses the Muse AI video generator. Muse rejected one scene's prompt. Write a revised prompt that Muse is likely to accept while keeping the production's signature intact.

Rules:
1. Change only what plausibly caused the rejection, judging from Muse's error message and the prompt itself. Keep everything else word for word: visual and render style, camera movement and framing, lighting, aspect ratio, duration, sound and dialogue lines, "no subtitles / no watermark / no music" instructions, character appearance descriptions, and setting.
2. The revised prompt must genuinely comply with content policies. Do not disguise the problematic content with misspellings, coded words, euphemisms, or by splitting it across sentences. Replace or remove the problematic element instead — for example, turn graphic violence into non-graphic slapstick, or replace a real person's likeness with an original character.
3. Keep the scene's story beat and its continuity with the neighbouring scenes when you can. Write the prompt in English, at a similar length to the original.
4. If the scene cannot be made acceptable without losing its core purpose, set feasible to false, return the original prompt unchanged in "prompt", and explain why.
5. "changes": one to three short sentences in Vietnamese saying exactly what you changed and why.`;

let anthropicModule = null;

async function getClaudeKey() {
  const { claudeApiKey } = await chrome.storage.local.get('claudeApiKey');
  return (claudeApiKey || '').trim();
}

async function claudeClient() {
  const apiKey = await getClaudeKey();
  if (!apiKey) return null;
  anthropicModule ??= await import(chrome.runtime.getURL('vendor/anthropic/anthropic.mjs'));
  const { Anthropic } = anthropicModule;
  return { Anthropic, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) };
}

// Đổi lỗi SDK thành câu dễ hiểu (kiểm tra từ cụ thể đến chung)
function claudeErrorNote(Anthropic, e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Claude API key không đúng hoặc đã bị thu hồi';
  if (e instanceof Anthropic.PermissionDeniedError) return 'API key không có quyền dùng model này';
  if (e instanceof Anthropic.RateLimitError) return 'Claude đang giới hạn tốc độ — thử lại sau ít phút';
  if (e instanceof Anthropic.BadRequestError) return `Yêu cầu không hợp lệ: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Không kết nối được tới api.anthropic.com';
  if (e instanceof Anthropic.APIError) return `Lỗi Claude API ${e.status ?? ''}: ${e.message}`;
  return String(e?.message || e);
}

// Kiểm tra API key mà không tốn token (đọc thông tin model)
async function claudeTestKey() {
  const c = await claudeClient();
  if (!c) return { ok: false, note: 'Chưa nhập API key' };
  try {
    const m = await c.client.models.retrieve(CLAUDE_MODEL);
    return { ok: true, note: `Key hợp lệ — dùng được ${m.display_name || CLAUDE_MODEL}` };
  } catch (e) {
    return { ok: false, note: claudeErrorNote(c.Anthropic, e) };
  }
}

/**
 * Nhờ Claude sửa một prompt bị từ chối.
 * Trả về { ok, feasible, prompt, changes, model } hoặc { ok:false, note }.
 */
async function claudeFixPrompt({ prompt, error, style, prev, next }) {
  const c = await claudeClient();
  if (!c) return { ok: false, note: 'Chưa nhập Claude API key (Cài đặt → Claude)' };
  const parts = [];
  if (style && style.trim()) parts.push(`<production_signature>\n${style.trim()}\n</production_signature>`);
  if (prev) parts.push(`<previous_scene_prompt reference_only="true">\n${prev}\n</previous_scene_prompt>`);
  if (next) parts.push(`<next_scene_prompt reference_only="true">\n${next}\n</next_scene_prompt>`);
  parts.push(`<muse_error>\n${error || '(Muse did not give a reason)'}\n</muse_error>`);
  parts.push(`<rejected_prompt>\n${prompt}\n</rejected_prompt>`);

  try {
    const response = await c.client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: FIX_SCHEMA } },
      system: FIX_SYSTEM,
      messages: [{ role: 'user', content: parts.join('\n\n') }]
    });
    if (response.stop_reason === 'refusal') {
      const cat = response.stop_details?.category;
      return { ok: false, note: `Claude không sửa prompt này${cat ? ` (${cat})` : ''}` };
    }
    if (response.stop_reason === 'max_tokens') return { ok: false, note: 'Câu trả lời của Claude bị cắt ngang' };
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let out;
    try { out = JSON.parse(text); } catch { return { ok: false, note: 'Claude trả về dữ liệu không đọc được' }; }
    const fixed = String(out.prompt || '').replace(/\s*\r?\n\s*/g, ' ').trim();
    if (!fixed) return { ok: false, note: 'Claude trả về prompt rỗng' };
    return { ok: true, feasible: !!out.feasible, prompt: fixed, changes: String(out.changes || '').trim(), model: response.model };
  } catch (e) {
    return { ok: false, note: claudeErrorNote(c.Anthropic, e) };
  }
}
