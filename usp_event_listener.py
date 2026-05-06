#!/usr/bin/env python3
##########################################################################
# If not stated otherwise in this file or this component's LICENSE
# file the following copyright and licenses apply:
#
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
USP Event Listener — persistent MQTT client that subscribes to device events
and pushes them to the Flask app via a callback.
"""

import threading
import time
import datetime
import uuid
import logging

import paho.mqtt.client as mqtt
import paho.mqtt.properties as mqttprops

import usp_msg_1_2_pb2 as usp_msg
import usp_record_1_2_pb2 as usp_record

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Subscription definitions
# ---------------------------------------------------------------------------
SUBSCRIPTIONS = [
    # WiFi
    {"id": "sub-wifi-radio-enable",  "type": "ValueChange",    "path": "Device.WiFi.Radio.",              "category": "wifi"},
    {"id": "sub-wifi-ssid-change",   "type": "ValueChange",    "path": "Device.WiFi.SSID.",               "category": "wifi"},
    {"id": "sub-wifi-client-join",   "type": "ObjectCreation", "path": "Device.WiFi.AccessPoint.",        "category": "wifi"},
    {"id": "sub-wifi-client-leave",  "type": "ObjectDeletion", "path": "Device.WiFi.AccessPoint.",        "category": "wifi"},
    # IoT / Hosts
    {"id": "sub-host-join",          "type": "ObjectCreation", "path": "Device.Hosts.Host.",              "category": "iot"},
    {"id": "sub-host-leave",         "type": "ObjectDeletion", "path": "Device.Hosts.Host.",              "category": "iot"},
    {"id": "sub-host-count",         "type": "ValueChange",    "path": "Device.Hosts.HostNumberOfEntries","category": "iot"},
    # DAC / Software Modules
    {"id": "sub-du-install",         "type": "OperationComplete", "path": "Device.SoftwareModules.",      "category": "dac"},
    {"id": "sub-du-creation",        "type": "ObjectCreation", "path": "Device.SoftwareModules.DeploymentUnit.", "category": "dac"},
    {"id": "sub-du-deletion",        "type": "ObjectDeletion", "path": "Device.SoftwareModules.DeploymentUnit.", "category": "dac"},
    {"id": "sub-du-status",          "type": "ValueChange",    "path": "Device.SoftwareModules.DeploymentUnit.", "category": "dac"},
    {"id": "sub-eu-status",          "type": "ValueChange",    "path": "Device.SoftwareModules.ExecutionUnit.",  "category": "dac"},
    # System
    {"id": "sub-device-boot",        "type": "Event",          "path": "Device.",                         "category": "system"},
    {"id": "sub-sw-version",         "type": "ValueChange",    "path": "Device.DeviceInfo.SoftwareVersion","category": "system"},
    # Network
    {"id": "sub-ip-status",          "type": "ValueChange",    "path": "Device.IP.Interface.",            "category": "network"},
    {"id": "sub-eth-status",         "type": "ValueChange",    "path": "Device.Ethernet.Interface.",      "category": "network"},
]

# Map notif type string -> human-readable titles / severity
_NOTIF_META = {
    "sub-wifi-radio-enable":  {"title": "WiFi Radio State Changed",         "severity": "info"},
    "sub-wifi-ssid-change":   {"title": "WiFi SSID Changed",                "severity": "info"},
    "sub-wifi-client-join":   {"title": "WiFi Client Connected",            "severity": "success"},
    "sub-wifi-client-leave":  {"title": "WiFi Client Disconnected",         "severity": "warning"},
    "sub-host-join":          {"title": "New Host Connected",               "severity": "success"},
    "sub-host-leave":         {"title": "Host Disconnected",                "severity": "warning"},
    "sub-host-count":         {"title": "Host Count Changed",               "severity": "info"},
    "sub-du-install":         {"title": "Software Module Operation",        "severity": "info"},
    "sub-du-creation":        {"title": "Deployment Unit Created",          "severity": "success"},
    "sub-du-deletion":        {"title": "Deployment Unit Deleted",          "severity": "warning"},
    "sub-du-status":          {"title": "Deployment Unit Status Changed",   "severity": "info"},
    "sub-eu-status":          {"title": "Execution Unit Status Changed",    "severity": "info"},
    "sub-device-boot":        {"title": "Device Event",                     "severity": "warning"},
    "sub-sw-version":         {"title": "Software Version Changed",         "severity": "info"},
    "sub-ip-status":          {"title": "IP Interface Status Changed",      "severity": "info"},
    "sub-eth-status":         {"title": "Ethernet Interface Status Changed","severity": "info"},
}


class USPEventListener:
    """
    Persistent MQTT client that creates USP subscriptions and dispatches
    inbound NOTIFY messages to *event_callback*.
    """

    def __init__(self, config: dict, event_callback, log_fn=None):
        """
        :param config:         USP controller config dict (broker, port, topics, IDs)
        :param event_callback: callable(event_dict) called for every inbound event
        :param log_fn:         optional callable(str) for logging; falls back to logger
        """
        self.config = config
        self.event_callback = event_callback
        self._log = log_fn if callable(log_fn) else lambda msg: logger.info(msg)

        # subscription tracking  {sub_id -> {path, type, category, instance_path}}
        self.subscriptions: dict = {}
        # pending ADD requests     {msg_id -> sub_id}
        self._pending_add: dict = {}

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._client: mqtt.Client = None
        self._props: mqttprops.Properties = None
        self._msg_counter = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self):
        """Start the listener in a background daemon thread."""
        t = threading.Thread(target=self._run_loop, daemon=True, name="USPEventListener")
        t.start()
        self._log("USPEventListener daemon thread started")

    def stop(self):
        """Graceful shutdown."""
        self._stop_event.set()
        if self._client:
            try:
                self.cleanup_subscriptions()
                self._client.disconnect()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Internal run / reconnect loop
    # ------------------------------------------------------------------

    def _run_loop(self):
        backoff = 5
        while not self._stop_event.is_set():
            try:
                self._connect_and_loop()
                backoff = 5  # reset on clean exit
            except Exception as exc:
                self._log(f"USPEventListener connection error: {exc}; retrying in {backoff}s")
                time.sleep(backoff)
                backoff = min(backoff * 2, 60)

    def _connect_and_loop(self):
        broker = self.config.get('broker', '127.0.0.1')
        port = int(self.config.get('broker_port', 1883))
        topic = self.config.get('broker_topic', '/usp/controller')

        self._log(f"USPEventListener connecting to {broker}:{port}")

        self._props = mqttprops.Properties(mqttprops.PacketTypes.PUBLISH)
        self._props.ResponseTopic = topic

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                             client_id=f"usp-event-listener-{uuid.uuid4().hex[:8]}")
        client.on_connect = self._on_connect
        client.on_message = self._on_message
        client.on_disconnect = self._on_disconnect
        self._client = client

        client.connect(broker, port, keepalive=60)
        client.loop_forever()

    # ------------------------------------------------------------------
    # MQTT callbacks
    # ------------------------------------------------------------------

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            self._log("USPEventListener connected to broker")
            topic = self.config.get('broker_topic', '/usp/controller')
            client.subscribe(topic)
            self._log(f"USPEventListener subscribed to {topic}")
            # Small delay then create subscriptions
            threading.Thread(target=self._delayed_subscribe, daemon=True).start()
        else:
            self._log(f"USPEventListener connect failed rc={rc}")

    def _delayed_subscribe(self):
        time.sleep(2)
        self.create_subscriptions()

    def _on_disconnect(self, client, userdata, flags, rc, properties=None):
        self._log(f"USPEventListener disconnected rc={rc}")

    def _on_message(self, client, userdata, msg):
        try:
            in_record = usp_record.Record()
            in_record.ParseFromString(msg.payload)

            if not in_record.HasField('no_session_context'):
                return

            in_usp = usp_msg.Msg()
            in_usp.ParseFromString(in_record.no_session_context.payload)

            msg_type = in_usp.header.msg_type

            if msg_type == usp_msg.Header.NOTIFY:
                self._handle_notify(in_usp)
            elif msg_type == usp_msg.Header.ADD_RESP:
                self._handle_add_resp(in_usp)
            elif msg_type == usp_msg.Header.DELETE_RESP:
                pass  # cleanup confirmation
            elif msg_type == usp_msg.Header.ERROR:
                self._log(f"USPEventListener received ERROR msg_id={in_usp.header.msg_id}")

        except Exception as exc:
            self._log(f"USPEventListener _on_message error: {exc}")

    # ------------------------------------------------------------------
    # Subscription management
    # ------------------------------------------------------------------

    def create_subscriptions(self):
        """Send USP ADD for all subscriptions in SUBSCRIPTIONS list."""
        for sub_def in SUBSCRIPTIONS:
            try:
                self.send_add_subscription(
                    sub_def["id"],
                    sub_def["type"],
                    sub_def["path"],
                    sub_def["category"],
                )
                time.sleep(0.3)  # small gap between ADDs
            except Exception as exc:
                self._log(f"USPEventListener failed to add subscription {sub_def['id']}: {exc}")

    def cleanup_subscriptions(self):
        """Send USP DELETE for all instance paths we created."""
        with self._lock:
            paths = [v["instance_path"] for v in self.subscriptions.values()
                     if v.get("instance_path")]
        for inst_path in paths:
            try:
                self._send_delete(inst_path)
                time.sleep(0.1)
            except Exception as exc:
                self._log(f"USPEventListener cleanup failed for {inst_path}: {exc}")

    def send_add_subscription(self, sub_id: str, notif_type: str, ref_path: str, category: str):
        """Build and publish a USP ADD message to create a subscription."""
        msg_id = self._gen_msg_id()
        from_id = self.config.get('from_id', 'self::usp-controller')

        out_msg = usp_msg.Msg()
        out_msg.header.msg_id = msg_id
        out_msg.header.msg_type = usp_msg.Header.ADD

        add_msg = usp_msg.Add()
        add_msg.allow_partial = False
        create_obj = add_msg.create_objs.add()
        create_obj.obj_path = "Device.LocalAgent.Subscription."

        for param, value, required in [
            ("Enable",     "true",      True),
            ("ID",         sub_id,      True),
            ("NotifType",  notif_type,  True),
            ("ReferenceList", ref_path, True),
            ("Recipient",  from_id,     True),
        ]:
            ps = create_obj.param_settings.add()
            ps.param = param
            ps.value = value
            ps.required = required

        out_msg.body.request.add.CopyFrom(add_msg)

        with self._lock:
            self._pending_add[msg_id] = {"sub_id": sub_id, "category": category,
                                          "path": ref_path, "type": notif_type}
            # Pre-register so we know it's pending
            self.subscriptions[sub_id] = {
                "id": sub_id, "type": notif_type, "path": ref_path,
                "category": category, "status": "pending", "instance_path": None
            }

        self._publish_record(out_msg)
        self._log(f"USPEventListener ADD subscription sent: {sub_id} ({notif_type} on {ref_path})")

    # ------------------------------------------------------------------
    # ADD_RESP handler
    # ------------------------------------------------------------------

    def _handle_add_resp(self, in_usp: usp_msg.Msg):
        msg_id = in_usp.header.msg_id
        with self._lock:
            pending = self._pending_add.pop(msg_id, None)
        if not pending:
            return

        sub_id = pending["sub_id"]
        add_resp = in_usp.body.response.add_resp
        for result in add_resp.created_obj_results:
            status = result.oper_status
            if status.HasField('oper_success'):
                inst_path = status.oper_success.instantiated_path
                with self._lock:
                    if sub_id in self.subscriptions:
                        self.subscriptions[sub_id]["instance_path"] = inst_path
                        self.subscriptions[sub_id]["status"] = "active"
                self._log(f"USPEventListener subscription active: {sub_id} → {inst_path}")
            elif status.HasField('oper_failure'):
                err = status.oper_failure.err_msg
                with self._lock:
                    if sub_id in self.subscriptions:
                        self.subscriptions[sub_id]["status"] = "failed"
                self._log(f"USPEventListener subscription failed: {sub_id} — {err}")

    # ------------------------------------------------------------------
    # NOTIFY handler and dispatcher
    # ------------------------------------------------------------------

    def _handle_notify(self, in_usp: usp_msg.Msg):
        notify = in_usp.body.request.notify
        sub_id = notify.subscription_id

        # Always send NOTIFY_RESP
        self._send_notify_resp(in_usp.header.msg_id, sub_id)

        # Look up category
        with self._lock:
            sub_info = self.subscriptions.get(sub_id, {})
        category = sub_info.get("category", "system")

        notif_field = notify.WhichOneof("notification")
        if notif_field == "value_change":
            self.handle_value_change(notify, sub_id, category)
        elif notif_field == "obj_creation":
            self.handle_object_creation(notify, sub_id, category)
        elif notif_field == "obj_deletion":
            self.handle_object_deletion(notify, sub_id, category)
        elif notif_field == "oper_complete":
            self.handle_operation_complete(notify, sub_id, category)
        elif notif_field == "event":
            self.handle_event(notify, sub_id, category)

    # ------------------------------------------------------------------
    # Specific notification type handlers
    # ------------------------------------------------------------------

    def handle_value_change(self, notify, sub_id: str, category: str):
        vc = notify.value_change
        path = vc.param_path
        value = vc.param_value
        meta = _NOTIF_META.get(sub_id, {})
        title = meta.get("title", "Value Changed")
        severity = meta.get("severity", "info")

        # Determine boot detection
        if sub_id == "sub-device-boot" or "Boot" in path:
            title = "Device Rebooted"
            severity = "warning"

        event = {
            "id": f"evt-{uuid.uuid4().hex}",
            "timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
            "category": category,
            "type": "ValueChange",
            "subscription_id": sub_id,
            "path": path,
            "value": value,
            "previous_value": None,  # filled in by app.py callback
            "title": title,
            "description": f"{path} changed to {value!r}",
            "severity": severity,
        }
        self._dispatch(event)

    def handle_object_creation(self, notify, sub_id: str, category: str):
        oc = notify.obj_creation
        obj_path = oc.obj_path
        meta = _NOTIF_META.get(sub_id, {})
        title = meta.get("title", "Object Created")
        severity = meta.get("severity", "success")

        event = {
            "id": f"evt-{uuid.uuid4().hex}",
            "timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
            "category": category,
            "type": "ObjectCreation",
            "subscription_id": sub_id,
            "obj_path": obj_path,
            "path": obj_path,
            "unique_keys": dict(oc.unique_keys),
            "title": title,
            "description": f"Object created: {obj_path}",
            "severity": severity,
        }
        self._dispatch(event)

    def handle_object_deletion(self, notify, sub_id: str, category: str):
        od = notify.obj_deletion
        obj_path = od.obj_path
        meta = _NOTIF_META.get(sub_id, {})
        title = meta.get("title", "Object Deleted")
        severity = meta.get("severity", "warning")

        event = {
            "id": f"evt-{uuid.uuid4().hex}",
            "timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
            "category": category,
            "type": "ObjectDeletion",
            "subscription_id": sub_id,
            "obj_path": obj_path,
            "path": obj_path,
            "title": title,
            "description": f"Object deleted: {obj_path}",
            "severity": severity,
        }
        self._dispatch(event)

    def handle_operation_complete(self, notify, sub_id: str, category: str):
        oc = notify.oper_complete
        path = oc.obj_path
        command = oc.command_name
        meta = _NOTIF_META.get(sub_id, {})
        title = meta.get("title", "Operation Completed")

        resp_field = oc.WhichOneof("operation_resp")
        success = resp_field == "req_output_args"
        output_args = {}
        err_msg = ""
        if success:
            output_args = dict(oc.req_output_args.output_args)
        else:
            err_msg = oc.cmd_failure.err_msg

        severity = "success" if success else "error"

        event = {
            "id": f"evt-{uuid.uuid4().hex}",
            "timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
            "category": category,
            "type": "OperationComplete",
            "subscription_id": sub_id,
            "path": path,
            "command": command,
            "success": success,
            "output_args": output_args,
            "err_msg": err_msg,
            "title": title,
            "description": f"{command} on {path}: {'succeeded' if success else 'failed — ' + err_msg}",
            "severity": severity,
        }
        self._dispatch(event)

    def handle_event(self, notify, sub_id: str, category: str):
        ev = notify.event
        obj_path = ev.obj_path
        event_name = ev.event_name
        params = dict(ev.params)
        meta = _NOTIF_META.get(sub_id, {})

        title = meta.get("title", "Device Event")
        severity = meta.get("severity", "info")

        if "Boot" in event_name:
            title = "Device Rebooted"
            severity = "warning"
        elif "TransferComplete" in event_name:
            title = "File Transfer Completed"
            severity = "success"

        event = {
            "id": f"evt-{uuid.uuid4().hex}",
            "timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
            "category": category,
            "type": "Event",
            "subscription_id": sub_id,
            "path": obj_path,
            "event_name": event_name,
            "params": params,
            "title": title,
            "description": f"Event {event_name} on {obj_path}",
            "severity": severity,
        }
        self._dispatch(event)

    # ------------------------------------------------------------------
    # Helper methods
    # ------------------------------------------------------------------

    def _dispatch(self, event: dict):
        try:
            self.event_callback(event)
        except Exception as exc:
            self._log(f"USPEventListener callback error: {exc}")

    def _send_notify_resp(self, msg_id: str, sub_id: str):
        out_msg = usp_msg.Msg()
        out_msg.header.msg_id = msg_id
        out_msg.header.msg_type = usp_msg.Header.NOTIFY_RESP
        notify_resp = usp_msg.NotifyResp()
        notify_resp.subscription_id = sub_id
        out_msg.body.response.notify_resp.CopyFrom(notify_resp)
        self._publish_record(out_msg)

    def _send_delete(self, obj_path: str):
        msg_id = self._gen_msg_id()
        out_msg = usp_msg.Msg()
        out_msg.header.msg_id = msg_id
        out_msg.header.msg_type = usp_msg.Header.DELETE
        del_msg = usp_msg.Delete()
        del_msg.allow_partial = True
        del_msg.obj_paths.append(obj_path)
        out_msg.body.request.delete.CopyFrom(del_msg)
        self._publish_record(out_msg)

    def _publish_record(self, out_msg: usp_msg.Msg):
        if not self._client:
            return
        agent_topic = self.config.get('broker_agent', '/usp/agent')
        from_id = self.config.get('from_id', 'self::usp-controller')
        to_id = self.config.get('to_id', 'proto::rx_usp_agent_mqtt')

        no_session = usp_record.NoSessionContextRecord()
        no_session.payload = out_msg.SerializeToString()
        record = usp_record.Record()
        record.version = "1.2"
        record.from_id = from_id
        record.to_id = to_id
        record.no_session_context.CopyFrom(no_session)

        payload = record.SerializeToString()
        self._client.publish(agent_topic, payload, qos=1, properties=self._props)

    def _gen_msg_id(self) -> str:
        self._msg_counter += 1
        ts = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
        return f"evt-listener-{ts}-{self._msg_counter}"
