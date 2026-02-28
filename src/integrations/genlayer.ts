import { createAccount, createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'

type JsonRecord = Record<string, unknown>
const GENERIC_ERROR_TEXT = new Set([
  'running contract failed',
  'missing or invalid parameters.',
  'double check you have provided the correct parameters.',
  'execution reverted'
])

function getRequiredEnv(name: string): string {
  const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const fromVite = (import.meta as { env?: Record<string, string | undefined> }).env?.[name]
  const value = String(fromProcess || fromVite || '').trim()
  if (!value) {
    throw new Error(`missing_env_${name.toLowerCase()}`)
  }
  return value
}

function normalizeAddress(value: string): `0x${string}` {
  const address = value.startsWith('0x') ? value : `0x${value}`
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`invalid_contract_address_${value}`)
  }
  return address as `0x${string}`
}

let _contractAddresses: {
  aiChat: `0x${string}`
  leagueEasyQuiz: `0x${string}`
  leagueMidQuiz: `0x${string}`
  leagueHardQuiz: `0x${string}`
  playerQuiz: `0x${string}`
} | null = null

export function getContractAddresses() {
  if (!_contractAddresses) {
    _contractAddresses = {
      aiChat: normalizeAddress(getRequiredEnv('VITE_GENLAYER_CONTRACT_AI_CHAT')),
      leagueEasyQuiz: normalizeAddress(getRequiredEnv('VITE_GENLAYER_CONTRACT_LEAGUE_EASY')),
      leagueMidQuiz: normalizeAddress(getRequiredEnv('VITE_GENLAYER_CONTRACT_LEAGUE_MID')),
      leagueHardQuiz: normalizeAddress(getRequiredEnv('VITE_GENLAYER_CONTRACT_LEAGUE_HARD')),
      playerQuiz: normalizeAddress(getRequiredEnv('VITE_GENLAYER_CONTRACT_PLAYER_QUIZ'))
    }
  }
  return _contractAddresses
}

export const CONTRACT_ADDRESSES = new Proxy({} as NonNullable<typeof _contractAddresses>, {
  get(_, prop) {
    return getContractAddresses()[prop as keyof NonNullable<typeof _contractAddresses>]
  }
})

let clientPromise: Promise<ReturnType<typeof createClient>> | null = null
const contractSchemaCache = new Map<string, unknown>()

