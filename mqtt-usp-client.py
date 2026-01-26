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

# apt install python3-pip
# pip install paho-mqtt
# pip install protobuf==3.20.*


# https://usp.technology/specification/#sec:software-module-management
# https://usp.technology/specification/#sec:messages
# https://usp.technology/specification/#fig:operate-message-flow-for-synchronous-operations
# https://cwmp-data-models.broadband-forum.org/tr-181-2-17-0-cwmp.html#D.Device:2.Device.SoftwareModules.


import threading
import time
import datetime
import paho.mqtt.client as mqtt
import paho.mqtt.properties as mqttprops
import usp_msg_1_2_pb2 as usp_msg
import usp_record_1_2_pb2 as usp_record
import os
import errno
import sys
from google.protobuf.json_format import MessageToJson


# Define the MQTT server details
# MQTT_BROKER = '10.107.200.1'
# MQTT_PORT = 1883
# MQTT_TOPIC = '/usp/controller'
# USP_AGENT = '/usp/agent'
# FROM_ID = "self::usp-controller"
# TO_ID = "proto::rx_usp_agent_mqtt"


message_number = 1

timeout_seconds = 2 # Set your timeout (n) seconds here


def STDERR(*args, **kwargs):
    kwargs['flush'] = True
    kwargs['file'] = sys.stderr
    print(*args, **kwargs)


def STDOUT(*args, **kwargs):
    kwargs['flush'] = True
    kwargs['file'] = sys.stdout
    print(*args, **kwargs)


def generate_message_id():
    global message_number
    current_time = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    message_id = f"{current_time}-{message_number}"
    message_number += 1
    return message_id

def send_record(record):
    global client
    global props
    global USP_AGENT
    #STDERR(record)
    serialized_record = record.SerializeToString()
    client.publish(USP_AGENT, serialized_record, qos=1, properties=props)
    STDERR("published payload=%d bytes"%len(serialized_record))
    STDERR(serialized_record)

def send_set_message(obj_path, param, value):
    message_id = generate_message_id()
    # Create and populate the SET message
    out_msg = usp_msg.Msg()
    out_msg.header.msg_id = message_id
    out_msg.header.msg_type = usp_msg.Header.SET
    set_msg = usp_msg.Set()
    update_obj = set_msg.update_objs.add()
    update_obj.obj_path = obj_path
    update_param = update_obj.param_settings.add()
    update_param.param = param
    update_param.value = value
    out_msg.body.request.set.CopyFrom(set_msg)
    send_record(wrap_in_record(out_msg))

def send_get_message(param_path):
    message_id = generate_message_id()
    # Create and populate the GET message
    out_msg = usp_msg.Msg()
    out_msg.header.msg_id = message_id
    out_msg.header.msg_type = usp_msg.Header.GET
    get_msg = usp_msg.Get()
    get_msg.param_paths.append(param_path)
    out_msg.body.request.get.CopyFrom(get_msg)
    send_record(wrap_in_record(out_msg))

def send_add_message(obj_path, params):
    message_id = generate_message_id()
    # Create and populate the ADD message
    out_msg = usp_msg.Msg()
    out_msg.header.msg_id = message_id
    out_msg.header.msg_type = usp_msg.Header.ADD
    add_msg = usp_msg.Add()
    create_obj = add_msg.create_objs.add()
    create_obj.obj_path = obj_path
    for param, value, required in params:
        param_setting = create_obj.param_settings.add()
        param_setting.param = param
        param_setting.value = value
        param_setting.required = required
    out_msg.body.request.add.CopyFrom(add_msg)
    send_record(wrap_in_record(out_msg))

def send_delete_message(obj_path):
    message_id = generate_message_id()
    # Create and populate the DELETE message
    out_msg = usp_msg.Msg()
    out_msg.header.msg_id = message_id
    out_msg.header.msg_type = usp_msg.Header.DELETE
    delete_msg = usp_msg.Delete()
    delete_msg.obj_paths.append(obj_path)
    out_msg.body.request.delete.CopyFrom(delete_msg)
    send_record(wrap_in_record(out_msg))

def send_operate_message(command, command_key, input_args):
    message_id = generate_message_id()
    # Create and populate the OPERATE message
    out_msg = usp_msg.Msg()
    out_msg.header.msg_id = message_id
    out_msg.header.msg_type = usp_msg.Header.OPERATE
    operate_msg = usp_msg.Operate()
    operate_msg.command = command
    operate_msg.command_key = command_key
    operate_msg.send_resp = True
    for arg, value in input_args.items():
        operate_msg.input_args[arg] = value
    out_msg.body.request.operate.CopyFrom(operate_msg)
    send_record(wrap_in_record(out_msg))

