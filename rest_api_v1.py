##########################################################################
# Copyright 2024 RDK Management
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
###########################################################################
"""
REST API v1 Blueprint — Clean HTTP interface for third-party app companies.

Exposes TR-181 / USP data-model parameters over a simple REST API so that
app developers do NOT need to understand MQTT/USP internals — they just
call familiar GET / PATCH / POST endpoints.

Swagger UI lives at  /api/docs   (served by Flasgger).

Mapping to BBF TR-369 Swagger concepts
  BBF serviceElement GET   → GET  /api/v1/parameters?path=...
  BBF serviceElement PATCH → PATCH /api/v1/parameters
  BBF commands POST        → POST  /api/v1/commands
"""

from flask import Blueprint, request, jsonify, current_app
import logging
import re

# ---------------------------------------------------------------------------
# Seed list for top-level paths where USP GET returns nothing useful on its
# own (e.g. "Device." returns an empty response from most agents).
# Only "Device." needs seeding — all sub-paths are discovered generically.
# ---------------------------------------------------------------------------
_ROOT_CHILDREN: list = [
    "Device.DeviceInfo.", "Device.Services.", "Device.GatewayInfo.",
    "Device.Time.", "Device.UserInterface.", "Device.InterfaceStack.",
    "Device.Ethernet.", "Device.WiFi.", "Device.Bridging.",
    "Device.PPP.", "Device.IP.", "Device.Routing.",
    "Device.QoS.", "Device.Hosts.", "Device.DNS.", "Device.NAT.",
    "Device.DHCPv4.", "Device.DHCPv6.", "Device.Firewall.",
    "Device.Users.", "Device.Security.", "Device.SoftwareModules.",
    "Device.BulkData.", "Device.MQTT.", "Device.DynamicDNS.",
    "Device.LEDs.", "Device.IoTCapability.",
]

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# Blueprint registration
# ------------------------------------------------------------------
rest_api_v1_bp = Blueprint("rest_api_v1", __name__, url_prefix="/api/v1")


def _ctrl():
    return rest_api_v1_bp.controller  # injected by app.py


# ---------------------------------------------------------------------------
# Core fetch primitives
# ---------------------------------------------------------------------------

def _usp_get(ctrl, path: str) -> dict:
    """
    Direct USP GET — bypasses the large-model routing in get_parameter_chunked.
    Returns {full_path: value}.  Keys are normalised to full TR-181 paths.

    USP GET on a path ending with '.' returns ALL leaf params of that object
    and all its sub-objects recursively (TR-369 §R-GET.0).  This is the
    primary fetch strategy for any sub-path smaller than 'Device.'.
    """
    try:
        result = ctrl.usp_pa("get", path, quiet=True)
        if not result:
            return {}
        data = {}
        for item in result:
            resolved = item.get("resolvedPath", path)
            for k, v in item.get("resultParams", {}).items():
                full_k = k if k.startswith("Device.") else resolved + k
                data[full_k] = v
        return data
    except Exception:
        return {}


def _usp_get_with_fallback(ctrl, path: str) -> dict:
    """
    Try _usp_get (direct USP) first.  If it returns nothing, fall back to
    get_parameter_chunked (handles paths in app.py's large-model map).
    Always returns {full_path: value} with normalised keys.
    """
    data = _usp_get(ctrl, path)
    if data:
        return data
    try:
        res = ctrl.get_parameter_chunked(path)
        if not res or not res.get("success"):
            return {}
        raw = res.get("data") or {}
        return {
            (k if k.startswith("Device.") else path + k): v
            for k, v in raw.items()
        }
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# dmcli helper (only used when Flask runs ON the BPI-R4)
# ---------------------------------------------------------------------------

