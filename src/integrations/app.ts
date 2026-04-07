import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { leagues, popularPlayers } from './catalog.ts'
import {
  CONTRACT_ADDRESSES,
  extractGenLayerErrorMessage,
  extractRawReceiptResult,
  extractSessionDataFromReceipt,
  normalizeSessionId,
  readSessionJson,
  safeJsonParse,
  writeAndWait
} from './genlayer.ts'

type Bindings = {
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', logger())
app.use('/api/*', cors())

app.get('/api/leagues', (c) => {
  return c.json({ leagues })
})

app.get('/api/players/popular', (c) => {
  return c.json({ players: popularPlayers })
})

app.get('/api/quiz/:category/:difficulty', async (c) => {
  const category = c.req.param('category')
  const difficulty = c.req.param('difficulty') as 'easy' | 'medium' | 'hard'
  const requestedCount = Number.parseInt(c.req.query('count') || '10', 10)
  const questionCount = Number.isFinite(requestedCount)
    ? Math.min(Math.max(requestedCount, 1), 20)
    : 10

  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    return c.json({ error: 'invalid_difficulty' }, 400)
  }

  const debugRequest = isDebugRequest(c)
  let debugContext: Record<string, unknown> = {}

  try {
    const normalizedDifficulty = normalizeDifficulty(difficulty)
    const contractAddress = resolveQuizContractAddress(category, normalizedDifficulty)
    const createSessionArgs = category === 'players'
      ? ['General Football Players', normalizedDifficulty, questionCount]
      : [category, questionCount]

    const tx = await writeAndWait({
      address: contractAddress,
      functionName: 'create_session',
      args: createSessionArgs
    })

    // Parse readable session payload directly from receipt first.
    const writeResult = extractRawReceiptResult(tx.receipt)
    const sessionIdFromReceipt = normalizeSessionId(writeResult) || normalizeSessionId(tx.receipt)
    let resolvedSessionId = sessionIdFromReceipt
    const sessionFromReceipt = extractSessionDataFromReceipt(tx.receipt)
    let parsedSession: Record<string, unknown> | null = sessionFromReceipt
    let usedStorageFallback = false
    let storageFallbackError: string | null = null
    debugContext = {
      writeResult,
      sessionIdFromReceipt,
      resolvedSessionId,
      sessionFromReceipt,
      receipt: tx.receipt
    }

    // Fallback for legacy contracts that don't return session JSON in receipt.
    if (!parsedSession) {
      usedStorageFallback = true
      try {
        const { sessionJson, sessionId } = await readSessionJson({
          contractAddress,
          sessionId: sessionIdFromReceipt
        })
        resolvedSessionId = sessionId

        const parsedFromStorage = safeJsonParse(sessionJson)
        if (!parsedFromStorage || typeof parsedFromStorage !== 'object') {
          return c.json({ error: 'invalid_session_json' }, 502)
        }
        parsedSession = parsedFromStorage as Record<string, unknown>
      } catch (storageError) {
        storageFallbackError = toErrorMessage(storageError)
      }
    }
    if (!parsedSession) {
      const responsePayload: Record<string, unknown> = {
        error: 'missing_session_payload_from_receipt',
        details: storageFallbackError || 'receipt_did_not_contain_questions'
      }
      if (debugRequest) {
        responsePayload.debug = toJsonSafe({
          ...debugContext,
          resolvedSessionId,
          usedStorageFallback,
          storageFallbackError
        })
      }
      return c.json(responsePayload, 502)
    }
    if (!resolvedSessionId) resolvedSessionId = normalizeSessionId(parsedSession)

    const questions = mapSessionToQuestions({
      sessionData: parsedSession,
      category,
      difficulty
    })

    if (questions.length === 0) {
      return c.json({ error: 'empty_questions' }, 502)
    }

    const responsePayload: Record<string, unknown> = {
      questions,
      total: questions.length,
      category,
      difficulty,
      sessionId: resolvedSessionId,
      txHash: tx.hash,
      txStatus: 'ACCEPTED',
      source: 'genlayer'
    }
    if (debugRequest) {
      responsePayload.debug = toJsonSafe({
        ...debugContext,
        resolvedSessionId,
        usedStorageFallback,
        storageFallbackError
      })
    }

    return c.json(responsePayload)
  } catch (error) {
    console.error('❌ Error: quiz_contract_call_failed', error)
    const responsePayload: Record<string, unknown> = {
      error: 'quiz_contract_call_failed',
      details: toErrorMessage(error)
    }
    if (debugRequest && Object.keys(debugContext).length > 0) {
      responsePayload.debug = toJsonSafe(debugContext)
    }
    return c.json(responsePayload, 502)
  }
})

