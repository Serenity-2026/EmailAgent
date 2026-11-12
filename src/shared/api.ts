export const API_CHANNELS = [
  'auth:bootstrap-status', 'auth:bootstrap', 'auth:session', 'auth:login', 'auth:logout', 'auth:create', 'auth:password',
  'accounts:list', 'accounts:add', 'accounts:remove', 'mail:list', 'mail:get', 'mail:sent-folder', 'mail:send',
  'ai:settings:get', 'ai:models', 'ai:settings:save', 'ai:settings:test', 'ai:draft', 'ai:digest', 'ai:digest:history',
  'agent:history', 'agent:overview', 'agent:run', 'agent:cancel', 'agent:confirm', 'agent:clear', 'theme:get', 'theme:set'
] as const

export function validateRpc(channel: string, args: unknown[]): void {
  const string = (value: unknown, max = 2000): boolean => typeof value === 'string' && value.length <= max
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  const uid = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) > 0
  let valid = false
  switch (channel) {
    case 'auth:bootstrap-status': case 'auth:session': case 'auth:logout': case 'accounts:list': case 'ai:settings:get': case 'ai:settings:test':
    case 'ai:digest:history':
    case 'agent:history': case 'agent:overview': case 'agent:clear': case 'theme:get': valid = args.length === 0; break
    case 'auth:bootstrap': case 'auth:login': case 'auth:create': case 'auth:password': case 'ai:models':
      valid = args.length === 2 && args.every((value) => string(value)); break
    case 'accounts:remove': case 'mail:sent-folder': case 'agent:cancel': case 'agent:confirm': case 'theme:set':
      valid = args.length === 1 && string(args[0]); break
    case 'mail:list': valid = args.length === 2 && args.every((value) => string(value)); break
    case 'mail:get': valid = args.length >= 3 && args.length <= 4 && string(args[0]) && string(args[1]) && uid(args[2]) &&
      (args.length === 3 || typeof args[3] === 'boolean'); break
    case 'ai:draft': valid = args.length === 2 && string(args[0], 10_000) && string(args[1]); break
    case 'agent:run': valid = args.length === 3 && string(args[0], 10_000) && string(args[1]) &&
      typeof args[2] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args[2]); break
    case 'ai:digest': valid = args.length === 1 && Array.isArray(args[0]) && args[0].length <= 100 && args[0].every((value) => string(value)); break
    case 'accounts:add': {
      const input = args[0]
      valid = args.length === 1 && object(input) && (input.provider === 'qq' || input.provider === '163') &&
        string(input.address) && string(input.authorizationCode)
      break
    }
    case 'ai:settings:save': {
      const input = args[0]
      valid = args.length === 1 && object(input) && ['baseUrl', 'apiKey', 'model', 'dailyTime'].every((key) => string(input[key])) && typeof input.autoDaily === 'boolean'
      break
    }
    case 'mail:send': {
      const input = args[0]
      valid = args.length === 1 && object(input) && ['accountId', 'to', 'subject'].every((key) => string(input[key])) && string(input.text, 1_000_000) &&
        (input.replyTo === undefined || (object(input.replyTo) && uid(input.replyTo.uid) && string(input.replyTo.folder) &&
          (input.replyTo.uidValidity === undefined || string(input.replyTo.uidValidity))))
      break
    }
  }
  if (!valid) throw new Error('请求参数无效')
}