def _dmcli_sub_objects(ctrl, path: str) -> list:
    """
    Try 'dmcli getn <path>' to enumerate sub-objects.
    Works only when Flask runs directly on the BPI-R4 (dmcli can connect).
    Returns [] on macOS/off-device (rc≠0 → falls through to generic discovery).
    """
    if not getattr(ctrl, "dmcli_available", False):
        return []
    try:
        import subprocess, shlex
        dmcli_cmd = ctrl.dmcli_config.get("command", "dmcli")
        subsystem = ctrl.dmcli_config.get("subsystem", "eRT")
        shell_cmd = (
            f"{shlex.quote(dmcli_cmd)} {shlex.quote(subsystem)} "
            f"getn {shlex.quote(path.rstrip('.') + '.')}"
        )
        proc = subprocess.run(shell_cmd, shell=True, capture_output=True,
                              text=True, timeout=15)
        if proc.returncode != 0:
            return []
        return [
            m.group(1)
            for line in proc.stdout.splitlines()
            for m in [re.search(r'name:\s+(\S+\.)', line)]
            if m and m.group(1) != path
        ]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Generic sub-object inference
# ---------------------------------------------------------------------------

def _infer_sub_objects(path: str, data: dict) -> set:
    """
    Extract sub-object paths implied by deeper keys in 'data'.

    Example:
      path  = "Device.DeviceInfo."
      key   = "Device.DeviceInfo.MemoryStatus.Free"
      → sub  = "Device.DeviceInfo.MemoryStatus."

    Works whenever the USP agent returns nested params in a single GET
    (TR-369 recursive GET behaviour).  Returns set of sub-object paths.
    """
    subs = set()
    for full_key in data:
        if not full_key.startswith(path):
            continue
        relative = full_key[len(path):]          # e.g. "MemoryStatus.Free"
        parts = [p for p in relative.split(".") if p]
        if len(parts) >= 2:                       # at least one sub-level
            subs.add(path + parts[0] + ".")
    return subs


# ---------------------------------------------------------------------------
# Instance-table expansion
# ---------------------------------------------------------------------------

def _expand_table(ctrl, base: str, count: int, visited: set) -> dict:
    """
    Fetch all instances of a multi-instance TR-181 table.

    Strategy (fastest first):
      1. Wildcard GET on the table path (base + ".") — one MQTT call.
         obuspa/TR-369 agents return all instances when queried this way.
      2. Numbered instance GET — base.1., base.2., … up to count.
         Capped at MAX_INSTANCES to prevent runaway fetches.

    'base' has NO trailing dot (e.g. "Device.DeviceInfo.ProcessStatus.Process").
    """
    MAX_INSTANCES = 512
    table_path = base + "."

    # 1. Wildcard GET
    if table_path not in visited:
        data = _usp_get(ctrl, table_path)
        instance_re = re.compile(rf'^{re.escape(base)}\.\d+\.')
        if data and any(instance_re.match(k) for k in data):
            visited.add(table_path)
            logger.debug("_expand_table wildcard hit: %s → %d keys", table_path, len(data))
            return data

    # 2. Numbered instances
    result = {}
    cap = min(count, MAX_INSTANCES)
    if cap < count:
        logger.warning("_expand_table: %s has %d instances, capping at %d",
                       base, count, cap)
    for i in range(1, cap + 1):
        inst = f"{base}.{i}."
        if inst in visited:
            continue
        visited.add(inst)
        result.update(_usp_get_with_fallback(ctrl, inst))
    return result


# ---------------------------------------------------------------------------
# Generic recursive deep-fetch
# ---------------------------------------------------------------------------