app.post('/api/quiz/validate', async (c) => {
  const body = await c.req.json()
  const category = String(body.category || '')
  const difficulty = String(body.difficulty || 'medium') as 'easy' | 'medium' | 'hard'
  const sessionId = String(body.sessionId || '')
  const answers = body.answers

  if (!sessionId || !/^\d+$/.test(sessionId)) {
    return c.json({ error: 'invalid_session_id' }, 400)
  }
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    return c.json({ error: 'invalid_difficulty' }, 400)
  }

  const debugRequest = isDebugRequest(c)
  let debugContext: Record<string, unknown> = {}

  try {
    const normalizedDifficulty = normalizeDifficulty(difficulty)
    const contractAddress = resolveQuizContractAddress(category, normalizedDifficulty)

    const safeSessionNumber = toSafeNumber(sessionId)
    const answersPayload = JSON.stringify(answers ?? [])
    const sessionIdVariants: unknown[] = [BigInt(sessionId), sessionId]
    if (safeSessionNumber !== null) sessionIdVariants.push(safeSessionNumber)

    const tx = await writeWithArgVariants({
      address: contractAddress,
      functionName: 'validate_session',
      argVariants: sessionIdVariants.map((id) => [id, answersPayload])
    })

    // Parse validation output from raw receipt.
    const raw = extractRawReceiptResult(tx.receipt)
    const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw

    const responsePayload: Record<string, unknown> = {
      result: parsed ?? raw,
      txHash: tx.hash,
      txStatus: 'ACCEPTED',
      source: 'genlayer'
    }
    if (debugRequest) {
      responsePayload.debug = toJsonSafe({
        raw,
        parsed,
        receipt: tx.receipt
      })
    }

    return c.json(responsePayload)
  } catch (error) {
    console.error('❌ Error: validate_contract_call_failed', error)
    return c.json({
      error: 'validate_contract_call_failed',
      details: toErrorMessage(error)
    }, 502)
  }
})

app.post('/api/ai/chat', async (c) => {
  const body = await c.req.json()
  const message = String(body.message || '').trim()

  if (!message) {
    return c.json({ error: 'empty_message' }, 400)
  }

  const debugRequest = isDebugRequest(c)
  let debugContext: Record<string, unknown> = {}

  try {
    const tx = await writeAndWait({
      address: CONTRACT_ADDRESSES.aiChat,
      functionName: 'send_message',
      args: [message]
    })

    // Parse AI output from raw receipt.
    const raw = extractRawReceiptResult(tx.receipt)
    const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw
    const parsedRecord = parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null

    const reply = typeof parsedRecord?.reply === 'string'
      ? parsedRecord.reply
      : typeof raw === 'string'
        ? raw
        : JSON.stringify(raw)

    const responsePayload: Record<string, unknown> = {
      reply,
      parsed: parsedRecord,
      txHash: tx.hash,
      txStatus: 'ACCEPTED',
      source: 'genlayer'
    }
    if (debugRequest) {
      responsePayload.debug = toJsonSafe({
        raw,
        parsed,
        receipt: tx.receipt
      })
    }

    return c.json(responsePayload)
  } catch (error) {
    console.error('❌ Error: ai_contract_call_failed', error)
    return c.json({
      error: 'ai_contract_call_failed',
      details: toErrorMessage(error)
    }, 502)
  }
})

