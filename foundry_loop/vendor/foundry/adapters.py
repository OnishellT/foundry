"""Bounded readers for explicitly supplied, synthetic or authorized exports.

JSONL verifies the consumed prefix on each scan. Work is bounded by max_bytes
for verification and max_bytes for the next chunk; a prefix exceeding that
budget is retryable and cannot advance. This intentionally requires a bounded
export (or a larger explicit budget) for long-lived large logs. SQLite exports
must increase their integer updated_seq on every insert/edit and keep it unique
per version. No source path, source text, native ID or parser error enters issues
or cursors. Records themselves are ephemeral and MUST pass redact.sanitize.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
from urllib.parse import quote

_CURSOR_VERSION = 1
_COLUMNS = ("provider", "account", "session_id", "message_id", "sequence", "role", "kind", "text", "quoted", "truncated", "parent_session_id", "delegation_id")
_ROLES = {"user", "assistant", "tool", "service", "delegation"}
_KINDS = {"message", "tool_call", "tool_result", "service", "delegation"}
_ALIASES = {"jsonl": "jsonl", "codex_jsonl": "codex_jsonl", "codex-jsonl": "codex_jsonl", "codex": "codex_jsonl", "sqlite": "sqlite", "sqlite_export": "sqlite"}


class _Invalid(ValueError):
    pass


def _hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8", errors="strict")


def _issue(reason, locator, raw=b""):
    return {"reason": reason, "locator": locator, "raw_hash": _hash(raw), "retryable": reason.endswith("_retryable")}


def _source(path: Path, adapter: str) -> str:
    return _hash(_canonical({"adapter": adapter, "path": str(path.absolute())}))


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise _Invalid("duplicate_json_key")
        value[key] = item
    return value


def _json(raw: bytes):
    try:
        text = raw.decode("utf-8", errors="strict")
        value = json.loads(text, object_pairs_hook=_pairs, parse_constant=lambda _: (_ for _ in ()).throw(_Invalid("nonfinite_json")))
    except _Invalid:
        raise
    except (UnicodeError, ValueError, RecursionError):
        raise _Invalid("malformed_json") from None
    nodes = [0]
    def bounded(item, depth=0):
        nodes[0] += 1
        if depth > 20 or nodes[0] > 20_000:
            raise _Invalid("structure_limit")
        if isinstance(item, str):
            try:
                item.encode("utf-8", errors="strict")
            except UnicodeError:
                raise _Invalid("invalid_unicode") from None
        elif isinstance(item, (list, dict)):
            if isinstance(item, dict):
                for key, child in item.items():
                    bounded(key, depth + 1)
                    bounded(child, depth + 1)
            else:
                for child in item:
                    bounded(child, depth + 1)
    bounded(value)
    if not isinstance(value, dict):
        raise _Invalid("record_not_object")
    return value


def _identity(value, *, optional=False):
    if optional and value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 512 or any(ord(c) < 32 for c in value):
        raise _Invalid("invalid_identity")
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeError:
        raise _Invalid("invalid_identity") from None
    return value


def _normalize(value, locator, raw_hash, max_bytes):
    out = {field: _identity(value.get(field)) for field in ("provider", "account", "session_id", "message_id")}
    sequence = value.get("sequence")
    if type(sequence) is not int or not 0 <= sequence <= 2**63 - 1:
        raise _Invalid("invalid_sequence")
    role = value.get("role")
    if role in ("system", "developer"):
        role = "service"
    if not isinstance(role, str) or role not in _ROLES:
        raise _Invalid("unknown_role")
    kind = value.get("kind", "service" if role == "service" else "delegation" if role == "delegation" else "message")
    if not isinstance(kind, str) or kind not in _KINDS:
        raise _Invalid("unknown_kind")
    if (role in ("user", "assistant") and kind != "message") or (role == "tool" and kind not in ("tool_call", "tool_result")) or (role in ("service", "delegation") and kind != role):
        raise _Invalid("role_kind_mismatch")
    text = value.get("text")
    if not isinstance(text, str):
        raise _Invalid("invalid_text")
    try:
        text_bytes = text.encode("utf-8", errors="strict")
    except UnicodeError:
        raise _Invalid("invalid_unicode") from None
    if len(text_bytes) > max_bytes or len(text) > 1_048_576:
        raise _Invalid("text_limit")
    if any(ord(c) < 32 and c not in "\n\r\t" for c in text):
        raise _Invalid("invalid_text")
    quoted = value.get("quoted", False)
    truncated = value.get("truncated", False)
    if type(quoted) is not bool or type(truncated) is not bool:
        raise _Invalid("invalid_flags")
    parent = _identity(value.get("parent_session_id"), optional=True)
    delegation = _identity(value.get("delegation_id"), optional=True)
    # Coarse v1 flag: mixed quoted/direct messages abstain from establishing
    # normative requirements too. Explicit false never overrides visible quotes.
    quoted = quoted or bool(re.search(r'(?m)^\s*(?:>|```|~~~)|<(?:quote|quoted|blockquote|transcript_evidence|codex_delegation|delegation)\b|“[^”]*”|‘[^’]*’|(?<!\w)"[^"\n]{2,}"(?!\w)', text, re.I))
    if delegation is not None or re.match(r"\s*<(?:codex_delegation|delegation)\b", text, re.I):
        role, kind = "delegation", "delegation"
    truncated = truncated or bool(re.search(r"\[(?:truncated|content truncated|output truncated)\]|<truncated\b|\b(?:conversation|output|content) too long; truncated", text, re.I))
    out.update(sequence=sequence, role=role, kind=kind, text=text, quoted=quoted,
               truncated=truncated, parent_session_id=parent, delegation_id=delegation,
               locator=locator, raw_hash=raw_hash)
    if "native_revision" in value:
        revision = value["native_revision"]
        if type(revision) is not int or not 0 <= revision <= 2**63 - 1:
            raise _Invalid("invalid_revision")
        out["native_revision"] = revision
    return out


def _codex(value, context, line):
    payload = value.get("payload")
    if not isinstance(payload, dict):
        raise _Invalid("invalid_codex_payload")
    typ = value.get("type")
    if typ == "session_meta":
        context.clear()
        context.update(session_id=_identity(payload.get("id")), provider=payload.get("provider", "codex"),
                       account=payload.get("account", value.get("account")),
                       parent_session_id=payload.get("parent_session_id"))
        return None
    if typ not in ("response_item", "event_msg"):
        raise _Invalid("unsupported_codex_event")
    item_type = payload.get("type")
    message_id = payload.get("id", payload.get("message_id", value.get("id")))
    # call_id links call/result; it is not a unique message identity.
    _identity(message_id)
    role = payload.get("role")
    kind = "message"
    if item_type in ("function_call", "custom_tool_call", "tool_call"):
        role, kind = "tool", "tool_call"
        text = payload.get("arguments", payload.get("input", payload.get("text")))
    elif item_type in ("function_call_output", "custom_tool_call_output", "tool_result"):
        role, kind = "tool", "tool_result"
        text = payload.get("output", payload.get("text"))
    elif item_type in ("user_message", "agent_message", "message"):
        role = role or ("user" if item_type == "user_message" else "assistant" if item_type == "agent_message" else None)
        text = payload.get("message", payload.get("text"))
        if text is None and isinstance(payload.get("content"), list):
            parts = []
            for part in payload["content"]:
                if not isinstance(part, dict) or part.get("type") not in ("input_text", "output_text", "text") or not isinstance(part.get("text"), str):
                    raise _Invalid("unsupported_codex_content")
                parts.append(part["text"])
            text = "\n".join(parts)
    elif item_type in ("service", "delegation"):
        role, kind = item_type, item_type
        text = payload.get("text", payload.get("message"))
    else:
        raise _Invalid("unsupported_codex_event")
    if role in ("system", "developer", "service"):
        role, kind = "service", "service"
    result = {key: payload.get(key, context.get(key)) for key in ("provider", "account", "session_id", "parent_session_id")}
    result.update(message_id=message_id, sequence=payload.get("sequence", value.get("sequence", line)),
                  role=role, kind=kind, text=text, quoted=payload.get("quoted", False),
                  truncated=payload.get("truncated", False), delegation_id=payload.get("delegation_id"))
    return result


def _same_identity(cursor, fingerprint):
    return cursor.get("file_identity") == fingerprint


def _jsonl(path, adapter, cursor, max_bytes, max_records, source_id):
    issues, records = [], []
    base = {"adapter": adapter, "source_id": source_id}
    old = cursor or {}
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            return {"records": [], "cursor": dict(old), "issues": [_issue("source_not_regular", base)]}
        identity = [before.st_dev, before.st_ino]
        offset = old.get("offset", 0)
        line = old.get("line", 0)
        valid = (old.get("version") == _CURSOR_VERSION and old.get("adapter") == adapter and old.get("source_id") == source_id
                 and type(offset) is int and offset >= 0 and type(line) is int and line >= 0 and _same_identity(old, identity))
        context = {}
        if valid and offset > max_bytes and before.st_size >= offset:
            return {"records": [], "cursor": dict(old), "issues": [_issue("prefix_verification_limit_retryable", base)]}
        prefix = b""
        if valid and before.st_size >= offset:
            prefix = stream.read(offset)
            valid = len(prefix) == offset and _hash(prefix) == old.get("prefix_hash")
        else:
            valid = False
        if not valid:
            offset, line = 0, 0
            prefix = b""
            stream.seek(0)
        generation = old.get("capture_generation", 0) + int(not valid)
        if adapter == "codex_jsonl" and prefix:
            # Recreate native session context without putting IDs in a cursor.
            for ordinal, raw in enumerate(prefix.splitlines(keepends=True), 1):
                try:
                    value = _json(raw)
                    if value.get("type") == "session_meta":
                        _codex(value, context, ordinal)
                except _Invalid:
                    context.clear()
        chunk = stream.read(max_bytes + 1)
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            return {"records": [], "cursor": dict(old), "issues": [_issue("source_changed_retryable", base)]}
    available = chunk[:max_bytes]
    consumed, processed = 0, 0
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
        try:
            value = _json(raw)
            normalized = _codex(value, context, line) if adapter == "codex_jsonl" else value
            if normalized is not None:
                records.append(_normalize(normalized, locator, _hash(raw), max_bytes))
        except _Invalid as error:
            issues.append(_issue(str(error), locator, raw))
            if adapter == "codex_jsonl":
                context.clear()
        except (ValueError, TypeError, OverflowError, RecursionError):
            issues.append(_issue("invalid_record", locator, raw))
        consumed = end
    position = offset + consumed
    return {"records": records, "issues": issues, "cursor": {
        "version": _CURSOR_VERSION, "adapter": adapter, "source_id": source_id,
        "file_identity": identity, "offset": position, "line": line,
        "prefix_hash": _hash(prefix + available[:consumed]),
        "capture_generation": generation, "complete": position == before.st_size,
    }}


def _sqlite(path, cursor, max_bytes, max_records, source_id):
    base = {"adapter": "sqlite", "source_id": source_id}
    old = cursor or {}
    before = path.stat()
    identity = [before.st_dev, before.st_ino]
    same = (old.get("version") == _CURSOR_VERSION and old.get("adapter") == "sqlite" and old.get("source_id") == source_id and _same_identity(old, identity)
            and type(old.get("updated_seq")) is int and old["updated_seq"] >= -1)
    last = old["updated_seq"] if same else -1
    generation = old.get("capture_generation", 0) + int(not same)
    records, issues = [], []
    connection = sqlite3.connect("file:" + quote(str(path.absolute()), safe="/") + "?mode=ro", uri=True, timeout=0.1)
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("PRAGMA trusted_schema=OFF")
        # Sorting must never spill raw export text into temporary files.
        connection.execute("PRAGMA temp_store=MEMORY")
        connection.set_progress_handler(lambda: 1 if steps[0] <= 0 else steps.__setitem__(0, steps[0] - 1), 1000)
        steps = [max(100, max_records * 10)]
        connection.execute("BEGIN")
        table = connection.execute("SELECT type FROM sqlite_master WHERE name='messages'").fetchone()
        columns = {row[1] for row in connection.execute("PRAGMA table_info(messages)")}
        if table != ("table",) or not set(_COLUMNS + ("updated_seq",)).issubset(columns):
            return {"records": [], "cursor": dict(old), "issues": [_issue("unsupported_sqlite_schema", base)]}
        # Validate ordering across the export, including rows outside this page.
        invalid = connection.execute("SELECT 1 FROM messages WHERE typeof(updated_seq) != 'integer' OR updated_seq < 0 LIMIT 1").fetchone()
        duplicate = connection.execute("SELECT 1 FROM messages GROUP BY updated_seq HAVING count(*) > 1 LIMIT 1").fetchone()
        if invalid or duplicate:
            return {"records": [], "cursor": dict(old), "issues": [_issue("invalid_updated_seq", base)]}
        top = connection.execute("SELECT max(updated_seq) FROM messages").fetchone()[0]
        # A truncation/reset rewinds. Arbitrary edits without increasing the
        # sequence violate the explicit export contract and are not detectable.
        if top is None or top < last:
            generation += int(same)
            last = -1
        row_size = "+".join(f'coalesce(length(CAST("{c}" AS BLOB)),0)' for c in _COLUMNS)
        selected = [f'CASE WHEN ({row_size}) <= ? THEN "{column}" ELSE NULL END' for column in _COLUMNS]
        # Sort only native sequence integers. Project one bounded row at a
        # time, so LIMIT cannot materialize max_records * max_bytes of text.
        revisions = connection.execute("SELECT updated_seq FROM messages WHERE updated_seq > ? ORDER BY updated_seq LIMIT ?", (last, max_records)).fetchall()
        query = "SELECT " + ",".join(selected) + "," + row_size + " FROM messages WHERE updated_seq = ?"
        used = 0
        for (revision,) in revisions:
            row = connection.execute(query, [max_bytes] * len(_COLUMNS) + [revision]).fetchone()
            size = row[-1]
            locator = dict(base, updated_seq=revision, capture_generation=generation)
            if size > max_bytes:
                # The row was projected with bounded cells; don't hash a
                # fabricated substitute as if it were raw source content.
                issues.append(_issue("sqlite_record_byte_limit_retryable", locator))
                break
            if used + size > max_bytes:
                break
            value = dict(zip(_COLUMNS, row[:-1]))
            used += size
            raw_value = dict(value, updated_seq=revision)
            for flag in ("quoted", "truncated"):
                if type(value[flag]) is int and value[flag] in (0, 1):
                    value[flag] = bool(value[flag])
            value["native_revision"] = revision
            try:
                raw = _canonical(raw_value)
                records.append(_normalize(value, locator, _hash(raw), max_bytes))
            except _Invalid as error:
                issues.append(_issue(str(error), locator, _canonical(raw_value)))
            except (ValueError, TypeError, UnicodeError, RecursionError, OverflowError):
                issues.append(_issue("invalid_sqlite_record", locator))
            last = revision
        return {"records": records, "issues": issues, "cursor": {
            "version": _CURSOR_VERSION, "adapter": "sqlite", "source_id": source_id,
            "file_identity": identity, "updated_seq": last,
            "capture_generation": generation, "complete": top is None or last >= top,
        }}
    finally:
        connection.close()



def _checked_cursor(cursor):
    # A corrupted/untrusted checkpoint must not carry arbitrary private strings
    # back into persistence, diagnostics or retries. Unknown fields are ignored.
    if not cursor:
        return {}
    if cursor.get("version") != _CURSOR_VERSION or cursor.get("adapter") not in ("jsonl", "codex_jsonl", "sqlite"):
        return {}
    source = cursor.get("source_id")
    identity = cursor.get("file_identity")
    if not isinstance(source, str) or not re.fullmatch(r"[0-9a-f]{64}", source) or not isinstance(identity, list) or len(identity) != 2 or any(type(v) is not int or v < 0 for v in identity):
        return {}
    clean = {"version": _CURSOR_VERSION, "adapter": cursor["adapter"], "source_id": source, "file_identity": list(identity)}
    generation = cursor.get("capture_generation", 0)
    complete = cursor.get("complete", False)
    if type(generation) is not int or not 0 <= generation <= 2**63 - 1 or type(complete) is not bool:
        return {}
    clean.update(capture_generation=generation, complete=complete)
    if cursor["adapter"] == "sqlite":
        seq = cursor.get("updated_seq")
        if type(seq) is not int or not -1 <= seq <= 2**63 - 1:
            return {}
        clean["updated_seq"] = seq
    else:
        offset, line, prefix_hash = cursor.get("offset"), cursor.get("line"), cursor.get("prefix_hash")
        if type(offset) is not int or offset < 0 or type(line) is not int or line < 0 or not isinstance(prefix_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", prefix_hash):
            return {}
        clean.update(offset=offset, line=line, prefix_hash=prefix_hash)
    return clean


def scan(path: Path, adapter: str, cursor: dict | None, *, max_bytes: int = 1_048_576, max_records: int = 1000) -> dict:
    """Read one bounded page. Failure never advances an existing cursor."""
    if type(max_bytes) is not int or not 1 <= max_bytes <= 64 * 1_048_576 or type(max_records) is not int or not 1 <= max_records <= 100_000:
        raise ValueError("invalid scan limits")
    if not isinstance(adapter, str) or adapter not in _ALIASES:
        raise ValueError("unsupported adapter")
    if cursor is not None and not isinstance(cursor, dict):
        raise ValueError("invalid cursor")
    adapter = _ALIASES[adapter]
    cursor = _checked_cursor(cursor)
    path = Path(path)
    source_id = _source(path, adapter)
    base = {"adapter": adapter, "source_id": source_id}
    try:
        if path.is_symlink() or "/root/.codex/sessions" in str(path.resolve()):
            return {"records": [], "cursor": dict(cursor or {}), "issues": [_issue("disallowed_source", base)]}
        if not stat.S_ISREG(path.stat().st_mode):
            return {"records": [], "cursor": dict(cursor or {}), "issues": [_issue("source_not_regular", base)]}
        if adapter == "sqlite":
            return _sqlite(path, cursor, max_bytes, max_records, source_id)
        return _jsonl(path, adapter, cursor, max_bytes, max_records, source_id)
    except (OSError, sqlite3.Error):
        return {"records": [], "cursor": dict(cursor or {}), "issues": [_issue("source_unavailable_retryable", base)]}