def _fetch_deep(ctrl, path: str, max_depth: int = 6, _depth: int = 0,
                _visited: set = None) -> dict:
    """
    Recursively fetch ALL leaf parameters under 'path'.

    Discovery is fully generic — no hardcoded probe list needed:

      1. Direct USP GET on path  →  returns leaf params (and nested params
         if the agent supports recursive GET per TR-369 §R-GET.0).

      2. Sub-objects inferred from response keys  →  recurse into each.
         E.g. key "Device.DeviceInfo.MemoryStatus.Free" reveals sub-object
         "Device.DeviceInfo.MemoryStatus." even if it wasn't on a probe list.

      3. NumberOfEntries  →  expand instance table via wildcard GET first,
         then numbered instances as fallback.

      4. dmcli getn  →  on-device discovery (when Flask runs on BPI-R4).

    Falls back gracefully when any step fails or returns nothing.
    """
    if _visited is None:
        _visited = set()
    if path in _visited or _depth > max_depth:
        return {}
    _visited.add(path)

    data = _usp_get_with_fallback(ctrl, path)
    result = dict(data)
    sub_paths = set()

    # ---- analyse response keys -----------------------------------------------
    for full_key, value in data.items():
        # NumberOfEntries → expand instance table
        if full_key.endswith("NumberOfEntries"):
            try:
                count = int(value)
                if count > 0:
                    base = re.sub(r"NumberOfEntries$", "", full_key)
                    # base = "Device.Users.User"  (no trailing dot)
                    table_result = _expand_table(ctrl, base, count, _visited)
                    result.update(table_result)
                    # Queue numbered instance paths that weren't wildcard-fetched
                    for k in table_result:
                        m = re.match(rf'^({re.escape(base)}\.\d+\.)', k)
                        if m:
                            inst_path = m.group(1)
                            # Each instance may have its own sub-objects — recurse
                            if inst_path not in _visited:
                                sub_paths.add(inst_path)
            except (ValueError, TypeError):
                pass

    # ---- discover named sub-objects ------------------------------------------
    # Priority: infer from response keys (generic) → dmcli (on-device)
    inferred = _infer_sub_objects(path, data)
    if inferred:
        sub_paths.update(inferred)
    else:
        # USP GET was shallow (agent returned only immediate leaf params).
        # Try dmcli for on-device discovery.
        dmcli_subs = _dmcli_sub_objects(ctrl, path)
        sub_paths.update(dmcli_subs)
        # If still nothing found, there are no named sub-objects at this level.

    # ---- recurse -------------------------------------------------------------
    for sub in sorted(sub_paths - _visited):
        child = _fetch_deep(ctrl, sub, max_depth, _depth + 1, _visited)
        result.update(child)

    return result


def _fetch_root(ctrl, path: str) -> dict:
    """
    Entry point for root-level paths (Device. or paths where USP GET returns
    nothing).  Uses the seed list to bootstrap discovery, then recurses.
    """
    # Try a direct GET first (some agents handle 'Device.' fine)
    data = _usp_get_with_fallback(ctrl, path)
    inferred = _infer_sub_objects(path, data)

    if inferred:
        # Agent returned nested data — proceed normally
        return _fetch_deep(ctrl, path)

    # Agent returned nothing or only immediate leaf params for path.
    # Bootstrap with seed list or dmcli.
    dmcli_subs = _dmcli_sub_objects(ctrl, path)
    seed_subs = dmcli_subs if dmcli_subs else _ROOT_CHILDREN

    result = dict(data)
    visited: set = set()
    visited.add(path)

    for sub in sorted(seed_subs):
        child = _fetch_deep(ctrl, sub, max_depth=6, _visited=visited)
        result.update(child)

    return result