app.post('/api/ai/player-quiz', async (c) => {
  const body = await c.req.json()
  const playerName = String(body.playerName || '').trim()
  const difficulty = String(body.difficulty || 'medium') as 'easy' | 'medium' | 'hard'

  if (!playerName) {
    return c.json({ error: 'invalid_player_name' }, 400)
  }
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    return c.json({ error: 'invalid_difficulty' }, 400)
  }

  const debugRequest = isDebugRequest(c)
  let debugContext: Record<string, unknown> = {}

  try {
    const normalizedDifficulty = normalizeDifficulty(difficulty)
    const difficultyVariants = Array.from(new Set([normalizedDifficulty, difficulty]))
    const countVariants: unknown[] = [5, 5n, '5']

    const tx = await writeWithArgVariants({
      address: CONTRACT_ADDRESSES.playerQuiz,
      functionName: 'create_session',
      argVariants: [
        ...difficultyVariants.flatMap((diff) => countVariants.map((count) => [playerName, diff, count])),
        ...difficultyVariants.flatMap((diff) => countVariants.map((count) => [diff, playerName, count]))
      ]
    })

    // Parse readable session payload directly from receipt first.
    const writeResult = extractRawReceiptResult(tx.receipt)
    const sessionIdFromReceipt = normalizeSessionId(writeResult) || normalizeSessionId(tx.receipt)
    let resolvedSessionId = sessionIdFromReceipt
    const sessionFromReceipt = extractSessionDataFromReceipt(tx.receipt)
    let parsedSession: Record<string, unknown> | null = sessionFromReceipt
    let usedStorageFallback = false
    let storageFallbackError: string | null = null
    debugContext = {
      writeResult,
      sessionIdFromReceipt,
      resolvedSessionId,
      sessionFromReceipt,
      receipt: tx.receipt
    }

    // Fallback for legacy contracts that don't return session JSON in receipt.
    if (!parsedSession) {
      usedStorageFallback = true
      try {
        const { sessionJson, sessionId } = await readSessionJson({
          contractAddress: CONTRACT_ADDRESSES.playerQuiz,
          sessionId: sessionIdFromReceipt
        })
        resolvedSessionId = sessionId

        const parsedFromStorage = safeJsonParse(sessionJson)
        if (!parsedFromStorage || typeof parsedFromStorage !== 'object') {
          return c.json({ error: 'invalid_player_session_json' }, 502)
        }
        parsedSession = parsedFromStorage as Record<string, unknown>
      } catch (storageError) {
        storageFallbackError = toErrorMessage(storageError)
      }
    }
    if (!parsedSession) {
      const responsePayload: Record<string, unknown> = {
        error: 'missing_player_session_payload_from_receipt',
        details: storageFallbackError || 'receipt_did_not_contain_questions'
      }
      if (debugRequest) {
        responsePayload.debug = toJsonSafe({
          ...debugContext,
          resolvedSessionId,
          usedStorageFallback,
          storageFallbackError
        })
      }
      return c.json(responsePayload, 502)
    }
    if (!resolvedSessionId) resolvedSessionId = normalizeSessionId(parsedSession)

    const questions = mapSessionToQuestions({
      sessionData: parsedSession,
      category: 'players',
      difficulty
    })

    if (questions.length === 0) {
      return c.json({ error: 'empty_player_questions' }, 502)
    }

    const responsePayload: Record<string, unknown> = {
      questions,
      player: playerName,
      sessionId: resolvedSessionId,
      txHash: tx.hash,
      txStatus: 'ACCEPTED',
      source: 'genlayer'
    }
    if (debugRequest) {
      responsePayload.debug = toJsonSafe({
        ...debugContext,
        resolvedSessionId,
        usedStorageFallback,
        storageFallbackError
      })
    }

    return c.json(responsePayload)
  } catch (error) {
    console.error('❌ Error: player_contract_call_failed', error)
    const responsePayload: Record<string, unknown> = {
      error: 'player_contract_call_failed',
      details: toErrorMessage(error)
    }
    if (debugRequest && Object.keys(debugContext).length > 0) {
      responsePayload.debug = toJsonSafe(debugContext)
    }
    return c.json(responsePayload, 502)
  }
})