function getPrivateKey(): `0x${string}` {
  const raw = getRequiredEnv('VITE_GENLAYER_KEY')
  if (!raw) {
    throw new Error('missing_vite_genlayer_key')
  }
  return (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
}

export async function initializeGenLayer() {
  if (clientPromise) {
    return clientPromise
  }

  clientPromise = (async () => {
    const account = createAccount(getPrivateKey())
    const client = createClient({
      chain: studionet,
      account
    })

    console.info('⚠️ Initializing GenLayer Consensus...')
    await client.initializeConsensusSmartContract()
    console.info('✅ Consensus Initialized')
    return client
  })().catch((error) => {
    clientPromise = null
    throw error
  })

  return clientPromise
}

export async function writeAndWait({
  address,
  functionName,
  args = []
}: {
  address: string
  functionName: string
  args?: unknown[]
}) {
  const client = await initializeGenLayer()
  console.info('⚠️ Contract Call', { functionName, address, args })
  let hash: `0x${string}`
  try {
    hash = await client.writeContract({
      address: address as `0x${string}`,
      functionName,
      args: args as never[],
      value: 0n
    })
  } catch (error) {
    const reason = extractGenLayerErrorMessage(error)
    console.error(`❌ Error: write_contract_failed ${functionName} ${address} ${reason}`, error)
    throw new Error(reason)
  }

  console.info(`⚠️ Transaction Pending... ${functionName} ${hash}`)
  let receipt: unknown
  try {
    const acceptedReceipt = await client.waitForTransactionReceipt({
      hash,
      status: 'ACCEPTED',
      retries: 150,
      interval: 2000
    })
    receipt = acceptedReceipt
    try {
      // Fetch full tx body when available so receipt parsing can access readable fields.
      receipt = await client.getTransaction({ hash })
    } catch (fetchError) {
      console.warn(`⚠️ full_receipt_fetch_failed ${functionName} ${hash}`, fetchError)
    }
  } catch (error) {
    const reason = extractGenLayerErrorMessage(error)
    console.error(`❌ Error: wait_for_receipt_failed ${functionName} ${hash} ${reason}`, error)
    throw new Error(reason)
  }

  console.info(`✅ Transaction Accepted ${functionName} ${hash}`)
  return { hash, receipt }
}

export async function getContractSchema(address: string) {
  const normalized = address.toLowerCase()
  if (contractSchemaCache.has(normalized)) {
    return contractSchemaCache.get(normalized)
  }

  const client = await initializeGenLayer()
  const schema = await client.getContractSchema({
    address: address as `0x${string}`
  })
  contractSchemaCache.set(normalized, schema)
  return schema
}

export async function getMethodParamSpecs(
  address: string,
  functionName: string
): Promise<Array<{ name: string; type: string }>> {
  const schema = await getContractSchema(address)
  const schemaRec = asRecord(schema)
  const methodsRec = asRecord(schemaRec?.methods)
  const methodRec = asRecord(methodsRec?.[functionName])
  if (!methodRec) {
    throw new Error(`method_not_found_${functionName}`)
  }

  const paramsRaw = methodRec.params
  if (!Array.isArray(paramsRaw)) return []

  const params: Array<{ name: string; type: string }> = []
  for (const item of paramsRaw) {
    if (!Array.isArray(item) || item.length < 2) continue
    params.push({
      name: String(item[0]),
      type: String(item[1])
    })
  }

  return params
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function collectStrings(input: unknown, bucket: string[], depth = 0) {
  if (depth > 8 || bucket.length > 300) return
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed) bucket.push(trimmed)
    return
  }
  if (!input || typeof input !== 'object') return
  if (Array.isArray(input)) {
    for (const item of input) {
      collectStrings(item, bucket, depth + 1)
    }
    return
  }
  for (const value of Object.values(input as JsonRecord)) {
    collectStrings(value, bucket, depth + 1)
  }
}

function scoreErrorCandidate(text: string): number {
  const lower = text.toLowerCase()
  let score = 0
  if (/^[a-z0-9_]+$/.test(text) && text.includes('_')) score += 6
  if (/(invalid_|session_|empty_|not_found|rollback|consensus|failed)/i.test(text)) score += 4
  if (text.length <= 90) score += 2
  if (GENERIC_ERROR_TEXT.has(lower)) score -= 8
  return score
}

export function extractGenLayerErrorMessage(error: unknown): string {
  const candidates: string[] = []

  if (error instanceof Error && error.message) {
    candidates.push(error.message)
  }

  const rec = asRecord(error)
  if (rec) {
    if (typeof rec.details === 'string') candidates.push(rec.details)
    if (typeof rec.shortMessage === 'string') candidates.push(rec.shortMessage)
    if (typeof rec.message === 'string') candidates.push(rec.message)

    const cause = asRecord(rec.cause)
    if (cause) {
      if (typeof cause.message === 'string') candidates.push(cause.message)
      const causeData = asRecord(cause.data)
      if (causeData?.receipt !== undefined) {
        collectStrings(causeData.receipt, candidates)
      }
      if (causeData?.params !== undefined) {
        collectStrings(causeData.params, candidates)
      }
    }
  }

  const unique = Array.from(new Set(candidates.map((s) => s.trim()).filter(Boolean)))
  if (unique.length === 0) return 'unknown_error'

  let best = unique[0]
  let bestScore = scoreErrorCandidate(best)
  for (const text of unique.slice(1)) {
    const score = scoreErrorCandidate(text)
    if (score > bestScore) {
      best = text
      bestScore = score
    }
  }

  if (GENERIC_ERROR_TEXT.has(best.toLowerCase())) {
    return unique.find((t) => !GENERIC_ERROR_TEXT.has(t.toLowerCase())) || best
  }

  return best
}

function cleanText(value: string): string {
  return value
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim()
}

