# { "Depends": "py-genlayer:test" }
from genlayer import *


class LeagueEasyQuiz(gl.Contract):
    next_session_id: u64
    sessions: TreeMap[u64, str]
    validation_results: TreeMap[u64, str]
    last_session_id: u64

    def __init__(self):
        self.next_session_id = u64(1)
        self.sessions = TreeMap()
        self.validation_results = TreeMap()
        self.last_session_id = u64(0)

    @gl.public.write
    def create_session(self, league_category: str, question_count: u32) -> u64:
        category = league_category.strip()
        if category == "":
            raise gl.Rollback("invalid_category")

        if question_count < u32(1) or question_count > u32(20):
            raise gl.Rollback("invalid_question_count")

        session_id = self.next_session_id

        prompt = (
            "Generate an EASY football league quiz session.\n"
            f"Category: {category}\n"
            f"Question count: {int(question_count)}\n\n"
            "Return ONLY pure JSON.\n"
            "No markdown. No code fences. No explanations.\n"
            "Schema:\n"
            "{"
            "\"category\":\"string\","
            "\"difficulty\":\"easy\","
            "\"questions\":["
            "{\"question\":\"string\",\"options\":[\"string\",\"string\",\"string\",\"string\"],\"answer\":\"string\",\"explanation\":\"string\"}"
            "]"
            "}"
        )

        session_json = gl.eq_principle.prompt_non_comparative(
            lambda: gl.nondet.exec_prompt(prompt),
            task="Create easy league quiz session",
            criteria="Must be valid pure JSON with exact schema and exact question count",
        )

        if session_json.strip() == "" or "```" in session_json:
            raise gl.Rollback("invalid_session_json")

        self.sessions[session_id] = session_json
        self.last_session_id = session_id
        self.next_session_id = session_id + u64(1)
        return session_id

    @gl.public.write
    def validate_session(self, session_id: u64, answers_json: str) -> str:
        if answers_json.strip() == "":
            raise gl.Rollback("invalid_answers")

        sessions_mem = gl.storage.copy_to_memory(self.sessions)
        session_json = sessions_mem.get(session_id, "")

        if session_json == "":
            raise gl.Rollback("session_not_found")

        def nd_logic():
            prompt = (
                "Validate an EASY football league quiz attempt.\n"
                f"Session JSON: {session_json}\n"
                f"Answers JSON: {answers_json}\n\n"
                "Return ONLY pure JSON.\n"
                "No markdown. No code fences. No explanations.\n"
                "Schema:\n"
                "{"
                "\"correct\":number,"
                "\"total\":number,"
                "\"score_percent\":number,"
                "\"grade\":\"string\""
                "}"
            )
            return gl.nondet.exec_prompt(prompt)

        validation_json = gl.eq_principle.prompt_non_comparative(
            nd_logic,
            task="Validate easy league quiz session",
            criteria="Must be valid pure JSON with scoring fields",
        )

        if validation_json.strip() == "" or "```" in validation_json:
            raise gl.Rollback("invalid_validation_json")

        self.validation_results[session_id] = validation_json
        return validation_json
