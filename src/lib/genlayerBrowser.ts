import {
  CONTRACT_ADDRESSES,
  extractGenLayerErrorMessage,
  extractRawReceiptResult,
  extractSessionDataFromReceipt,
  normalizeSessionId,
  readSessionJson,
  safeJsonParse,
  writeAndWait,
} from "../integrations/genlayer.ts";

type Difficulty = "easy" | "medium" | "hard";

type SessionQuestion = {
  id: string;
  question: string;
  options: string[];
  answer: string;
  difficulty: Difficulty;
  category: string;
  explanation: string;
};

function normalizeDifficulty(difficulty: Difficulty) {
  return difficulty === "medium" ? "mid" : difficulty;
}

function resolveQuizContractAddress(category: string, normalizedDifficulty: "easy" | "mid" | "hard") {
  if (category === "players") return CONTRACT_ADDRESSES.playerQuiz;
  if (normalizedDifficulty === "easy") return CONTRACT_ADDRESSES.leagueEasyQuiz;
  if (normalizedDifficulty === "mid") return CONTRACT_ADDRESSES.leagueMidQuiz;
  return CONTRACT_ADDRESSES.leagueHardQuiz;
}

function toSafeNumber(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  if (Math.abs(parsed) > Number.MAX_SAFE_INTEGER) return null;
  return parsed;
}

function isParamShapeError(error: unknown) {
  const reason = extractGenLayerErrorMessage(error).toLowerCase();
  return (
    reason.includes("missing or invalid parameters") ||
    reason.includes("invalid parameters") ||
    reason.includes("running contract failed") ||
    reason.includes("failed to parse")
  );
}

async function writeWithArgVariants({
  address,
  functionName,
  argVariants,
}: {
  address: string;
  functionName: string;
  argVariants: unknown[][];
}) {
  let lastError: unknown = null;
  for (const args of argVariants) {
    try {
      return await writeAndWait({ address, functionName, args });
    } catch (error) {
      lastError = error;
      if (!isParamShapeError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("write_contract_failed");
}

function mapSessionToQuestions({
  sessionData,
  category,
  difficulty,
}: {
  sessionData: Record<string, unknown>;
  category: string;
  difficulty: Difficulty;
}): SessionQuestion[] {
  const rawQuestions = Array.isArray(sessionData.questions) ? sessionData.questions : [];

  return rawQuestions
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const q = entry as Record<string, unknown>;
      const options = Array.isArray(q.options) ? q.options.map((opt) => String(opt)) : [];

      return {
        id: `gl_${category}_${Date.now()}_${index}`,
        question: String(q.question || ""),
        options,
        answer: String(q.answer || ""),
        difficulty,
        category,
        explanation: q.explanation ? String(q.explanation) : "",
      };
    })
    .filter((q) => q.question !== "" && q.options.length >= 2 && q.answer !== "");
}

async function resolveSessionFromReceipt({
  contractAddress,
  receipt,
}: {
  contractAddress: string;
  receipt: unknown;
}) {
  const writeResult = extractRawReceiptResult(receipt);
  const sessionIdFromReceipt = normalizeSessionId(writeResult) || normalizeSessionId(receipt);
  let resolvedSessionId = sessionIdFromReceipt;
  let parsedSession = extractSessionDataFromReceipt(receipt);

  if (!parsedSession) {
    const { sessionJson, sessionId } = await readSessionJson({
      contractAddress,
      sessionId: sessionIdFromReceipt,
    });
    resolvedSessionId = sessionId;
    const parsedFromStorage = safeJsonParse(sessionJson);
    if (!parsedFromStorage || typeof parsedFromStorage !== "object") {
      throw new Error("invalid_session_json");
    }
    parsedSession = parsedFromStorage as Record<string, unknown>;
  }

  if (!resolvedSessionId) {
    resolvedSessionId = normalizeSessionId(parsedSession);
  }

  return {
    sessionId: resolvedSessionId,
    sessionData: parsedSession,
  };
}

export async function fetchLeagueQuiz({
  category,
  difficulty,
  count,
}: {
  category: string;
  difficulty: Difficulty;
  count: number;
}) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const contractAddress = resolveQuizContractAddress(category, normalizedDifficulty);
  const createSessionArgs =
    category === "players" ? ["General Football Players", normalizedDifficulty, count] : [category, count];

  const tx = await writeAndWait({
    address: contractAddress,
    functionName: "create_session",
    args: createSessionArgs,
  });

  const { sessionId, sessionData } = await resolveSessionFromReceipt({
    contractAddress,
    receipt: tx.receipt,
  });

  const questions = mapSessionToQuestions({
    sessionData,
    category,
    difficulty,
  });

  return {
    questions,
    sessionId,
    txHash: tx.hash,
  };
}

export async function fetchPlayerQuiz({
  playerName,
  difficulty,
}: {
  playerName: string;
  difficulty: Difficulty;
}) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const difficultyVariants = Array.from(new Set([normalizedDifficulty, difficulty]));
  const countVariants: unknown[] = [5, 5n, "5"];

  const tx = await writeWithArgVariants({
    address: CONTRACT_ADDRESSES.playerQuiz,
    functionName: "create_session",
    argVariants: [
      ...difficultyVariants.flatMap((diff) => countVariants.map((count) => [playerName, diff, count])),
      ...difficultyVariants.flatMap((diff) => countVariants.map((count) => [diff, playerName, count])),
    ],
  });

  const { sessionId, sessionData } = await resolveSessionFromReceipt({
    contractAddress: CONTRACT_ADDRESSES.playerQuiz,
    receipt: tx.receipt,
  });

  const questions = mapSessionToQuestions({
    sessionData,
    category: "players",
    difficulty,
  });

  return {
    questions,
    sessionId,
    txHash: tx.hash,
  };
}

export async function sendAiChatMessage({
  message,
}: {
  message: string;
}) {
  const tx = await writeAndWait({
    address: CONTRACT_ADDRESSES.aiChat,
    functionName: "send_message",
    args: [message],
  });

  const raw = extractRawReceiptResult(tx.receipt);
  const parsed = typeof raw === "string" ? safeJsonParse(raw) : raw;
  const parsedRecord = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const reply =
    typeof parsedRecord?.reply === "string"
      ? parsedRecord.reply
      : typeof raw === "string"
        ? raw
        : JSON.stringify(raw);

  return {
    reply,
    parsed: parsedRecord,
    txHash: tx.hash,
  };
}