export function safeJsonParse(value: unknown): unknown | null {
  if (typeof value !== 'string') return null
  const cleaned = cleanText(value)
  if (!cleaned) return null
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

function unwrapCommonResultKeys(input: unknown): unknown {
  let current = input
  for (let i = 0; i < 6; i++) {
    const rec = asRecord(current)
    if (!rec) break
    if ('result' in rec) {
      current = rec.result
      continue
    }
    if ('output' in rec) {
      current = rec.output
      continue
    }
    if ('value' in rec) {
      current = rec.value
      continue
    }
    break
  }
  return current
}

function unwrapReadableResultKeys(input: unknown): unknown {
  let current = input
  for (let i = 0; i < 6; i++) {
    const rec = asRecord(current)
    if (!rec) break
    if ('payload' in rec) {
      current = rec.payload
      continue
    }
    if ('readable' in rec) {
      current = rec.readable
      continue
    }
    break
  }
  return current
}

function normalizeReceiptValue(input: unknown): unknown {
  let current = unwrapReadableResultKeys(unwrapCommonResultKeys(input))
  for (let i = 0; i < 8; i++) {
    if (typeof current !== 'string') {
      return unwrapReadableResultKeys(unwrapCommonResultKeys(current))
    }
    const parsed = safeJsonParse(current)
    if (parsed === null) return current
    current = unwrapReadableResultKeys(unwrapCommonResultKeys(parsed))
  }
  return current
}

export function extractRawReceiptResult(receipt: unknown): unknown {
  const rec = asRecord(receipt)
  const consensus = asRecord(rec?.consensus_data)
  const leaderReceiptRaw = consensus?.leader_receipt

  let leader: unknown = null
  if (Array.isArray(leaderReceiptRaw)) {
    leader = leaderReceiptRaw[0]
  } else {
    leader = leaderReceiptRaw
  }

  const leaderRec = asRecord(leader)
  const eqOutputs = asRecord(leaderRec?.eq_outputs)
  const candidates = [
    leaderRec?.result,
    leaderRec?.execution_result,
    eqOutputs?.result,
    eqOutputs,
    findDeepKey(leaderRec, 'readable')
  ]

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    const normalized = normalizeReceiptValue(candidate)
    if (normalized !== undefined && normalized !== null) {
      return normalized
    }
  }

  throw new Error('missing_receipt_result')
}

function normalizeSessionIdInternal(result: unknown, seen: Set<unknown>): string | null {
  if (typeof result === 'bigint') return result.toString()
  if (typeof result === 'number' && Number.isFinite(result)) return String(Math.trunc(result))
  if (typeof result === 'string') {
    const trimmed = result.trim()
    if (/^\d+$/.test(trimmed)) return trimmed
    const parsed = safeJsonParse(trimmed)
    if (parsed !== null) return normalizeSessionIdInternal(parsed, seen)
  }
  if (Array.isArray(result)) {
    for (const entry of result) {
      const nested = normalizeSessionIdInternal(entry, seen)
      if (nested) return nested
    }
    return null
  }
  const rec = asRecord(result)
  if (!rec) return null
  if (seen.has(rec)) return null
  seen.add(rec)

  const directCandidates: unknown[] = []
  if ('session_id' in rec) directCandidates.push(rec.session_id)
  if ('sessionId' in rec) directCandidates.push(rec.sessionId)
  if ('id' in rec) directCandidates.push(rec.id)
  if ('result' in rec) directCandidates.push(rec.result)
  if ('payload' in rec) directCandidates.push(rec.payload)
  if ('readable' in rec) directCandidates.push(rec.readable)
  if ('value' in rec) directCandidates.push(rec.value)
  if ('output' in rec) directCandidates.push(rec.output)
  if ('data' in rec) directCandidates.push(rec.data)
  if ('session' in rec) directCandidates.push(rec.session)

  for (const candidate of directCandidates) {
    const nested = normalizeSessionIdInternal(candidate, seen)
    if (nested) return nested
  }

  return null
}

export function normalizeSessionId(result: unknown): string | null {
  return normalizeSessionIdInternal(result, new Set())
}