function normalizeDifficulty(difficulty: 'easy' | 'medium' | 'hard') {
  return difficulty === 'medium' ? 'mid' : difficulty
}

function resolveQuizContractAddress(category: string, normalizedDifficulty: 'easy' | 'mid' | 'hard') {
  if (category === 'players') return CONTRACT_ADDRESSES.playerQuiz
  if (normalizedDifficulty === 'easy') return CONTRACT_ADDRESSES.leagueEasyQuiz
  if (normalizedDifficulty === 'mid') return CONTRACT_ADDRESSES.leagueMidQuiz
  return CONTRACT_ADDRESSES.leagueHardQuiz
}

function isDebugRequest(c: {
  req: {
    query: (key: string) => string | undefined
    header: (name: string) => string | undefined
  }
}) {
  const queryFlag = String(c.req.query('debug') || '').trim().toLowerCase()
  const headerFlag = String(c.req.header('x-debug-receipt') || '').trim().toLowerCase()
  const truthy = new Set(['1', 'true', 'yes', 'on'])
  return truthy.has(queryFlag) || truthy.has(headerFlag)
}

function toJsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item, seen))
  if (typeof value !== 'object') return value

  const rec = value as Record<string, unknown>
  if (seen.has(rec)) return '[Circular]'
  seen.add(rec)

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rec)) {
    out[k] = toJsonSafe(v, seen)
  }
  return out
}

function toErrorMessage(error: unknown) {
  return extractGenLayerErrorMessage(error)
}

function toSafeNumber(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return null
  if (Math.abs(parsed) > Number.MAX_SAFE_INTEGER) return null
  return parsed
}

function isParamShapeError(error: unknown) {
  const reason = toErrorMessage(error).toLowerCase()
  return (
    reason.includes('missing or invalid parameters') ||
    reason.includes('invalid parameters') ||
    reason.includes('running contract failed') ||
    reason.includes('failed to parse')
  )
}

async function writeWithArgVariants({
  address,
  functionName,
  argVariants
}: {
  address: string
  functionName: string
  argVariants: unknown[][]
}) {
  let lastError: unknown = null
  for (const args of argVariants) {
    try {
      return await writeAndWait({ address, functionName, args })
    } catch (error) {
      lastError = error
      const reason = toErrorMessage(error)
      console.warn('⚠️ Contract variant failed', { functionName, args, reason })
      if (!isParamShapeError(error)) {
        throw error
      }
    }
  }

  throw lastError ?? new Error('write_contract_failed')
}

function mapSessionToQuestions({
  sessionData,
  category,
  difficulty
}: {
  sessionData: Record<string, unknown>
  category: string
  difficulty: 'easy' | 'medium' | 'hard'
}) {
  const rawQuestions = Array.isArray(sessionData.questions) ? sessionData.questions : []

  return rawQuestions
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const q = entry as Record<string, unknown>
      const options = Array.isArray(q.options)
        ? q.options.map((opt) => String(opt))
        : []

      return {
        id: `gl_${category}_${Date.now()}_${index}`,
        question: String(q.question || ''),
        options,
        answer: String(q.answer || ''),
        difficulty,
        category,
        explanation: q.explanation ? String(q.explanation) : ''
      }
    })
    .filter((q) => q.question !== '' && q.options.length >= 2 && q.answer !== '')
}

export default app
