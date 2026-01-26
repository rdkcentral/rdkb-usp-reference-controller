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

# https://usp.technology/specification/#sec:software-module-management
# https://cwmp-data-models.broadband-forum.org/tr-181-2-17-0-cwmp.html#D.Device:2.Device.SoftwareModules.

import sys
import subprocess
import re
import json
import time
from google.protobuf.json_format import MessageToJson
from copy import deepcopy


global cpe_serial


def banner(text, color):
    colors = {
        "red": "\033[91m",
        "green": "\033[92m",
        "white": "\033[97m",
    }
    color_code = colors.get(color.lower(), "\033[97m")  # Default to white if color not found
    end_code = "\033[0m"
    print(f"{color_code}{text}{end_code}")


def mqtt_usp_client(broker_ip, port, topic, command):
    # Prepare the command to execute the mqtt-usp-client.py script
    script_command = ['./mqtt-usp-client.py', broker_ip, str(port), topic, command]

    result = subprocess.run(script_command, capture_output=True, text=True)
    if result.returncode != 0:
        print("Error executing script:", result.stderr)
        return None

    return result.stdout


def UspPa(arg1, arg2):

    broker_ip = "10.10.10.107"
    port = 1883
    topic = "/usp/controller"

    output = None
    for attempt in range(3):

        output = mqtt_usp_client(broker_ip, port, topic, arg1 + ' ' + arg2)
        if output:
            json_output = json.loads(output)
            if arg1 == 'get':
                return(json_output['reqPathResults'][0]['resolvedPathResults'])
            elif arg1 == 'operate':
                return(json_output)
            break

        print('?')
        time.sleep(1)

'''
UspPa get Device.DeviceInfo.SerialNumber
UspPa get Device.SoftwareModules.
UspPa get Device.SoftwareModules.ExecEnv.

i686:
UspPa operate "Device.SoftwareModules.InstallDU(ExecutionEnvRef=test,UUID=sleepy,URL=https://raw.githubusercontent.com/robvogelaar/robvogelaar.github.io/main/unlisted/dac-images/dac-image-webui-v3.1-i686.tar.gz)"

arm:
UspPa operate "Device.SoftwareModules.InstallDU(ExecutionEnvRef=test,UUID=sleepy,URL=https://raw.githubusercontent.com/robvogelaar/robvogelaar.github.io/main/unlisted/dac-images/dac-image-webui-v3.1-arm.tar.gz)"

UspPa get Device.SoftwareModules.DeploymentUnit.
UspPa get Device.SoftwareModules.ExecutionUnit.

UspPa operate "Device.SoftwareModules.ExecutionUnit.1.SetRequestedState(RequestedState=Active)"
UspPa operate "Device.SoftwareModules.ExecutionUnit.1.SetRequestedState(RequestedState=Idle)"
UspPa get Device.SoftwareModules.DeploymentUnit.
UspPa operate "Device.SoftwareModules.DeploymentUnit.1.Uninstall()"
UspPa get Device.SoftwareModules.DeploymentUnit.

./mqtt-usp-client.py 10.10.10.107 1883 /usp/controller "get Device.SoftwareModules.ExecEnv."
./mqtt-usp-client.py 10.10.10.107 1883 /usp/controller "operate Device.SoftwareModules.InstallDU(ExecutionEnvRef=test,UUID=sleepy,URL=https://raw.githubusercontent.com/robvogelaar/robvogelaar.github.io/main/unlisted/dac-images/dac-image-webui-v3.1-i686.tar.gz)"

'''

def get_ees():
    ees=[]
    nr_ees = int(UspPa("get", "Device.SoftwareModules.ExecEnvNumberOfEntries")[0]["resultParams"]["ExecEnvNumberOfEntries"])
    for i in range (1, nr_ees + 1):
        ee = {}
        for key in ["Name", "Enable", "Status", "InitialRunLevel", "CurrentRunLevel"]:
            ee[key] = UspPa("get", f"Device.SoftwareModules.ExecEnv.{i}.")[0]["resultParams"][key]
        ees.append(ee)
    return ees


def get_dus():
    dus=[]
    nr_dus = int(UspPa("get", "Device.SoftwareModules.DeploymentUnitNumberOfEntries")[0]["resultParams"]["DeploymentUnitNumberOfEntries"])
    for i in range (1, nr_dus + 1):
        du = {}
        for key in ["URL", "Status", "ExecutionEnvRef", "ExecutionUnitList"]:
            du[key] = UspPa("get", f"Device.SoftwareModules.DeploymentUnit.{i}.")[0]["resultParams"][key]
        dus.append(du)
    return dus


def get_eus():
    eus = []
    nr_eus = int(UspPa("get", "Device.SoftwareModules.ExecutionUnitNumberOfEntries")[0]["resultParams"]["ExecutionUnitNumberOfEntries"])
    for i in range (1, nr_eus + 1):
        eu = {}
        for key in ["Name", "Status"]:
            eu[key] = UspPa("get", f"Device.SoftwareModules.ExecutionUnit.{i}.")[0]["resultParams"][key]
        eus.append(eu)
    return eus


def unoccupied_execenv_name(dus, ees):

    eenames = [ee['Name'] for ee in ees]

    ieenames=[]
    for iee in [du['ExecutionEnvRef'] for du in dus]:
        ieenames.append(UspPa("get", f"{iee}.")[0]["resultParams"]["Name"])

    return next((item for item in eenames if item not in ieenames), None)


