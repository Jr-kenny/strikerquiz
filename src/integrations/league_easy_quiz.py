# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json


class PlayerQuiz(gl.Contract):
    next_session_id: u64
    sessions: TreeMap[u64, str]
    validation_results: TreeMap[u64, str]
    last_session_id: u64

    def __init__(self) -> None:
        self.next_session_id = u64(1)
        self.last_session_id = u64(0)

    @gl.public.write
    def create_session(self, player_name: str, difficulty: str, question_count: u32) -> u64:
        player = player_name.strip()
        if player == "":
            raise gl.vm.UserError("invalid_player")

        diff = difficulty.strip().lower()
        if diff == "medium":
            diff = "mid"
        if diff not in ("easy", "mid", "hard"):
            raise gl.vm.UserError("invalid_difficulty")

        if question_count < u32(1) or question_count > u32(20):
            raise gl.vm.UserError("invalid_question_count")

        session_id = self.next_session_id

        prompt = (
            "Generate a football PLAYER quiz session.\n"
            f"Player: {player}\n"
            f"Difficulty: {diff}\n"
            f"Question count: {int(question_count)}\n\n"
            "Return ONLY pure JSON.\n"
            "No markdown. No code fences. No explanations.\n"
            "Schema:\n"
            "{"
            "\"player\":\"string\","
            "\"difficulty\":\"easy|mid|hard\","
            "\"questions\":["
            "{\"question\":\"string\",\"options\":[\"string\",\"string\",\"string\",\"string\"],\"answer\":\"string\",\"explanation\":\"string\"}"
            "]"
            "}"
        )

        def leader_fn():
            result = gl.nondet.exec_prompt(prompt, response_format="json")
            if not isinstance(result, dict):
                raise gl.vm.UserError("invalid_session_json")

            if not isinstance(result.get("player"), str) or result["player"].strip() == "":
                raise gl.vm.UserError("invalid_session_player")

            if result.get("difficulty") != diff:
                raise gl.vm.UserError("invalid_session_difficulty")

            questions = result.get("questions")
            if not isinstance(questions, list) or len(questions) != int(question_count):
                raise gl.vm.UserError("invalid_session_question_count")

            for question in questions:
                if not isinstance(question, dict):
                    raise gl.vm.UserError("invalid_question_item")
                if not isinstance(question.get("question"), str) or question["question"].strip() == "":
                    raise gl.vm.UserError("invalid_question_text")
                if not isinstance(question.get("answer"), str) or question["answer"].strip() == "":
                    raise gl.vm.UserError("invalid_question_answer")
                if not isinstance(question.get("explanation"), str):
                    raise gl.vm.UserError("invalid_question_explanation")

                options = question.get("options")
                if not isinstance(options, list) or len(options) != 4:
                    raise gl.vm.UserError("invalid_question_options")
                for option in options:
                    if not isinstance(option, str) or option.strip() == "":
                        raise gl.vm.UserError("invalid_option_value")

            return result

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False

            data = leader_result.calldata
            if not isinstance(data, dict):
                return False

            if data.get("difficulty") != diff:
                return False

            questions = data.get("questions")
            if not isinstance(questions, list) or len(questions) != int(question_count):
                return False

            for question in questions:
                if not isinstance(question, dict):
                    return False
                if not isinstance(question.get("question"), str):
                    return False
                if not isinstance(question.get("answer"), str):
                    return False
                if not isinstance(question.get("explanation"), str):
                    return False

                options = question.get("options")
                if not isinstance(options, list) or len(options) != 4:
                    return False
                for option in options:
                    if not isinstance(option, str):
                        return False

            return True

        session_obj = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        session_json = json.dumps(session_obj, sort_keys=True)

        self.sessions[session_id] = session_json
        self.last_session_id = session_id
        self.next_session_id = session_id + u64(1)
        return session_id

    @gl.public.write
    def validate_session(self, session_id: u64, answers_json: str) -> str:
        if answers_json.strip() == "":
            raise gl.vm.UserError("invalid_answers")

        session_json = self.sessions.get(session_id, "")
        if session_json == "":
            raise gl.vm.UserError("session_not_found")

        try:
            session_obj = json.loads(session_json)
        except Exception:
            raise gl.vm.UserError("corrupt_session_json")

        try:
            answers_obj = json.loads(answers_json)
        except Exception:
            raise gl.vm.UserError("invalid_answers_json")

        if not isinstance(answers_obj, list):
            raise gl.vm.UserError("answers_must_be_list")

        total_questions = len(session_obj.get("questions", []))
        if len(answers_obj) != total_questions:
            raise gl.vm.UserError("answer_count_mismatch")

        prompt = (
            "Validate a football PLAYER quiz attempt.\n"
            f"Session JSON: {json.dumps(session_obj, sort_keys=True)}\n"
            f"Answers JSON: {json.dumps(answers_obj, sort_keys=True)}\n\n"
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

        def leader_fn():
            result = gl.nondet.exec_prompt(prompt, response_format="json")
            if not isinstance(result, dict):
                raise gl.vm.UserError("invalid_validation_json")

            correct = result.get("correct")
            total = result.get("total")
            score_percent = result.get("score_percent")
            grade = result.get("grade")

            if not isinstance(correct, int):
                raise gl.vm.UserError("invalid_correct")
            if not isinstance(total, int) or total != total_questions:
                raise gl.vm.UserError("invalid_total")
            if not isinstance(score_percent, (int, float)):
                raise gl.vm.UserError("invalid_score_percent")
            if not isinstance(grade, str) or grade.strip() == "":
                raise gl.vm.UserError("invalid_grade")

            return result

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False

            data = leader_result.calldata
            if not isinstance(data, dict):
                return False

            correct = data.get("correct")
            total = data.get("total")
            score_percent = data.get("score_percent")
            grade = data.get("grade")

            if not isinstance(correct, int) or correct < 0 or correct > total_questions:
                return False
            if not isinstance(total, int) or total != total_questions:
                return False
            if not isinstance(score_percent, (int, float)) or score_percent < 0 or score_percent > 100:
                return False
            if not isinstance(grade, str) or grade.strip() == "":
                return False

            return True

        validation_obj = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        validation_json = json.dumps(validation_obj, sort_keys=True)

        self.validation_results[session_id] = validation_json
        return validation_json