def send_notify_message(subscription_id, notification):
    message_id = generate_message_id()
    # Create and populate the NOTIFY message
    out_msg = usp_msg.Msg()
    out_msg.header.msg_id = message_id
    out_msg.header.msg_type = usp_msg.Header.NOTIFY
    notify_msg = usp_msg.Notify()
    notify_msg.subscription_id = subscription_id
    # Add the appropriate notification based on type
    if notification['type'] == 'event':
        event = notify_msg.event
        event.obj_path = notification['obj_path']
        event.event_name = notification['event_name']
        for param, value in notification['params'].items():
            event.params[param] = value
    # Add other notification types here (value_change, obj_creation, etc.)
    out_msg.body.request.notify.CopyFrom(notify_msg)
    send_record(wrap_in_record(out_msg))


# Wrapper function for record
def wrap_in_record(out_msg):
    global FROM_ID
    global TO_ID
    no_session_context_record = usp_record.NoSessionContextRecord()
    no_session_context_record.payload = out_msg.SerializeToString()
    record = usp_record.Record()
    record.version = "1.2"
    record.from_id = FROM_ID
    record.to_id = TO_ID

    STDERR(f"\nrecord.to_id: {record.to_id}")
    record.no_session_context.CopyFrom(no_session_context_record)
    return record


def fifo_thread():

    global message_number

    fifo_path = '/tmp/my_fifo'
    if not os.path.exists(fifo_path):
        try:
            os.mkfifo(fifo_path)
        except OSError as oe:
            if oe.errno != errno.EEXIST:
                raise

    while True:
        with open(fifo_path, 'r') as fifo:
            #STDERR("FIFO opened for reading. Awaiting message...")
            while True:
                # Read a line from the FIFO
                # This call will block until there is data to read
                line = fifo.readline()
                # Exit loop if the line is empty, indicating the writer has closed the FIFO
                if len(line) == 0:
                    #STDERR("Writer closed the FIFO.")
                    break
                # Process the line received from the FIFO
                STDERR(f"\nReceived: {line.strip()}")
                if 'get' in line:
                    send_get_message(line.split()[1])
                if 'set' in line:
                    send_set_message(line.split()[1])
                elif 'operate' in line:
                    send_operate_message(line.split()[1])
                else:
                    STDERR("unknown message")



# Define the callback functions
def on_connect(client, userdata, flags, rc, properties=None):
    global MQTT_TOPIC
    if rc == 0:
        STDERR("Connected successfully.")
        #STDERR(properties)
        client.subscribe(MQTT_TOPIC)
        STDERR(f"Subscribed to topic: {MQTT_TOPIC}")

        if len(sys.argv) == 8:
            STDERR(f"Sending message: \"{sys.argv[7]}\"")
            if sys.argv[7].split()[0] == 'get':
                send_get_message(sys.argv[7].split()[1])

            elif sys.argv[7].split()[0] == 'set':

                #obj_path, param, value
                input_string = sys.argv[7].split()[1]
                value = sys.argv[7].split()[2]
                last_dot_index = input_string.rfind('.')
                obj_path = input_string[:last_dot_index + 1]  # Include the dot in the first part
                param = input_string[last_dot_index + 1:]

                send_set_message(obj_path, param, value)

            elif sys.argv[7].split()[0] == 'operate':
                # Extract the command including 'operate'
                full_command = sys.argv[7]

                # Split the command from 'operate' and the rest of the command
                _, command_with_args = full_command.split(' ', 1)

                # Initialize input_args as an empty dictionary by default
                input_args = {}

                # Check if there are arguments by looking for '(' and ')'
                if '(' in command_with_args and command_with_args.endswith(')'):
                    # Split the command from the arguments
                    command, args_str = command_with_args.split('(', 1)
                    args_str = args_str.rstrip(')')  # Remove the closing parenthesis

                    # Check if args_str is not empty to parse arguments
                    if args_str:
                        # Parse the arguments into a dictionary
                        for arg in args_str.split(','):
                            key, value = arg.split('=', 1)
                            input_args[key.strip()] = value.strip()

                    # Include '()' to ensure command consistency
                    command += '()'
                else:
                    # Assume no arguments were provided if '(' or ')' are missing or incorrect
                    command = command_with_args  # Use the command as is, it should already include '()'
                
                # Now, you have the command and input_args ready to use
                command_key = "unique_command_key"  # You might need a unique command key here
                
                # Example call to send_operate_message() with the parsed command and input_args
                send_operate_message(command, command_key, input_args)
            else:
                STDERR("unknown message")


    else:
        STDERR(f"Connected with result code {rc}")


