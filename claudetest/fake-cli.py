#!/usr/bin/env python3
"""A scripted stand-in for the `claude` CLI.

Speaks the same `--input-format stream-json` / `--output-format stream-json`
protocol as the real binary, but replays a fixed transcript instead of calling
a model. It exercises the parts of the client that a live conversation would
only cover by luck: streamed text and streamed tool-call arguments, a
permission round trip, an out-of-order tool result, and a subagent frame that
must not be merged into the main reply.

Nothing here is authentication-bound or billable, so it is the suite that can
run anywhere.
"""

import json
import sys


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def read_frame():
    line = sys.stdin.readline()
    if not line:
        return None
    line = line.strip()
    if not line:
        return read_frame()
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return read_frame()


SESSION = "fake-session-1"


def sys_frame(subtype, **fields):
    frame = {"type": "system", "subtype": subtype, "session_id": SESSION,
             "uuid": "u-sys-" + subtype}
    frame.update(fields)
    emit(frame)


def stream(event, parent=None):
    emit({"type": "stream_event", "session_id": SESSION, "uuid": "u-stream",
          "parent_tool_use_id": parent, "event": event})


def wait_for_control_response(request_id):
    """Blocks until the client answers this exact request."""
    while True:
        frame = read_frame()
        if frame is None:
            sys.exit(0)
        if frame.get("type") != "control_response":
            continue
        response = frame.get("response") or {}
        if response.get("request_id") == request_id:
            return response


