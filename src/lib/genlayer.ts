import { createAccount, createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'

type JsonRecord = Record<string, unknown>

export const CONTRACT_ADDRESSES = {
  aiChat: '0x6db493A28F206C679bbf7c8CF0224b64a978f2ae',
  leagueEasyQuiz: '0x4426CdAD2B1a4E8e52B292E4c496D0C542bE5524',
  leagueMidQuiz: '0xc3c78D6D345b31a60e74eC779075c7C5a786c50f',
  leagueHardQuiz: '0x3ad5883511F9a48E4b1cA2539e1876E0A4c02F15',
  playerQuiz: '0xC0bE4Cb9A51691896F2886A04d5867bb4Bde02b9'
} as const

let clientPromise: Promise<ReturnType<typeof createClient>> | null = null

function getPrivateKey(): `0x${string}` {
  const raw = (process.env.VITE_GENLAYER_KEY || '').trim()
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
  const hash = await client.writeContract({
    address: address as `0x${string}`,
    functionName,
    args: args as never[],
    value: 0n
  })

  console.info(`⚠️ Transaction Pending... ${functionName} ${hash}`)
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: 'ACCEPTED',
    retries: 150,
    interval: 2000
  })

  console.info(`✅ Transaction Accepted ${functionName} ${hash}`)
  return { hash, receipt }
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
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
    eqOutputs
  ]

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    const normalized = unwrapCommonResultKeys(candidate)
    const parsed = safeJsonParse(normalized)
    if (parsed !== null) return unwrapCommonResultKeys(parsed)
    return normalized
  }

  throw new Error('missing_receipt_result')
}

export function normalizeSessionId(result: unknown): string | null {
  if (typeof result === 'bigint') return result.toString()
  if (typeof result === 'number' && Number.isFinite(result)) return String(Math.trunc(result))
  if (typeof result === 'string') {
    const trimmed = result.trim()
    if (/^\d+$/.test(trimmed)) return trimmed
    const parsed = safeJsonParse(trimmed)
    if (parsed !== null) return normalizeSessionId(parsed)
  }
  const rec = asRecord(result)
  if (!rec) return null
  if ('session_id' in rec) return normalizeSessionId(rec.session_id)
  if ('sessionId' in rec) return normalizeSessionId(rec.sessionId)
  if ('id' in rec) return normalizeSessionId(rec.id)
  if ('result' in rec) return normalizeSessionId(rec.result)
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