def on_message(client, userdata, msg):

    global timer

    try:

        STDERR("\n----mqtt message------------------")
        STDERR("payload=%d bytes"%len(msg.payload))
        STDERR(msg.payload)

        in_usp_record = usp_record.Record()
        in_usp_record.ParseFromString(msg.payload)

        # Check which record_type is set
        if in_usp_record.HasField('no_session_context'):
            STDERR("----NoSessionContextRecord---------")
            #STDERR(in_usp_record)

            in_usp_msg = usp_msg.Msg()
            STDERR("payload=%d bytes"%len(in_usp_record.no_session_context.payload))
            in_usp_msg.ParseFromString(in_usp_record.no_session_context.payload)

            STDERR("Msg ID:", in_usp_msg.header.msg_id)
            # MsgType is an enum, so you might want to convert it to its name if available
            msg_type = in_usp_msg.header.msg_type
            msg_type_name = usp_msg.Header.MsgType.Name(msg_type)
            STDERR("Msg Type:", msg_type_name)

            #STDERR(in_usp_msg)

            # Handling different message types
            if msg_type == usp_msg.Header.ERROR:
                STDERR("Handling ERROR message")
                # Handle ERROR message
            elif msg_type == usp_msg.Header.GET:
                STDERR("Handling GET message")
                # Handle GET message

            elif msg_type == usp_msg.Header.GET_RESP:
                STDERR("Handling GET_RESP message")
                # Handle GET_RESP message
                STDOUT(MessageToJson(in_usp_msg.body.response.get_resp))

            elif msg_type == usp_msg.Header.SET_RESP:
                STDERR("Handling SET_RESP message")
                # Handle SET_RESP message
                STDOUT(MessageToJson(in_usp_msg.body.response.set_resp))

            elif msg_type == usp_msg.Header.NOTIFY:
                STDERR("Handling NOTIFY message")
                # Handle NOTIFY message

                subscription_id = in_usp_msg.body.request.notify.subscription_id
                STDERR("Subscription ID:", subscription_id)

                out_usp_msg = usp_msg.Msg()
                out_usp_msg.header.msg_id = in_usp_msg.header.msg_id
                out_usp_msg.header.msg_type = out_usp_msg.header.NOTIFY_RESP

                notify_resp = usp_msg.NotifyResp()
                notify_resp.subscription_id=subscription_id
                out_usp_msg.body.response.notify_resp.CopyFrom(notify_resp)

                send_record(wrap_in_record(out_usp_msg))


            elif msg_type == usp_msg.Header.SET:
                STDERR("Handling SET message")
                # Handle SET message
            elif msg_type == usp_msg.Header.SET_RESP:
                STDERR("Handling SET_RESP message")
                # Handle SET_RESP message
            elif msg_type == usp_msg.Header.OPERATE:
                STDERR("Handling OPERATE message")
                # Handle OPERATE message
            elif msg_type == usp_msg.Header.OPERATE_RESP:
                STDERR("Handling OPERATE_RESP message")
                # Handle OPERATE_RESP message
                STDOUT(MessageToJson(in_usp_msg.body.response.operate_resp))
            elif msg_type == usp_msg.Header.ADD:
                STDERR("Handling ADD message")
                # Handle ADD message
            elif msg_type == usp_msg.Header.ADD_RESP:
                STDERR("Handling ADD_RESP message")
                # Handle ADD_RESP message
            elif msg_type == usp_msg.Header.DELETE:
                STDERR("Handling DELETE message")
                # Handle DELETE message
            elif msg_type == usp_msg.Header.DELETE_RESP:
                STDERR("Handling DELETE_RESP message")
                # Handle DELETE_RESP message
            elif msg_type == usp_msg.Header.GET_SUPPORTED_DM:
                STDERR("Handling GET_SUPPORTED_DM message")
                # Handle GET_SUPPORTED_DM message
            elif msg_type == usp_msg.Header.GET_SUPPORTED_DM_RESP:
                STDERR("Handling GET_SUPPORTED_DM_RESP message")
                # Handle GET_SUPPORTED_DM_RESP message
            elif msg_type == usp_msg.Header.GET_INSTANCES:
                STDERR("Handling GET_INSTANCES message")
                # Handle GET_INSTANCES message
            elif msg_type == usp_msg.Header.GET_INSTANCES_RESP:
                STDERR("Handling GET_INSTANCES_RESP message")
                # Handle GET_INSTANCES_RESP message
            elif msg_type == usp_msg.Header.NOTIFY_RESP:
                STDERR("Handling NOTIFY_RESP message")
                # Handle NOTIFY_RESP message
            elif msg_type == usp_msg.Header.GET_SUPPORTED_PROTO:
                STDERR("Handling GET_SUPPORTED_PROTO message")
                # Handle GET_SUPPORTED_PROTO message
            elif msg_type == usp_msg.Header.GET_SUPPORTED_PROTO_RESP:
                STDERR("Handling GET_SUPPORTED_PROTO_RESP message")
                # Handle GET_SUPPORTED_PROTO_RESP message
            else:
                STDERR("Unknown Message Type")


        elif in_usp_record.HasField('session_context'):
            STDERR("----SessionContextRecord-----------------------")
        elif in_usp_record.HasField('websocket_connect'):
            STDERR("----WebSocketConnectRecord--------------------")
        elif in_usp_record.HasField('mqtt_connect'):
            STDERR("----MQTTConnectRecord---------------------")
            #STDERR(in_usp_record)
        elif in_usp_record.HasField('stomp_connect'):
            STDERR("----STOMPConnectRecord--------------------")
        elif in_usp_record.HasField('disconnect'):
            STDERR("----DisconnectRecord---------------------")
            # Handle DisconnectRecord
        else:
            STDERR("Unknown or no record_type set.")


    except Exception as e:
        # Handle the case where it's not a valid Protobuf message
        STDERR(f"Error decoding Protobuf message: {e}")
        STDERR("Raw payload:", msg.payload.hex())

    if len(sys.argv) == 8:
        timer.cancel()
        client.disconnect()


