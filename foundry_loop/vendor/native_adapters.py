"""Pure, bounded native JSONL readers for explicitly registered authored fixtures.

SPDX-License-Identifier: AGPL-3.0-only
Parsing follows Necmttn/ax@c2aef9b876dcd96d8115f4be4a6b3c0da6d42a77
(line-schemas.ts, transcripts.ts, pi.ts, codex.ts). No AX runtime, capture,
DuckDB, authentication, directory discovery or attachment reader is imported.
The pinned Foundry helpers used below are pure JSON/normalization functions.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import stat

from foundry.adapters import _Invalid, _hash, _issue, _json, _normalize
from foundry.redact import assert_safe, sanitize

SUPPORTED_ADAPTERS = ("claude_jsonl", "pi_jsonl", "omp_jsonl", "codex_native")
_VERSION = 1
_HASH = re.compile(r"[0-9a-f]{64}")
_CLASSES = ("captured", "context", "partial", "quarantined", "unknown", "blank")
_MAX_INT = 2**63 - 1
_STRIDE = 20_001  # JSON node limit also bounds content block count.


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _id(value, reason="missing_native_identity", *, optional=False):
    if optional and value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 512 or any(ord(c) < 32 for c in value):
        raise _Invalid(reason)
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeError:
        raise _Invalid("invalid_native_identity") from None
    return value


def _checked_cursor(cursor):
    if not cursor or cursor.get("version") != _VERSION or cursor.get("adapter") not in SUPPORTED_ADAPTERS:
        return {}
    fields = ("source_id", "prefix_hash", "identity_hash")
    if any(not isinstance(cursor.get(k), str) or not _HASH.fullmatch(cursor[k]) for k in fields):
        return {}
    native_file = cursor.get("file_identity")
    if not isinstance(native_file, list) or len(native_file) != 2 or any(type(v) is not int or not 0 <= v <= _MAX_INT for v in native_file):
        return {}
    if any(type(cursor.get(k)) is not int or not 0 <= cursor[k] <= _MAX_INT for k in ("offset", "line", "capture_generation")):
        return {}
    if type(cursor.get("complete")) is not bool:
        return {}
    return {k: cursor[k] for k in ("version", "adapter", *fields, "file_identity", "offset", "line", "capture_generation", "complete")}


def _metadata(value):
    # Metadata is safe even if a caller accidentally persists it before sanitizing
    # the full ephemeral record. Original message text still goes to core sanitize.
    checked = sanitize({"text": "", "capture_metadata": value})
    if checked.get("safe") is not True:
        raise _Invalid("unsafe_native_metadata")
    result = checked["capture_metadata"]
    assert_safe(result)
    return result


def _pick(value, names):
    return {name: value[name] for name in names if name in value}


def _reference(kind, value):
    return {"kind": kind, "reference": value, "status": "not_loaded", "opened": False}


def _attachment(block, index):
    source = block.get("source")
    out = {"block_index": index, "type": block.get("type"), "opened": False,
           **_pick(block, ("mimeType", "mime_type", "media_type", "filename", "file_id", "name", "path", "url", "image_url"))}
    # Inline binary data is accounted for with a descriptor, never copied into
    # evidence text or opened. References remain inert strings.
    if isinstance(source, dict):
        out["source"] = _pick(source, ("type", "media_type", "url", "path", "file_id"))
        data = source.get("data")
    else:
        data = block.get("data")
    if isinstance(data, str):
        out["inline_data"] = {"sha256": _hash(data.encode("utf-8")), "characters": len(data)}
    image_url = out.get("image_url")
    if isinstance(image_url, str) and image_url.startswith("data:"):
        out["image_url"] = {"sha256": _hash(image_url.encode("utf-8")), "characters": len(image_url), "inline": True}
    return out


def _content(content, *, dialect, tool_result=False):
    """Return full supplied text and descriptors; unknown blocks are counted."""
    if isinstance(content, str):
        return content, [], [], [], [], False
    if content is None:
        return "", [], [], [], [], False
    if not isinstance(content, list):
        raise _Invalid("invalid_native_content")
    texts, attachments, missing, tools, unknown = [], [], [], [], []
    mixed_result = False
    for index, block in enumerate(content):
        if not isinstance(block, dict):
            unknown.append(index)
            continue
        typ = block.get("type")
        if typ in ("text", "input_text", "output_text", "summary_text", "reasoning_text"):
            text = block.get("text")
            if not isinstance(text, str):
                raise _Invalid("invalid_native_text")
            texts.append(text)
        elif typ in ("thinking", "reasoning") and dialect in ("claude", "pi", "codex"):
            text = block.get("thinking", block.get("text"))
            if not isinstance(text, str):
                raise _Invalid("invalid_native_text")
            texts.append(text)
        elif typ in ("image", "input_image", "document", "file", "attachment", "audio", "input_audio", "video"):
            descriptor = _attachment(block, index)
            attachments.append(descriptor)
            missing.append({"kind": "attachment_material", "block_index": index, "status": "not_loaded", "opened": False})
        elif typ in ("tool_use", "toolCall"):
            call_id = _id(block.get("id"), "missing_tool_identity")
            arguments = block.get("input", block.get("arguments", block.get("args")))
            tool_text = arguments if isinstance(arguments, str) else _canonical(arguments).decode("utf-8")
            tools.append({"native_id": call_id, "block_index": index, "name": block.get("name"), "arguments_text": tool_text})
        elif typ == "tool_result" and dialect == "claude":
            _id(block.get("tool_use_id"), "missing_tool_identity")
            text, child_attachments, child_missing, child_tools, child_unknown, _ = _content(block.get("content"), dialect=dialect, tool_result=True)
            texts.append(text)
            attachments.extend(child_attachments)
            missing.extend(child_missing)
            unknown.extend(child_unknown)
            if child_tools:
                raise _Invalid("nested_native_tool_call")
            tools.append({"kind": "tool_result", "native_call_id": block["tool_use_id"], "block_index": index, "is_error": block.get("is_error", False)})
            mixed_result = True
        elif typ in ("redacted_thinking", "encrypted_reasoning"):
            missing.append({"kind": "unavailable_reasoning", "block_index": index, "status": "not_loaded", "opened": False})
        else:
            unknown.append(index)
    return "\n".join(texts), attachments, missing, tools, unknown, mixed_result


def _common(value, adapter, context):
    metadata = {"version": 1, "adapter": adapter, "native_type": value.get("type"),
                "branch_policy": "all_entries_preserved_no_active_leaf_inference",
                "session_context": dict(context.get("metadata", {})),
                "attachments": [], "missing_materials": [], "text_complete": True}
    if context.get("parent_session_id"):
        metadata["missing_materials"].append(_reference("parent_session", context["parent_session_id"]))
    metadata.update(_pick(value, ("timestamp", "ordinal", "branch_id", "parent_id", "parentId", "parentUuid",
        "isSidechain", "isMeta", "isCompactSummary", "agentId", "teamName", "delegation_id", "parent_session_id")))
    return metadata


def _record(scope, sid, mid, role, kind, text, line, subindex, metadata, locator, raw_hash, max_bytes, *, parent=None, delegation=None, quoted=False, truncated=False):
    normalized = _normalize({"provider": scope["provider"], "account": scope["account"],
        "session_id": _id(sid, "missing_session_identity"), "message_id": _id(mid, "missing_message_identity"),
        "sequence": line * _STRIDE + subindex, "role": role, "kind": kind, "text": text,
        "quoted": quoted, "truncated": truncated, "parent_session_id": _id(parent, optional=True),
        "delegation_id": _id(delegation, optional=True)}, locator, raw_hash, max_bytes)
    normalized["capture_metadata"] = _metadata(metadata)
    return normalized


def _text_records(value, adapter, context, scope, locator, raw_hash, max_bytes, *, sid, mid, role, content, parent=None, delegation=None, metadata=None):
    dialect = "claude" if adapter == "claude_jsonl" else "codex" if adapter == "codex_native" else "pi"
    if content is None and role in ("user", "assistant", "toolResult", "tool_result", "tool"):
        raise _Invalid("invalid_native_content")
    text, attachments, missing, tools, unknown, result_content = _content(content, dialect=dialect)
    metadata = metadata or _common(value, adapter, context)
    metadata.update(native_message_id=mid, native_role=role, attachments=metadata["attachments"] + attachments,
                    missing_materials=metadata["missing_materials"] + missing, text_complete=not bool(unknown))
    metadata["tool_calls"] = [{k: v for k, v in tool.items() if k != "arguments_text"} for tool in tools]
    if parent and parent != sid and not any(item.get("kind") == "parent_session" for item in metadata["missing_materials"]):
        metadata["missing_materials"].append(_reference("parent_session", parent))
    if metadata.get("parent_message_id") and metadata["parent_message_id"] not in context.get("seen", set()):
        metadata["missing_materials"].append(_reference("parent_message", metadata["parent_message_id"]))
    result_call_ids = [tool["native_call_id"] for tool in tools if tool.get("kind") == "tool_result"]
    if role in ("toolResult", "tool_result", "tool"):
        result_call_ids += [metadata[key] for key in ("toolCallId", "call_id") if metadata.get(key)]
    for call_id in result_call_ids:
        if call_id not in context.get("tool_call_ids", set()):
            metadata["missing_materials"].append(_reference("tool_call", call_id))
    issues = [_issue("unsupported_native_content", dict(locator, block_index=index)) for index in unknown]
    kind = "message"
    if role in ("system", "developer", "service", "custom", "hookMessage"):
        role, kind = "service", "service"
    elif role in ("toolResult", "tool_result", "tool"):
        role, kind = "tool", "tool_result"
    elif role == "delegation":
        kind = "delegation"
    elif role not in ("user", "assistant"):
        raise _Invalid("unknown_native_role")
    if result_content:
        # Tool output is untrusted evidence even when the harness wraps it in
        # a user entry. Mixed direct/tool content conservatively loses authority.
        all_results = isinstance(content, list) and all(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)
        role, kind = ("tool", "tool_result") if all_results else ("service", "service")
        metadata["mixed_role_content"] = not all_results
    if role == "user" and (any("arguments_text" in tool for tool in tools) or isinstance(content, list) and any(isinstance(block, dict) and block.get("type") in ("thinking", "reasoning") for block in content)):
        role, kind = "service", "service"
        metadata["mixed_role_content"] = True
    if role == "user" and (metadata.get("isMeta") or metadata.get("isCompactSummary")):
        role, kind = "service", "service"
    if role == "user" and (delegation or context.get("delegated")):
        role, kind = "delegation", "delegation"
        delegation = delegation or mid
    if role == "user" and metadata.get("isSidechain"):
        role, kind = "service", "service"
    native_truncated = value.get("truncated", False)
    if type(native_truncated) is not bool:
        raise _Invalid("invalid_flags")
    record = _record(scope, sid, mid, role, kind, text, locator["line"], 0, metadata, locator, raw_hash, max_bytes,
                     parent=parent, delegation=delegation, quoted=value.get("quoted", False), truncated=native_truncated or bool(unknown))
    records = [record]
    for ordinal, tool in enumerate(tools, 1):
        if "arguments_text" not in tool:
            continue
        tool_meta = {**_common(value, adapter, context), "native_message_id": tool["native_id"], "parent_message_id": mid,
                     "native_role": "tool_call", "tool_name": tool.get("name"), "tool_call_id": tool["native_id"],
                     "content_block_index": tool["block_index"], "text_complete": not bool(unknown)}
        records.append(_record(scope, sid, tool["native_id"], "tool", "tool_call", tool["arguments_text"],
                               locator["line"], ordinal, tool_meta, dict(locator, block_index=tool["block_index"]), raw_hash, max_bytes, parent=parent, truncated=native_truncated or bool(unknown)))
    return records, issues, "partial" if unknown else "captured"


def _claude(value, adapter, context, scope, locator, raw_hash, max_bytes):
    typ = value.get("type")
    if typ not in ("user", "assistant", "system", "progress", "attachment"):
        return [], [_issue("unsupported_native_record", locator, b"")], "unknown"
    sid = _id(value.get("sessionId"), "missing_session_identity")
    mid = _id(value.get("uuid"), "missing_message_identity")
    metadata = _common(value, adapter, context)
    metadata.update(parent_message_id=_id(value.get("parentUuid"), optional=True),
                    native_api_message_id=(value.get("message") or {}).get("id") if isinstance(value.get("message"), dict) else None)
    parent = value.get("parentSessionId", value.get("parent_session_id"))
    delegation = value.get("delegation_id")
    if value.get("agentId") and typ == "user":
        delegation = _id(value["agentId"])
    message = value.get("message")
    if typ in ("user", "assistant"):
        if not isinstance(message, dict):
            raise _Invalid("invalid_native_message")
        native_role = message.get("role", typ)
        if native_role != typ:
            raise _Invalid("native_role_mismatch")
        content = message.get("content")
    elif typ == "attachment":
        attachment = value.get("attachment")
        if not isinstance(attachment, dict):
            raise _Invalid("invalid_native_attachment")
        metadata["attachments"] = [_attachment({"type": "attachment", **attachment}, 0)]
        metadata["missing_materials"] = [{"kind": "attachment_material", "status": "not_loaded", "opened": False}]
        content = attachment.get("content", attachment.get("text", ""))
        native_role = "service"
    else:
        native_role = "service"
        content = message.get("content") if isinstance(message, dict) else value.get("content", value.get("text"))
        if content is None:
            content = _canonical(value.get("data", {})).decode("utf-8")
    if metadata.get("isCompactSummary"):
        metadata["missing_materials"].append({"kind": "pre_compaction_context", "status": "not_loaded", "opened": False})
    records, issues, classification = _text_records(value, adapter, context, scope, locator, raw_hash, max_bytes,
        sid=sid, mid=mid, role=native_role, content=content, parent=parent, delegation=delegation, metadata=metadata)
    context.setdefault("seen", set()).add(mid)
    return records, issues, classification


def _pi(value, adapter, context, scope, locator, raw_hash, max_bytes):
    typ = value.get("type")
    if typ == "session":
        sid = _id(value.get("id"), "missing_session_identity")
        context.clear()
        context.update(session_id=sid, metadata=_pick(value, ("version", "parentSession", "providerPromptCacheKey")), seen=set())
        return [], [], "context"
    supported = {"message", "custom_message", "compaction", "branch_summary", "context_edit", "model_change",
                 "thinking_level_change", "usage", "custom", "label", "session_info", "artifact"}
    if typ not in supported:
        return [], [_issue("unsupported_native_record", locator)], "unknown"
    sid = _id(context.get("session_id"), "missing_session_identity")
    mid = _id(value.get("id"), "missing_message_identity")
    _id(value.get("parentId"), optional=True)
    metadata = _common(value, adapter, context)
    metadata.update(native_message_id=mid, parent_message_id=value.get("parentId"))
    parent = context["metadata"].get("parentSession")
    # Pi parentSession can be a file path, not a typed session foreign key.
    if parent is not None:
        metadata["missing_materials"].append(_reference("parent_session_lineage", parent))
    if typ == "message":
        message = value.get("message")
        if not isinstance(message, dict):
            raise _Invalid("invalid_native_message")
        role = message.get("role")
        metadata.update(_pick(message, ("toolCallId", "toolName", "isError", "provider", "model", "api", "context_id")))
        result = _text_records(value, adapter, context, scope, locator, raw_hash, max_bytes,
            sid=sid, mid=mid, role=role, content=message.get("content"), metadata=metadata)
    elif typ in ("custom_message", "compaction", "branch_summary", "context_edit"):
        metadata.update(_pick(value, ("fromId", "firstKeptEntryId", "targetId", "customType", "fromHook")))
        if typ == "context_edit":
            target = _id(value.get("targetId"), "missing_context_identity")
            metadata["missing_materials"].append(_reference("context_edit_target", target))
            replacement = value.get("replacement")
            if replacement is not None and not isinstance(replacement, dict):
                raise _Invalid("invalid_context_edit")
            content = replacement.get("content") if replacement is not None else ""
            metadata["context_removed"] = replacement is None
        else:
            content = value.get("content") if typ == "custom_message" else value.get("summary")
        if typ in ("compaction", "branch_summary"):
            metadata["missing_materials"].append({"kind": "summarized_context", "status": "not_loaded", "opened": False})
        result = _text_records(value, adapter, context, scope, locator, raw_hash, max_bytes,
            sid=sid, mid=mid, role="service", content=content, metadata=metadata)
    else:
        metadata.update(_pick(value, ("provider", "modelId", "thinkingLevel", "customType", "targetId")))
        if typ == "custom" and value.get("customType") == "vibe-session-lifecycle" and isinstance(value.get("data"), dict):
            metadata["delegation"] = _pick(value["data"], ("id", "ownerId", "parentSessionId", "childSessionFile", "action", "cli", "agent", "turn"))
            if value["data"].get("childSessionFile"):
                metadata["missing_materials"].append(_reference("delegated_child_session", value["data"]["childSessionFile"]))
        # Extension/control data is preserved as service evidence, never promoted
        # to a user instruction. A native entry ID is still required.
        result = ([_record(scope, sid, mid, "service", "service", _canonical(_pick(value, ("data", "note", "label", "name", "modelId", "thinkingLevel", "usage"))).decode("utf-8"),
                           locator["line"], 0, metadata, locator, raw_hash, max_bytes)], [], "captured")
    context.setdefault("seen", set()).add(mid)
    return result


def _codex_parent(payload):
    source = payload.get("source")
    subagent = source.get("subagent") if isinstance(source, dict) else None
    spawn = subagent.get("thread_spawn") if isinstance(subagent, dict) else None
    return payload.get("parent_thread_id") or (spawn.get("parent_thread_id") if isinstance(spawn, dict) else None)


def _codex(value, adapter, context, scope, locator, raw_hash, max_bytes):
    typ, payload = value.get("type"), value.get("payload")
    if not isinstance(payload, dict):
        raise _Invalid("invalid_native_payload")
    if typ == "session_meta":
        sid = _id(payload.get("id"), "missing_session_identity")
        parent = _id(_codex_parent(payload), optional=True)
        if not context.get("session_id"):
            context.update(session_id=sid, parent_session_id=parent,
                delegated=payload.get("thread_source") == "subagent" or isinstance(payload.get("source"), dict) and "subagent" in payload["source"],
                metadata=_pick(payload, ("session_id", "forked_from_id", "forked_from_ordinal_exclusive", "parent_thread_id", "source", "thread_source",
                    "agent_path", "agent_nickname", "agent_role", "model_provider", "history_mode", "history_base", "context_window", "subagent_history_start_ordinal")), seen=set())
        # Official rollout reader keeps the first session metadata as the owning
        # thread; later session_meta can be copied inherited history.
        instructions = payload.get("base_instructions")
        if instructions is not None:
            text = instructions if isinstance(instructions, str) else _canonical(instructions).decode("utf-8")
            metadata = _common(value, adapter, context)
            metadata.update(native_message_id=sid, native_role="service", context_id=sid,
                            inherited_session_metadata=sid != context["session_id"])
            return [_record(scope, context["session_id"], sid, "service", "service", text, locator["line"], 0, metadata, locator, raw_hash, max_bytes, parent=parent)], [], "captured"
        return [], [], "context"
    sid = _id(context.get("session_id"), "missing_session_identity")
    metadata = _common(value, adapter, context)
    metadata.update(_pick(payload, ("turn_id", "context_id", "context_window_id", "parent_message_id", "call_id", "name", "namespace", "phase", "author", "recipient", "other_recipients")))
    parent = context.get("parent_session_id")
    for field in ("forked_from_id", "history_base"):
        if context.get("metadata", {}).get(field) is not None:
            metadata["missing_materials"].append(_reference(field, context["metadata"][field]))
    if typ == "turn_context":
        turn_id = _id(payload.get("turn_id", payload.get("id")), "missing_context_identity")
        context["metadata"]["turn_id"] = turn_id
        context["metadata"].update(_pick(payload, ("context_window", "context_window_id")))
        metadata["context_id"] = turn_id
        return [_record(scope, sid, turn_id, "service", "service", _canonical(payload).decode("utf-8"), locator["line"], 0, metadata, locator, raw_hash, max_bytes, parent=parent)], [], "captured"
    if typ == "compacted":
        mid = _id(payload.get("id"), "missing_message_identity")
        metadata["missing_materials"].append({"kind": "pre_compaction_context", "status": "not_loaded", "opened": False})
        return _text_records(value, adapter, context, scope, locator, raw_hash, max_bytes, sid=sid, mid=mid,
                             role="service", content=payload.get("message", payload.get("replacement_history", "")), parent=parent, metadata=metadata)
    if typ == "inter_agent_communication":
        mid = _id(payload.get("id"), "missing_message_identity")
        return _text_records(value, adapter, context, scope, locator, raw_hash, max_bytes, sid=sid, mid=mid,
                             role="delegation", content=payload.get("content"), parent=parent, delegation=mid, metadata=metadata)
    if typ not in ("response_item", "event_msg"):
        return [], [_issue("unsupported_native_record", locator)], "unknown"
    item = payload.get("type")
    if typ == "event_msg" and item in ("token_count", "task_started", "turn_started", "task_complete", "turn_complete", "thread_rolled_back", "context_window_changed"):
        # A known control event with textual fields still needs a native ID.
        if not any(isinstance(payload.get(key), str) and payload[key] for key in ("message", "last_agent_message", "text")):
            context["metadata"].update(_pick(payload, ("turn_id", "context_window_id")))
            return [], [], "context"
    supported = {"message", "user_message", "agent_message", "agent_reasoning", "agent_reasoning_raw_content", "reasoning", "function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output", "delegation", "service"}
    if item not in supported:
        return [], [_issue("unsupported_native_event", locator)], "unknown"
    mid = _id(payload.get("id", payload.get("message_id", value.get("id"))), "missing_message_identity")
    metadata.update(native_message_id=mid, native_type=typ, native_item_type=item)
    if item in ("function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output"):
        role, kind = "tool", "tool_call" if item.endswith("call") else "tool_result"
        _id(payload.get("call_id"), "missing_tool_identity")
        content = payload.get("arguments") if item == "function_call" else payload.get("input") if item == "custom_tool_call" else payload.get("output")
        if kind == "tool_call":
            if not isinstance(content, str):
                raise _Invalid("invalid_native_text")
            return [_record(scope, sid, mid, role, kind, content, locator["line"], 0, metadata, locator, raw_hash, max_bytes, parent=parent)], [], "captured"
        records, issues, classification = _text_records(value, adapter, context, scope, locator, raw_hash, max_bytes,
            sid=sid, mid=mid, role="tool", content=content, parent=parent, metadata=metadata)
        return records, issues, classification
    if item == "reasoning":
        content = (payload.get("summary") or []) + (payload.get("content") or [])
        if payload.get("encrypted_content") is not None:
            metadata["missing_materials"].append({"kind": "encrypted_reasoning", "status": "not_loaded", "opened": False})
        role = "service"
    else:
        typed_role = {"user_message": "user", "agent_message": "assistant", "agent_reasoning": "service", "agent_reasoning_raw_content": "service", "delegation": "delegation", "service": "service"}.get(item)
        if typed_role is not None and payload.get("role") not in (None,typed_role):
            raise _Invalid("native_role_mismatch")
        role = typed_role if typed_role is not None else payload.get("role")
        content = payload.get("content", payload.get("message", payload.get("text")))
    # Local/remote image references from event_msg are inert attachments.
    for field in ("images", "local_images"):
        refs = payload.get(field, [])
        if refs is not None and not isinstance(refs, list):
            raise _Invalid("invalid_native_attachment")
        for index, ref in enumerate(refs or []):
            metadata["attachments"].append(_attachment({"type": "input_image", "path" if field == "local_images" else "image_url": ref}, index))
            metadata["missing_materials"].append({"kind": "attachment_material", "status": "not_loaded", "opened": False})
    return _text_records(value, adapter, context, scope, locator, raw_hash, max_bytes, sid=sid, mid=mid, role=role,
                         content=content, parent=parent, delegation=mid if role == "delegation" else None, metadata=metadata)


_PARSERS = {"claude_jsonl": _claude, "pi_jsonl": _pi, "omp_jsonl": _pi, "codex_native": _codex}


def _remember(context, records):
    for record in records:
        context.setdefault("seen", set()).add(record["message_id"])
        if record["kind"] == "tool_call":
            metadata = record["capture_metadata"]
            context.setdefault("tool_call_ids", set()).add(metadata.get("call_id", metadata.get("tool_call_id", record["message_id"])))


def _coverage(counts, start, end, complete, records, issues):
    total = sum(counts.values())
    return {"version": 1, "scope": "bounded_native_jsonl_page", "raw_rows": total,
            "classified_rows": total, "counts": counts, "records": records, "issues": issues,
            "byte_start": start, "byte_end": end, "complete": complete,
            "text_complete": not any(counts[k] for k in ("partial", "quarantined", "unknown")),
            "universal_capture_claim": False}


def scan_native(path, adapter, cursor, *, identity, max_bytes=1_048_576, max_records=250):
    """Return one bounded page and a CAS-ready sanitized checkpoint.

    max_records bounds consumed physical rows and emitted normalized records,
    including unknown/blank/quarantined rows in the physical-row budget.
    Consumed-prefix verification and the new page each read at most max_bytes;
    a prefix above that explicit budget cannot advance. Rows without a final
    newline wait for append. On rotation, edit or rewind generation increases.
    """
    if adapter not in SUPPORTED_ADAPTERS:
        raise ValueError("unsupported native adapter")
    if type(max_bytes) is not int or not 1 <= max_bytes <= 64 * 1_048_576 or type(max_records) is not int or not 1 <= max_records <= 100_000:
        raise ValueError("invalid scan limits")
    if cursor is not None and not isinstance(cursor, dict):
        raise ValueError("invalid cursor")
    old = _checked_cursor(cursor)
    counts = {kind: 0 for kind in _CLASSES}
    path = Path(path)
    source = _hash(_canonical({"path": str(path.absolute()), "adapter": adapter}))
    base = {"adapter": adapter, "source_id": source}
    def failed(reason):
        issue = _issue(reason, base)
        return {"records": [], "cursor": dict(old), "issues": [issue], "coverage": _coverage(counts, old.get("offset", 0), old.get("offset", 0), False, 0, 1)}
    try:
        if not isinstance(identity, dict) or set(identity) != {"provider", "account"}:
            return failed("invalid_source_identity")
        scope = {key: _id(identity.get(key), "invalid_source_identity") for key in ("provider", "account")}
        assert_safe(scope)  # Configuration identities must never be credentials.
        scope_hash = _hash(_canonical(scope))
    except (_Invalid, ValueError, TypeError, UnicodeError, RecursionError):
        return failed("invalid_source_identity")
    source = _hash(_canonical({"path": str(path.absolute()), "adapter": adapter, "identity_hash": scope_hash}))
    base = {"adapter": adapter, "source_id": source}
    try:
        resolved = path.resolve()
        forbidden = Path("/root/.codex/sessions")
        if path.is_symlink() or resolved == forbidden or forbidden in resolved.parents:
            return failed("disallowed_source")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode):
                os.close(descriptor)
                return failed("source_not_regular")
            stream = os.fdopen(descriptor, "rb")
        except OSError:
            os.close(descriptor)
            raise
        with stream:
            native_file = [before.st_dev, before.st_ino]
            offset, line = old.get("offset", 0), old.get("line", 0)
            valid = bool(old) and old["adapter"] == adapter and old["source_id"] == source and old["identity_hash"] == scope_hash and old["file_identity"] == native_file and before.st_size >= offset
            if valid and offset > max_bytes:
                return failed("prefix_verification_limit_retryable")
            prefix = stream.read(offset) if valid else b""
            valid = valid and len(prefix) == offset and _hash(prefix) == old["prefix_hash"]
            if not valid:
                offset, line, prefix = 0, 0, b""
                stream.seek(0)
            generation = old.get("capture_generation", 0) + int(not valid)
            if generation > _MAX_INT:
                return failed("capture_generation_limit")
            chunk = stream.read(max_bytes + 1)
            after = os.fstat(stream.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                return failed("source_changed_retryable")
        context = {}
        parser = _PARSERS[adapter]
        # Reconstruct only bounded in-memory context. Nothing private enters the
        # cursor and no file/directory referenced by these rows is opened.
        for ordinal, raw in enumerate(prefix.splitlines(keepends=True), 1):
            if not raw.strip():
                continue
            parsed = None
            try:
                parsed = _json(raw)
                replayed, _, _ = parser(parsed, adapter, context, scope, dict(base, line=ordinal), _hash(raw), max_bytes)
                _remember(context, replayed)
            except (_Invalid, ValueError, TypeError, OverflowError, RecursionError):
                if parsed is None or isinstance(parsed, dict) and parsed.get("type") in ("session", "session_meta"):
                    context.clear()
        available, consumed, processed = chunk[:max_bytes], 0, 0
        records, issues = [], []
        while consumed < len(available) and processed < max_records:
            end = available.find(b"\n", consumed)
            if end == -1:
                reason = "record_byte_limit_retryable" if len(chunk) > max_bytes else "incomplete_last_record_retryable"
                issues.append(_issue(reason, dict(base, byte_start=offset + consumed, byte_end=offset + len(available), line=line + 1), available[consumed:]))
                break
            end += 1
            raw = available[consumed:end]
            line += 1
            processed += 1
            locator = dict(base, byte_start=offset + consumed, byte_end=offset + end, line=line, capture_generation=generation)
            value = None
            try:
                if not raw.strip():
                    classification, new_records, new_issues = "blank", [], []
                else:
                    value = _json(raw)
                    new_records, new_issues, classification = parser(value, adapter, context, scope, locator, _hash(raw), max_bytes)
                    if len(records) + len(new_records) > max_records:
                        line -= 1
                        if len(new_records) > max_records:
                            issues.append(_issue("record_count_limit_retryable", locator, raw))
                        break
                    _remember(context, new_records)
                    for issue in new_issues:
                        issue["raw_hash"] = _hash(raw)
                records.extend(new_records)
                issues.extend(new_issues)
                counts[classification] += 1
            except _Invalid as error:
                counts["quarantined"] += 1
                issues.append(_issue(str(error), locator, raw))
                if value is None or isinstance(value, dict) and value.get("type") in ("session", "session_meta"):
                    context.clear()
            except (ValueError, TypeError, UnicodeError, OverflowError, RecursionError, KeyError):
                counts["quarantined"] += 1
                issues.append(_issue("invalid_native_record", locator, raw))
                if value is None or isinstance(value, dict) and value.get("type") in ("session", "session_meta"):
                    context.clear()
            consumed = end
        position = offset + consumed
        checkpoint = {"version": _VERSION, "adapter": adapter, "source_id": source, "identity_hash": scope_hash,
                      "file_identity": native_file, "offset": position, "line": line, "prefix_hash": _hash(prefix + available[:consumed]),
                      "capture_generation": generation, "complete": position == before.st_size}
        return {"records": records, "cursor": checkpoint, "issues": issues,
                "coverage": _coverage(counts, offset, position, checkpoint["complete"], len(records), len(issues))}
    except OSError:
        return failed("source_unavailable_retryable")
