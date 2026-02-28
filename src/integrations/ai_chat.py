# { "Depends": "py-genlayer:test" }

from genlayer import *
import json

class AIChat(gl.Contract):
    # Persistent state variables must be declared in the class body [3, 4]
    system_prompt: str
    roles: DynArray[str]
    messages: DynArray[str]
    last_reply_json: str

    def __init__(self):
        # Basic types are initialized here. DynArrays are auto-initialized to [] [5, 6].
        self.system_prompt = "You are strikerlab football assistant. Be accurate and concise."
        self.last_reply_json = "{}"

    @gl.public.write
    def set_system_prompt(self, prompt_text: str):
        prompt_clean = prompt_text.strip()
        if prompt_clean == "":
            # gl.UserError is preferred for input validation [7]
            raise gl.UserError("invalid_prompt")
        self.system_prompt = prompt_clean

    @gl.public.write
    def send_message(self, message: str) -> str:
        user_message = message.strip()
        if user_message == "":
            raise gl.UserError("empty_message")

        # Update persistent history
        self.roles.append("user")
        self.messages.append(user_message)

        # Build conversation history as a string. 
        # Strings are basic types and do not require copy_to_memory [8].
        history_str = f"System Instruction: {self.system_prompt}\n"
        for role, msg in zip(self.roles, self.messages):
            history_str += f"{role.upper()}: {msg}\n"

        # FIX: Pass the history string POSITIONALLY as the first argument.
        # Use a lambda to provide the prompt context to the leader [1, 2].
        # This avoids the "unexpected keyword argument 'input'" error [VM Error Log].
        reply_raw = gl.eq_principle.prompt_non_comparative(
            lambda: history_str,
            task="As a football assistant, provide a helpful reply to the user's last message.",
            criteria="""
            Output must be PURE JSON. No markdown code blocks (no ```).
            Schema: {"reply": "string", "topic": "string", "confidence": "low|medium|high"}
            """
        )

        # Clean potential markdown formatting if the model ignores criteria [9, 10]
        reply_json = reply_raw.replace("```json", "").replace("```", "").strip()

        # Update persistent history with assistant's response
        self.roles.append("assistant")
        self.messages.append(reply_json)
        self.last_reply_json = reply_json

        return reply_json

    @gl.public.view
    def get_last_reply(self) -> str:
        return self.last_reply_json

    @gl.public.view
    def get_history_count(self) -> u32:
        # DynArray supports the standard len() function [11]
        return u32(len(self.messages))