def exit_script():
    global timer
    global client
    timer.cancel()
    STDERR("No message received for {} seconds. Exiting...".format(timeout_seconds))
    client.disconnect() # Stop the loop before exiting


def main():

    global timer

    global client
    global props

    global MQTT_BROKER
    global MQTT_PORT
    global MQTT_TOPIC
    global USP_AGENT
    global FROM_ID
    global TO_ID


    if len(sys.argv) < 6:
        print(f"Usage: {sys.argv[0]} <MQTT BROKER> <MQTT PORT> <MQTT TOPIC> <USP AGENT> <FROM_ID> <TO_ID> [message]")
        print(f"Example: {sys.argv[0]} 10.107.200.1 1883 /usp/controller /usp/agent self::usp-controller proto::rx_usp_agent_mqtt \"get Device.DeviceInfo.SerialNumber\"")
        print(f"if no message is provided, this client will read messages from /tmp/my_fifo and prints the processing and responses")
        print(f"if a message is provided, this client will send the message, prints the processing and response, and then exits")
        sys.exit(1)

    # Assuming the command line arguments are provided in the order of MQTT_BROKER, MQTT_PORT, MQTT_TOPIC
    MQTT_BROKER = sys.argv[1]
    MQTT_PORT = int(sys.argv[2])  # Converting the port number to an integer
    MQTT_TOPIC = sys.argv[3]
    USP_AGENT = sys.argv[4]
    FROM_ID = sys.argv[5]
    TO_ID = sys.argv[6]

    STDERR(f"MQTT_BROKER: {MQTT_BROKER}")
    STDERR(f"MQTT_PORT: {MQTT_PORT}")
    STDERR(f"MQTT_TOPIC: {MQTT_TOPIC}")
    STDERR(f"USP_AGENT: {USP_AGENT}")
    STDERR(f"FROM_ID: {FROM_ID}")
    STDERR(f"TO_ID: {TO_ID}")

    props = mqttprops.Properties(mqttprops.PacketTypes.PUBLISH)
    props.ResponseTopic = '/usp/controller'

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message

    if len(sys.argv) < 7:
        STDERR(f"Starting fifo thread..")
        thread = threading.Thread(target=fifo_thread)
        thread.daemon = True  # Daemonize thread
        thread.start()

    STDERR(f"Connecting to broker..")

    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)

    except ConnectionRefusedError:
        print("Connection refused. Please check the broker address and port.")
        sys.exit(1)  # Exit the script with an error code
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        sys.exit(1)  # Exit the script with an error code


    timer = threading.Timer(timeout_seconds, exit_script)
    timer.start()

    client.loop_forever()

if __name__ == '__main__':
    main()