def run_turn():
    sys_frame("init", session_id=SESSION, cwd="/tmp", model="claude-opus-5",
              permissionMode="default", tools=["Bash", "Read"],
              slash_commands=["compact"], mcp_servers=[])

    # --- A streamed reply: text, then a tool call whose arguments stream in
    # as JSON fragments. A client that renders the tool call before
    # content_block_stop would show invalid JSON.
    stream({"type": "message_start",
            "message": {"id": "msg_fake_1", "type": "message", "role": "assistant",
                        "model": "claude-opus-5", "content": [],
                        "usage": {"input_tokens": 100, "output_tokens": 0}}})
    stream({"type": "content_block_start", "index": 0,
            "content_block": {"type": "text", "text": ""}})
    for piece in ["Hello", " there", ", let me look."]:
        stream({"type": "content_block_delta", "index": 0,
                "delta": {"type": "text_delta", "text": piece}})
    stream({"type": "content_block_stop", "index": 0})

    stream({"type": "content_block_start", "index": 1,
            "content_block": {"type": "tool_use", "id": "toolu_fake_1",
                              "name": "Bash", "input": {}}})
    for piece in ['{"comm', 'and":"', 'ls"}']:
        stream({"type": "content_block_delta", "index": 1,
                "delta": {"type": "input_json_delta", "partial_json": piece}})
    stream({"type": "content_block_stop", "index": 1})
    stream({"type": "message_delta", "delta": {"stop_reason": "tool_use"},
            "usage": {"output_tokens": 30}})
    stream({"type": "message_stop"})

    # The complete frame the client must merge onto the streamed placeholder
    # rather than append after it.
    emit({"type": "assistant", "uuid": "u-assistant-1", "session_id": SESSION,
          "parent_tool_use_id": None,
          "message": {"id": "msg_fake_1", "type": "message", "role": "assistant",
                      "model": "claude-opus-5",
                      "content": [
                          {"type": "text", "text": "Hello there, let me look."},
                          {"type": "tool_use", "id": "toolu_fake_1", "name": "Bash",
                           "input": {"command": "ls"}}],
                      "stop_reason": "tool_use",
                      "usage": {"input_tokens": 100, "cache_read_input_tokens": 20,
                                "output_tokens": 30}}})

    # --- Permission round trip.
    emit({"type": "control_request", "request_id": "perm-1",
          "request": {"subtype": "can_use_tool", "tool_name": "Bash",
                      "tool_use_id": "toolu_fake_1",
                      "input": {"command": "ls"},
                      "permission_suggestions": [
                          {"type": "addRules", "behavior": "allow",
                           "rules": [{"toolName": "Bash", "ruleContent": "ls:*"}],
                           "destination": "localSettings"}]}})
    answer = wait_for_control_response("perm-1")
    decision = (answer.get("response") or {}).get("behavior")
    if decision != "allow":
        emit({"type": "result", "subtype": "error_during_execution", "is_error": True,
              "errors": ["expected the client to allow Bash, got " + str(decision)],
              "session_id": SESSION})
        return

    # A duplicate delivery of a request already answered: the client must
    # ignore it rather than answering twice.
    emit({"type": "control_request", "request_id": "perm-1",
          "request": {"subtype": "can_use_tool", "tool_name": "Bash",
                      "tool_use_id": "toolu_fake_1", "input": {"command": "ls"}}})

    emit({"type": "user", "uuid": "u-toolresult-1", "session_id": SESSION,
          "parent_tool_use_id": None,
          "message": {"role": "user",
                      "content": [{"type": "tool_result", "tool_use_id": "toolu_fake_1",
                                   "content": "file1\nfile2", "is_error": False}]}})

    # --- A subagent frame. It carries a parent_tool_use_id and must not be
    # merged into the main assistant message.
    emit({"type": "assistant", "uuid": "u-subagent-1", "session_id": SESSION,
          "parent_tool_use_id": "toolu_fake_agent",
          "message": {"id": "msg_fake_sub", "type": "message", "role": "assistant",
                      "model": "claude-haiku-4-5-20251001",
                      "content": [{"type": "text", "text": "subagent output"}],
                      "usage": {"input_tokens": 5, "output_tokens": 5}}})

    # --- Todos, which a UI shows as a checklist rather than a tool call.
    emit({"type": "assistant", "uuid": "u-assistant-2", "session_id": SESSION,
          "parent_tool_use_id": None,
          "message": {"id": "msg_fake_2", "type": "message", "role": "assistant",
                      "model": "claude-opus-5",
                      "content": [
                          {"type": "tool_use", "id": "toolu_fake_2", "name": "TodoWrite",
                           "input": {"todos": [
                               {"content": "Read the file", "status": "completed",
                                "activeForm": "Reading the file"},
                               {"content": "Fix the bug", "status": "in_progress",
                                "activeForm": "Fixing the bug"}]}}],
                      "usage": {"input_tokens": 140, "output_tokens": 40}}})
    emit({"type": "user", "uuid": "u-toolresult-2", "session_id": SESSION,
          "parent_tool_use_id": None,
          "message": {"role": "user",
                      "content": [{"type": "tool_result", "tool_use_id": "toolu_fake_2",
                                   "content": "Todos updated"}]}})

    emit({"type": "assistant", "uuid": "u-assistant-3", "session_id": SESSION,
          "parent_tool_use_id": None,
          "message": {"id": "msg_fake_3", "type": "message", "role": "assistant",
                      "model": "claude-opus-5",
                      "content": [{"type": "text", "text": "All done."}],
                      "usage": {"input_tokens": 180, "output_tokens": 10}}})

    # --- An AskUserQuestion, which arrives as a permission request and is
    # answered by approving it with the choices filled in.
    emit({"type": "control_request", "request_id": "question-1",
          "request": {"subtype": "can_use_tool", "tool_name": "AskUserQuestion",
                      "tool_use_id": "toolu_fake_q",
                      "input": {"questions": [
                          {"question": "Which database?", "header": "DB",
                           "multiSelect": False,
                           "options": [{"label": "Postgres"}, {"label": "SQLite"}]}]}}})
    answered = wait_for_control_response("question-1")
    payload = answered.get("response") or {}
    answers = (payload.get("updatedInput") or {}).get("answers") or {}
    if payload.get("behavior") != "allow" or answers.get("Which database?") != "SQLite":
        emit({"type": "result", "subtype": "error_during_execution", "is_error": True,
              "errors": ["the client did not answer the question correctly: "
                         + json.dumps(payload)],
              "session_id": SESSION})
        return

    # --- An ExitPlanMode, accepted with review comments.
    emit({"type": "control_request", "request_id": "plan-1",
          "request": {"subtype": "can_use_tool", "tool_name": "ExitPlanMode",
                      "tool_use_id": "toolu_fake_p",
                      "input": {"plan": "1. Do the thing\n2. Do the other thing"}}})
    planned = wait_for_control_response("plan-1")
    planPayload = planned.get("response") or {}
    planInput = planPayload.get("updatedInput") or {}
    if planPayload.get("behavior") != "allow" or "watch out" not in (planInput.get("userFeedback") or ""):
        emit({"type": "result", "subtype": "error_during_execution", "is_error": True,
              "errors": ["the client did not accept the plan correctly: " + json.dumps(planPayload)],
              "session_id": SESSION})
        return

    emit({"type": "result", "subtype": "success", "is_error": False,
          "result": "All done.", "total_cost_usd": 0.0123, "duration_ms": 900,
          "num_turns": 1, "session_id": SESSION,
          "usage": {"input_tokens": 180, "output_tokens": 10},
          "modelUsage": {"claude-opus-5": {"contextWindow": 200000,
                                           "maxOutputTokens": 32000}}})


def main():
    turns = 0
    while True:
        frame = read_frame()
        if frame is None:
            return

        kind = frame.get("type")

        if kind == "control_request":
            request = frame.get("request") or {}
            if request.get("subtype") == "initialize":
                emit({"type": "control_response",
                      "response": {"subtype": "success",
                                   "request_id": frame.get("request_id"),
                                   "response": {
                                       "pid": 4242,
                                       "current_permission_mode": "default",
                                       "commands": [{"name": "compact",
                                                     "description": "Compact the conversation"}],
                                       "models": [{"value": "claude-opus-5",
                                                   "displayName": "Opus 5"}],
                                       "account": {"subscriptionType": "max"}}}})
            else:
                emit({"type": "control_response",
                      "response": {"subtype": "success",
                                   "request_id": frame.get("request_id"),
                                   "response": {}}})
            continue

        if kind == "user":
            turns += 1
            if turns == 1:
                run_turn()
            continue


if __name__ == "__main__":
    main()