def start():

    global cpe_serial

    repos={}
    repos["local"]="file:///opt/resident-container-images/"
    repos["share"]="file:///share/"
    repos["remote"]="https://raw.githubusercontent.com/robvogelaar/robvogelaar.github.io/main/unlisted/dac-images/"
    repos["server"]="http://192.168.2.120/"

    # build url
    if sys.argv[2] in ["local", "remote", "server", "share"]:
        repo = repos[sys.argv[2]]
    else:
        return
    if sys.argv[3] in ["webui", "tictactoe", "opensync", "opensync-minimal", "rbus"]:
        image = sys.argv[3]
    else:
        return
    if sys.argv[4] in ["1.0", "3.0", "3.1"]:
        version = sys.argv[4]
    else:
        return
    if cpe_serial.startswith('00163E'):
        arch = 'i686'
    else:
        arch = 'arm'
    url = repo + 'dac-image-' + image + '-v' + version + '-' + arch + '.tar.gz'


    # obtain available ee
    dus = get_dus()
    ees = get_ees()
    ee = unoccupied_execenv_name(dus, ees)
    if not ee:
        print("no available ee's")
        return

    # perfom the install
    ret = UspPa("operate", f"Device.SoftwareModules.InstallDU(ExecutionEnvRef={ee},UUID=sleepy,URL={url})")
    print(ret)

    # wait for the install completion
    match = None
    for i in range(10):
        dus = get_dus()
        match = next((entry for entry in dus if entry['URL'] == url and entry['Status'] == "Installed"), None)
        if match:
            print("Installed!")
            break
        print('.')
        time.sleep(1)

    # set requested state to active
    if match:
        ret = UspPa("operate", f"{match['ExecutionUnitList']}.SetRequestedState(RequestedState=Active)")
        print(ret)
        # wait for active
        for i in range(10):

            print(f"{match['ExecutionUnitList']}.")

            if UspPa("get", f"{match['ExecutionUnitList']}.")[0]["resultParams"]["Status"] == 'Active':
                print('Active!')
                return
            print('.')
            time.sleep(1)


def stop():

    dus = get_dus()

    for du in dus:

        if len(sys.argv) <= 2 or sys.argv[2] in du["URL"]:

            print(du)

            # set requested state to idle
            ret = UspPa("operate", f"{du['ExecutionUnitList']}.SetRequestedState(RequestedState=Idle)")
            print(ret)

            for i in range(5):
                if UspPa("get", f"{du['ExecutionUnitList']}.")[0]["resultParams"]["Status"] == 'Idle':
                    print('Idle!')
                    break
                print('.')
                time.sleep(1)

            # uninstall
            index = dus.index(du)
            ret = UspPa("operate", f"Device.SoftwareModules.DeploymentUnit.{1 + index}.Uninstall()")
            print(ret)

    return


def truncate_value(value):
    if len(value) > 40:
        return value[:10] + "..." + value[-30:]
    return value


def print_dicts_side_by_side(dicts):

    pdicts = deepcopy(dicts)
    for d in pdicts:
        for key, value in d.items():
            d[key] = truncate_value(value)

    keys = pdicts[0].keys()

    # Calculate the spacing needed for each column
    max_key_length = max(len(key) for key in keys)
    max_value_length = max(max(len(str(d[key])) for key in keys) for d in pdicts)
    column_width = max_key_length + max_value_length + 4  # For formatting ": "

    # Print header row
    for i in range(len(pdicts)):
        print(f"{i+1:<{column_width}}", end=" ")
    print()  # New line after the header

    # Print each key-value pair row
    for key in keys:
        for d in pdicts:
            print(f'"{key}": "{d[key]}"'.ljust(column_width), end=" ")
        print()  # New line after each key-value set


def list():

    ees = get_ees()
    #print(f"ees={ees}")
    #print(json.dumps(ees, indent=4))
    print('EE:')
    if len(ees) > 0:
        print_dicts_side_by_side(ees)

    dus = get_dus()
    #print(f"dus={dus}")
    #print(json.dumps(dus, indent=4))
    print('DU:')
    if len(dus) > 0:
        print_dicts_side_by_side(dus)

    eus = get_eus()
    #print(f"eus={eus}")
    #print(json.dumps(eus, indent=4))
    print('EU:')
    if len(eus) > 0:
        print_dicts_side_by_side(eus)


def help():
    help_message = """
    Usage: script.py [command]
    Commands:
        start - Start the process
        stop - Stop the process
        list - List software modules data models
        help - Display this help message
    """
    print(help_message)


def main():

    global cpe_serial

    if len(sys.argv) < 2:
        print("Invalid number of arguments. Displaying help:")
        help()
        return

    cpe_serial = UspPa("get", "Device.DeviceInfo.SerialNumber")[0]["resultParams"]["SerialNumber"]

    print(f"cpe_serial={cpe_serial}({'i686' if cpe_serial.startswith('00163E') else 'arm'})")


    arg = sys.argv[1]
    if arg == 'start':
        start()
    elif arg == 'stop':
        stop()
    elif arg == 'list':
        list()
    elif arg == 'help':
        help()
    else:
        print("Invalid command. Displaying help:")
        help()

if __name__ == "__main__":
    main()