function tryExtractSessionData(value: unknown): Record<string, unknown> | null {
  const normalized = normalizeReceiptValue(value)
  const rec = asRecord(normalized)
  if (!rec) return null
  if (Array.isArray(rec.questions)) return rec

  const embeddedCandidates: unknown[] = []
  if ('session_json' in rec) embeddedCandidates.push(rec.session_json)
  if ('sessionJson' in rec) embeddedCandidates.push(rec.sessionJson)
  if ('session' in rec) embeddedCandidates.push(rec.session)

  for (const candidate of embeddedCandidates) {
    const candidateNormalized = normalizeReceiptValue(candidate)
    const candidateRec = asRecord(candidateNormalized)
    if (candidateRec && Array.isArray(candidateRec.questions)) return candidateRec
    const parsed = safeJsonParse(candidateNormalized)
    const parsedRec = asRecord(parsed)
    if (parsedRec && Array.isArray(parsedRec.questions)) return parsedRec
  }

  return null
}

export function extractSessionDataFromReceipt(receipt: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [receipt]
  try {
    queue.unshift(extractRawReceiptResult(receipt))
  } catch {
    // Ignore and keep scanning raw receipt below.
  }

  const seen = new Set<unknown>()
  let traversed = 0
  while (queue.length > 0 && traversed < 800) {
    traversed += 1
    const current = queue.shift()
    if (current === undefined || current === null) continue

    const sessionData = tryExtractSessionData(current)
    if (sessionData) return sessionData

    if (typeof current === 'string') {
      const parsed = safeJsonParse(current)
      if (parsed !== null) queue.push(parsed)
      continue
    }
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item)
      continue
    }

    const rec = asRecord(current)
    if (!rec) continue
    if (seen.has(rec)) continue
    seen.add(rec)

    for (const value of Object.values(rec)) {
      queue.push(value)
    }
  }

  return null
}

function findDeepKey(input: unknown, key: string): unknown {
  if (!input || typeof input !== 'object') return null
  if (Array.isArray(input)) {
    for (const entry of input) {
      const found = findDeepKey(entry, key)
      if (found !== null && found !== undefined) return found
    }
    return null
  }
  const rec = input as JsonRecord
  if (key in rec) return rec[key]
  for (const value of Object.values(rec)) {
    const found = findDeepKey(value, key)
    if (found !== null && found !== undefined) return found
  }
  return null
}

function normalizeMap(input: unknown): Record<string, unknown> {
  if (!input) return {}
  if (Array.isArray(input)) {
    const fromArray: Record<string, unknown> = {}
    for (const entry of input) {
      if (Array.isArray(entry) && entry.length >= 2) {
        fromArray[String(entry[0])] = entry[1]
      }
    }
    return fromArray
  }
  const rec = asRecord(input)
  if (!rec) return {}
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [String(k), v]))
}

function latestNumericKey(record: Record<string, unknown>): string | null {
  const keys = Object.keys(record).filter((k) => /^\d+$/.test(k))
  if (keys.length === 0) return null
  keys.sort((a, b) => Number(a) - Number(b))
  return keys[keys.length - 1]
}

export async function readSessionJson({
  contractAddress,
  sessionId
}: {
  contractAddress: string
  sessionId: string | null
}) {
  const client = await initializeGenLayer()
  const callerAddress = (client as unknown as { account?: { address?: string } }).account?.address || null
  console.log('🔍 gen_call params:', {
    contractAddress,
    functionName: 'get_complete_storage',
    args: [],
    sessionId,
    callerAddress
  })

  const storage = await client.readContract({
    address: contractAddress as `0x${string}`,
    functionName: 'get_complete_storage',
    args: []
  })

  const sessionsRaw = findDeepKey(storage, 'sessions')
  const sessions = normalizeMap(sessionsRaw)
  const resolvedSessionId = sessionId || latestNumericKey(sessions)
  if (!resolvedSessionId) {
    throw new Error('missing_session_id')
  }

  const sessionJson = sessions[resolvedSessionId]
  if (typeof sessionJson !== 'string' || sessionJson.trim() === '') {
    throw new Error('missing_session_json')
  }

  return { sessionId: resolvedSessionId, sessionJson, storage }
}