# ===========================================================================
# GET  /api/v1/parameters
# ===========================================================================
@rest_api_v1_bp.route("/parameters", methods=["GET"])
def get_parameter():
    """
    Retrieve one or more TR-181 parameter values.
    ---
    tags:
      - Parameters
    summary: Get TR-181 parameter(s)
    parameters:
      - name: path
        in: query
        required: true
        type: string
        description: >
          Dot-notation TR-181 path.
          Use a trailing dot to retrieve an entire object subtree,
          e.g. `Device.WiFi.Radio.1.` or a leaf like
          `Device.WiFi.Radio.1.Channel`.
        example: Device.DeviceInfo.SoftwareVersion
      - name: depth
        in: query
        required: false
        type: string
        enum: [shallow, full]
        default: shallow
        description: >
          `shallow` (default) returns only the immediate parameters of the object.
          `full` recursively fetches all sub-objects (e.g. ProcessStatus, MemoryStatus
          under DeviceInfo) and returns everything merged into one flat JSON map.
        example: full
      - name: bulk
        in: query
        required: false
        type: boolean
        default: false
        description: >
          When true, `path` may be a comma-separated list of paths
          and the response contains one entry per path.
        example: false
    responses:
      200:
        description: Parameter value(s) retrieved successfully.
        schema:
          $ref: '#/definitions/GetParameterResponse'
      400:
        description: Missing or invalid `path`.
        schema:
          $ref: '#/definitions/ErrorResponse'
      502:
        description: USP agent returned an error or is unreachable.
        schema:
          $ref: '#/definitions/ErrorResponse'
    definitions:
      GetParameterResponse:
        type: object
        properties:
          success:
            type: boolean
            example: true
          path:
            type: string
            example: Device.DeviceInfo.SoftwareVersion
          value:
            type: string
            example: "5.4.0-build20240901"
          data:
            type: object
            description: Present when the path is a subtree (trailing dot).
            additionalProperties:
              type: string
      ErrorResponse:
        type: object
        properties:
          success:
            type: boolean
            example: false
          error:
            type: string
            example: "Parameter fetch failed"
          path:
            type: string
    """
    raw = request.args.get("path", "").strip()
    bulk = request.args.get("bulk", "false").lower() in ("1", "true", "yes")
    depth = request.args.get("depth", "shallow").lower()

    if not raw:
        return jsonify({"success": False, "error": "Query parameter 'path' is required"}), 400

    ctrl = _ctrl()

    # Deep recursive fetch
    if depth == "full" and not bulk:
        # Broad root paths (Device. or Device.X.) where USP GET returns nothing
        # → use dmcli to enumerate children first
        dot_count = raw.rstrip(".").count(".")
        if dot_count <= 1:   # "Device." or single-level like "Device.WiFi."
            all_params = _fetch_root(ctrl, raw)
        else:
            all_params = _fetch_deep(ctrl, raw)
        if not all_params:
            return jsonify({"success": False, "error": "No parameters found or fetch failed", "path": raw}), 502
        return jsonify({"success": True, "path": raw, "depth": "full", "count": len(all_params), "data": all_params})

    if bulk:
        paths = [p.strip() for p in raw.split(",") if p.strip()]
        results = {}
        errors = {}
        for p in paths:
            try:
                res = ctrl.get_parameter_chunked(p)
                if res.get("success"):
                    results[p] = res.get("data") or res.get("value")
                else:
                    errors[p] = res.get("error", "fetch failed")
            except Exception as exc:
                errors[p] = str(exc)
        return jsonify({
            "success": len(errors) == 0,
            "results": results,
            "errors": errors,
        })

    # Single path
    try:
        res = ctrl.get_parameter_chunked(raw)
    except Exception as exc:
        logger.exception("get_parameter error for %s", raw)
        return jsonify({"success": False, "error": str(exc), "path": raw}), 502

    if not res.get("success"):
        return jsonify({"success": False, "error": res.get("error", "fetch failed"), "path": raw}), 502

    # Leaf vs. object
    resp = {"success": True, "path": raw}
    if "data" in res and isinstance(res["data"], dict) and len(res["data"]) > 1:
        resp["data"] = res["data"]
    else:
        # Normalise: might be in data[key] or directly in value
        data = res.get("data") or {}
        if data:
            # If only one key, expose as value for convenience
            vals = list(data.values())
            resp["value"] = vals[0] if len(vals) == 1 else data
        else:
            resp["value"] = res.get("value", "")
    return jsonify(resp)


# ===========================================================================
# PATCH  /api/v1/parameters
# ===========================================================================
@rest_api_v1_bp.route("/parameters", methods=["PATCH"])
def set_parameter():
    """
    Set a single TR-181 parameter value.
    ---
    tags:
      - Parameters
    summary: Set a TR-181 parameter
    consumes:
      - application/json
    parameters:
      - in: body
        name: body
        required: true
        schema:
          $ref: '#/definitions/SetParameterRequest'
    responses:
      200:
        description: Parameter set successfully.
        schema:
          $ref: '#/definitions/SetParameterResponse'
      400:
        description: Missing or invalid request body.
        schema:
          $ref: '#/definitions/ErrorResponse'
      502:
        description: USP agent returned an error or is unreachable.
        schema:
          $ref: '#/definitions/ErrorResponse'
    definitions:
      SetParameterRequest:
        type: object
        required:
          - path
          - value
        properties:
          path:
            type: string
            description: Dot-notation TR-181 parameter path (leaf only).
            example: Device.WiFi.AccessPoint.1.Security.KeyPassphrase
          value:
            type: string
            description: New value to set (always passed as string; the agent applies type coercion).
            example: "MyNewPassphrase123"
      SetParameterResponse:
        type: object
        properties:
          success:
            type: boolean
            example: true
          path:
            type: string
            example: Device.WiFi.AccessPoint.1.Security.KeyPassphrase
          value:
            type: string
            example: "MyNewPassphrase123"
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"success": False, "error": "JSON body required"}), 400

    path = body.get("path", "").strip()
    value = body.get("value")

    if not path:
        return jsonify({"success": False, "error": "Field 'path' is required"}), 400
    if value is None:
        return jsonify({"success": False, "error": "Field 'value' is required"}), 400

    ctrl = _ctrl()
    try:
        res = ctrl.set_parameter(path, str(value))
    except Exception as exc:
        logger.exception("set_parameter error for %s", path)
        return jsonify({"success": False, "error": str(exc), "path": path}), 502

    if not res.get("success"):
        return jsonify({"success": False, "error": res.get("error", "set failed"), "path": path}), 502

    return jsonify({"success": True, "path": path, "value": str(value)})


# ===========================================================================
# POST  /api/v1/parameters/bulk
# ===========================================================================
@rest_api_v1_bp.route("/parameters/bulk", methods=["POST"])
def bulk_set_parameters():
    """
    Set multiple TR-181 parameters in a single request.
    ---
    tags:
      - Parameters
    summary: Bulk-set TR-181 parameters
    consumes:
      - application/json
    parameters:
      - in: body
        name: body
        required: true
        schema:
          $ref: '#/definitions/BulkSetRequest'
    responses:
      200:
        description: All parameters set (or partial success — check per-path status).
        schema:
          $ref: '#/definitions/BulkSetResponse'
      400:
        description: Missing or invalid request body.
        schema:
          $ref: '#/definitions/ErrorResponse'
    definitions:
      BulkSetRequest:
        type: object
        required:
          - parameters
        properties:
          parameters:
            type: array
            description: List of path/value pairs to set.
            items:
              type: object
              required:
                - path
                - value
              properties:
                path:
                  type: string
                  example: Device.WiFi.Radio.1.Channel
                value:
                  type: string
                  example: "6"
      BulkSetResponse:
        type: object
        properties:
          success:
            type: boolean
            description: True only when ALL parameters were set without error.
          results:
            type: object
            description: Map of path → result for each parameter.
            additionalProperties:
              type: object
              properties:
                success:
                  type: boolean
                error:
                  type: string
    """
    body = request.get_json(silent=True)
    if not body or "parameters" not in body:
        return jsonify({"success": False, "error": "JSON body with 'parameters' array required"}), 400

    params = body["parameters"]
    if not isinstance(params, list) or not params:
        return jsonify({"success": False, "error": "'parameters' must be a non-empty array"}), 400

    ctrl = _ctrl()
    results = {}
    overall = True
    for item in params:
        path = (item.get("path") or "").strip()
        value = item.get("value")
        if not path or value is None:
            results[path or "<missing>"] = {"success": False, "error": "path and value required"}
            overall = False
            continue
        try:
            res = ctrl.set_parameter(path, str(value))
            ok = res.get("success", False)
            results[path] = {"success": ok, "error": res.get("error") if not ok else None}
            if not ok:
                overall = False
        except Exception as exc:
            results[path] = {"success": False, "error": str(exc)}
            overall = False

    return jsonify({"success": overall, "results": results})


# ===========================================================================
# POST  /api/v1/commands
# ===========================================================================
@rest_api_v1_bp.route("/commands", methods=["POST"])
def execute_command():
    """
    Execute a USP Operate command on the agent (e.g. WiFi scan, reboot).
    ---
    tags:
      - Commands
    summary: Execute a USP Operate command
    consumes:
      - application/json
    parameters:
      - in: body
        name: body
        required: true
        schema:
          $ref: '#/definitions/CommandRequest'
    responses:
      200:
        description: Command executed successfully.
        schema:
          $ref: '#/definitions/CommandResponse'
      400:
        description: Missing or invalid body.
        schema:
          $ref: '#/definitions/ErrorResponse'
      502:
        description: USP agent error.
        schema:
          $ref: '#/definitions/ErrorResponse'
    definitions:
      CommandRequest:
        type: object
        required:
          - command
        properties:
          command:
            type: string
            description: >
              USP Operate command path,
              e.g. `Device.WiFi.Radio.1.X_RDK_Scan()`.
            example: Device.WiFi.Radio.1.X_RDK_Scan()
          args:
            type: object
            description: Optional input arguments for the command.
            additionalProperties:
              type: string
      CommandResponse:
        type: object
        properties:
          success:
            type: boolean
          output:
            type: object
            description: Output arguments returned by the command.
          raw:
            type: string
            description: Raw USP response text (useful for debugging).
    """
    body = request.get_json(silent=True)
    if not body or not body.get("command"):
        return jsonify({"success": False, "error": "JSON body with 'command' field required"}), 400

    command = body["command"].strip()
    args = body.get("args", {})

    ctrl = _ctrl()
    try:
        # Build USP Operate command string.
        # TR-369 Operate format: all args go INSIDE the command parentheses
        # as comma-separated key=value pairs, e.g.:
        #   Device.SoftwareModules.InstallDU(ExecutionEnvRef=default,URL=http://...)
        # This applies to ALL Operate commands, not just InstallDU.
        if args:
            arg_str = ",".join(f"{k}={v}" for k, v in args.items())
            cmd_base = command.rstrip("()")   # strip trailing () if present
            full_command = f"{cmd_base}({arg_str})"
            result = ctrl.usp_pa_with_timeout("operate", full_command)
        else:
            result = ctrl.usp_pa_with_timeout("operate", command)
    except Exception as exc:
        logger.exception("command error for %s", command)
        return jsonify({"success": False, "error": str(exc)}), 502

    if result is None:
        return jsonify({"success": False, "error": "No response from USP agent"}), 502

    parsed = ctrl._parse_operate_output_args(result) if hasattr(ctrl, "_parse_operate_output_args") else {}
    return jsonify({"success": True, "output": parsed, "raw": str(result)})


# ===========================================================================
# GET  /api/v1/status
# ===========================================================================
@rest_api_v1_bp.route("/status", methods=["GET"])
def api_status():
    """
    Return USP controller and agent connection status.
    ---
    tags:
      - Status
    summary: Controller / agent health
    responses:
      200:
        description: Status information.
        schema:
          type: object
          properties:
            success:
              type: boolean
            endpoint_id:
              type: string
              example: proto::rdkb-usp-controller
            agent_connected:
              type: boolean
            mqtt_broker:
              type: string
              example: "192.168.1.1:1883"
            supported_models_count:
              type: integer
    """
    ctrl = _ctrl()
    return jsonify({
        "success": True,
        "endpoint_id": getattr(ctrl, "endpoint_id", "unknown"),
        "agent_connected": getattr(ctrl, "connected", False),
        "mqtt_broker": f"{getattr(ctrl, 'broker', 'unknown')}:{getattr(ctrl, 'port', 1883)}",
        "supported_models_count": len(getattr(ctrl, "supported_data_models", [])),
        "dmcli_available": getattr(ctrl, "dmcli_available", False),
    })


# ===========================================================================
# GET  /api/v1/debug/dmcli?path=Device.DeviceInfo.
# Quick diagnostic: run dmcli getnames on a path and return raw output
# ===========================================================================
@rest_api_v1_bp.route("/debug/dmcli", methods=["GET"])
def debug_dmcli():
    """
    Debug endpoint: run dmcli getnames on a TR-181 path.
    ---
    tags:
      - Status
    summary: Raw dmcli getnames output for a path (debug only)
    parameters:
      - in: query
        name: path
        type: string
        required: true
        example: Device.DeviceInfo.
    responses:
      200:
        description: dmcli output and parsed sub-objects
    """
    path = request.args.get("path", "").strip()
    if not path:
        return jsonify({"error": "path required"}), 400
    ctrl = _ctrl()
    dmcli_subs = _dmcli_sub_objects(ctrl, path)
    usp_data   = _usp_get(ctrl, path)
    inferred   = sorted(_infer_sub_objects(path, usp_data))
    return jsonify({
        "path": path,
        "dmcli_available": getattr(ctrl, "dmcli_available", False),
        "dmcli_sub_objects": dmcli_subs,
        "usp_direct_param_count": len(usp_data),
        "usp_inferred_sub_objects": inferred,
        "combined_sub_objects": sorted(set(dmcli_subs) | set(inferred)),
    })


# ===========================================================================
# GET  /api/v1/debug/usp_get?path=Device.DeviceInfo.ProcessStatus.
# Raw USP GET response for a path — shows exactly what the agent returns
# ===========================================================================
@rest_api_v1_bp.route("/debug/usp_get", methods=["GET"])
def debug_usp_get():
    """
    Debug endpoint: raw USP GET response for a TR-181 path.
    Shows what get_parameter_chunked() returns including NumberOfEntries keys.
    ---
    tags:
      - Status
    summary: Raw USP GET response for a path (debug only)
    parameters:
      - in: query
        name: path
        type: string
        required: true
        example: Device.DeviceInfo.ProcessStatus.
    responses:
      200:
        description: USP GET response with parsed NumberOfEntries values
    """
    path = request.args.get("path", "").strip()
    if not path:
        return jsonify({"error": "path required"}), 400
    ctrl = _ctrl()
    # Use direct USP GET (bypasses large-model routing) to show raw agent response
    data = _usp_get(ctrl, path)
    if not data:
        # Fallback to get_parameter_chunked
        try:
            res = ctrl.get_parameter_chunked(path)
            raw = res.get("data") or {} if res.get("success") else {}
            data = {(k if k.startswith("Device.") else path + k): v for k, v in raw.items()}
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    entries_keys = {k: v for k, v in data.items() if "NumberOfEntries" in k}
    inferred_subs = sorted(_infer_sub_objects(path, data))
    return jsonify({
        "path": path,
        "param_count": len(data),
        "inferred_sub_objects": inferred_subs,
        "params": data,
        "entries_keys": entries_keys,
        "would_expand": {
            k: {
                "count": v,
                "base": re.sub(r"NumberOfEntries$", "", k),
                "wildcard_path": re.sub(r"NumberOfEntries$", "", k) + ".",
                "sample_instances": [
                    f"{re.sub(r'NumberOfEntries$', '', k)}.{i}."
                    for i in range(1, min(int(v), 5) + 1)
                ] if str(v).isdigit() and 0 < int(v) <= 512 else "skipped"
            }
            for k, v in entries_keys.items()
        },
    })
