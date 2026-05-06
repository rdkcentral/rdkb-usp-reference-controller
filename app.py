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
Flask USP Controller with Dynamic Data Model Discovery and Large Model Support
Enhanced version with chunked discovery for large data models like DeviceInfo
"""
from flask import Flask, request, render_template, jsonify, redirect, url_for
import json
import subprocess
import re
import time
import logging
import os
from html import escape as html_escape
from typing import Dict, List, Any, Optional, Set

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
app = Flask(__name__)

class USPController:
    """Enhanced USP Controller with dynamic data model discovery and large model support"""
    
    def __init__(self):
        # Default configuration - matching your existing pattern
        self.config = {
            'broker': "10.26.60.86",
            'broker_port': "1883",
            'broker_topic': "/usp/controller",
            'broker_agent': "/usp/agent",
            'from_id': "self::usp-controller",
            'to_id': "proto::rx_usp_agent_mqtt"
        }
        
        # dmcli configuration
        self.dmcli_config = {
            'component': 'eRT.com.cisco.spvtg.ccsp.C',
            'command': 'dmcli',
            'subsystem': 'eRT'
        }
        
        # State
        self.connected = False
        self.connected_serial = ""
        self.logs = []
        self.logs2 = []
        self.data_model = {}
        self.dmcli_available = False
        self.discovered_paths = []
        self.supported_data_models = {}
        
        # MQTT USP Client path - matching your existing setup
        self.mqtt_client_path = './mqtt-usp-client.py'
        if not os.path.exists(self.mqtt_client_path):
            self.mqtt_client_path = '/usr/lib/cgi-bin/mqtt-usp-client.py'
        
        # Repository configuration - matching your existing repos
        self.repos = {
            "local": "file:///opt/resident-container-images/",
            "share": "file:///share/",
            "remote": "https://raw.githubusercontent.com/robvogelaar/robvogelaar.github.io/main/unlisted/dac-images/",
            "server": "http://10.26.60.86/"
        }
        
        # Initialize on startup
        self.initialize()
    
    def initialize(self):
        """Initialize controller with dynamic discovery - enhanced for large models"""
        self.log("Initializing USP Controller with dynamic discovery (large model support)...")
        
        # Check dmcli availability
        self.check_dmcli_availability()
        
        # Test USP connection first
        self.test_usp_connection()
        
        # Discover supported data models dynamically
        #if self.dmcli_available:
            #self.log("dmcli available - discovering supported data models")
            #self.discover_supported_data_models_dmcli()
            #if self.discovered_paths:
                # Use chunked discovery for large models
                #self.discover_data_model_dmcli_chunked()
        
        # Always try USP discovery as well
        if self.connected:
            self.log("USP connected - discovering via USP")
            if not self.discovered_paths:
                self.discover_supported_data_models_usp()
            # Use chunked discovery for USP as well
            self.discover_data_model_usp_chunked()
    
    def test_usp_connection(self):
        """Test USP connection - matching your existing pattern"""
        try:
            self.log("Testing USP connection...")
            
            # Try multiple common parameters to test connection
            test_params = [
                "Device.DeviceInfo.SerialNumber",
                "Device.DeviceInfo.Manufacturer",
                "Device.DeviceInfo.ModelName"
            ]
            
            for param in test_params:
                try:
                    ret = self.usp_pa("get", param, True)
                    
                    if ret and len(ret) > 0:
                        result_params = ret[0].get("resultParams", {})
                        if result_params:  # If we got any parameters back
                            # Extract the parameter name from the path
                            param_name = param.split('.')[-1]
                            if param_name in result_params:
                                value = result_params[param_name]
                                self.connected = True
                                if param_name == "SerialNumber" and value:
                                    self.connected_serial = value
                                elif not self.connected_serial:
                                    self.connected_serial = "USP-Connected"
                                self.log(f"Connected to device via {param}: {value}")
                                return True
                except Exception as e:
                    self.log(f"Failed to test {param}: {e}")
                    continue
            
            self.log("USP connection failed")
            self.connected = False
            self.connected_serial = ""
            return False
            
        except Exception as e:
            self.log(f"USP connection error: {e}")
            self.connected = False
            self.connected_serial = ""
            return False
    
    def usp_pa(self, arg1: str, arg2: str, quiet: bool = False) -> Optional[List[Dict]]:
        """USP communication function - matching your existing UspPa pattern"""
        #self.log("Inside usp_pa ...")   
        try:
            #self.log("Inside 1 usp_pa ...")
            if not quiet:
                self.log(f"USP Command: {arg1} {arg2}")
            #self.log("Inside 2 usp_pa ...") 
            output = self.mqtt_usp_client(arg1 + ' ' + arg2, quiet)
            #self.log("Inside 3 usp_pa ...") 
            if not output:
                if not quiet:
                    self.log("No output from mqtt_usp_client")
                return None
            
            if not quiet:
                self.log(f"USP Raw output length: {len(output)} chars")
            
            try:
                json_output = json.loads(output)
                if not quiet:
                    self.log(f"JSON parsed successfully, keys: {list(json_output.keys())}")
            except json.JSONDecodeError as e:
                if not quiet:
                    self.log(f"JSON decode error: {e}")
                    self.log(f"Raw output: {output[:200]}...")
                return None
            
            if arg1 == 'get':
                try:
                    result = json_output['reqPathResults'][0]['resolvedPathResults']
                    if not quiet:
                        self.log(f"GET result: {len(result)} items")
                    return result
                except (KeyError, IndexError) as e:
                    if not quiet:
                        self.log(f"Error accessing GET result structure: {e}")
                        self.log(f"JSON structure: {json_output}")
                    return None
            elif arg1 in ['set', 'operate']:
                return json_output
            
            return json_output
            
        except Exception as e:
            if not quiet:
                self.log(f"USP error: {e}")
            return None
    
    def usp_pa_with_timeout(self, arg1: str, arg2: str, quiet: bool = False, timeout: int = 30) -> Optional[List[Dict]]:
        """USP communication with configurable timeout for large data models"""
        try:
            if not quiet:
                self.log(f"USP Command (timeout {timeout}s): {arg1} {arg2}")
            
            output = self.mqtt_usp_client_with_timeout(arg1 + ' ' + arg2, quiet, timeout)
            
            if not output:
                if not quiet:
                    self.log("No output from mqtt_usp_client")
                return None
            
            if not quiet:
                self.log(f"USP Raw output length: {len(output)} chars")
            
            try:
                json_output = json.loads(output)
                if not quiet:
                    self.log(f"JSON parsed successfully, keys: {list(json_output.keys())}")
            except json.JSONDecodeError as e:
                if not quiet:
                    self.log(f"JSON decode error: {e}")
                    self.log(f"Raw output: {output[:200]}...")
                return None
            
            if arg1 == 'get':
                try:
                    result = json_output['reqPathResults'][0]['resolvedPathResults']
                    if not quiet:
                        self.log(f"GET result: {len(result)} items")
                    return result
                except (KeyError, IndexError) as e:
                    if not quiet:
                        self.log(f"Error accessing GET result structure: {e}")
                    return None
            elif arg1 in ['set', 'operate']:
                return json_output
            
            return json_output
            
        except Exception as e:
            if not quiet:
                self.log(f"USP error: {e}")
            return None
    
    def mqtt_usp_client(self, command: str, quiet: bool = False) -> Optional[str]:
        """Execute MQTT USP client - matching your existing pattern"""
        return self.mqtt_usp_client_with_timeout(command, quiet, 30)
    
    def mqtt_usp_client_with_timeout(self, command: str, quiet: bool = False, timeout: int = 30) -> Optional[str]:
        """Execute MQTT USP client with configurable timeout"""
        if not quiet:
            self.log(f"Executing USP (timeout {timeout}s): {command}")
        #self.log("Inside mqtt_usp_client_with_timeout ...") 
        try:
            cmd = [
                'python3', self.mqtt_client_path,
                self.config['broker'],
                self.config['broker_port'],
                self.config['broker_topic'],
                self.config['broker_agent'],
                self.config['from_id'],
                self.config['to_id'],
                command
            ]
            #self.log("Inside mqtt_usp_client_with_timeout 1 ...")     
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            #self.log(f"DEBUG: subprocess completed with return code: {result.returncode}")
            #self.log("Inside mqtt_usp_client_with_timeout 2 ...") 
            if result.returncode != 0:
                self.log(f"DEBUG: Command failed with return code {result.returncode}")
                if not quiet:
                    self.log(f"USP client error: {result.stderr}")
                return None
            
            return result.stdout
            
        except subprocess.TimeoutExpired:
            self.log(f"USP command timeout ({timeout}s)")
            return None
        except Exception as e:
            self.log(f"USP execution error: {e}")
            return None
    
    def is_potentially_large_datamodel(self, path: str) -> bool:
        """Check if a data model path is potentially large and needs special handling"""
        large_datamodels = [
            "Device.DeviceInfo.",
            "Device.SoftwareModules.",
            "Device.Diagnostics.",
            "Device.Ethernet.",
            "Device.WiFi.",
            "Device.IP.",
            "Device.Hosts.",
            "Device.Bridging.",
            "Device.Routing."
        ]
        
        # Check for vendor-specific models that are typically large
        vendor_large_patterns = [
            "X_CISCO_COM_Diagnostics",
            "X_RDKCENTRAL-COM_",
            "X_RDK_"
        ]
        
        return (path in large_datamodels or 
                any(pattern in path for pattern in vendor_large_patterns))
    
    def get_known_sub_objects(self, path: str) -> List[str]:
        """Get known sub-objects for large data models to enable chunked discovery"""
        sub_objects_map = {
            "Device.DeviceInfo.": [
                "Device.DeviceInfo.SerialNumber",
                "Device.DeviceInfo.Manufacturer", 
                "Device.DeviceInfo.ModelName",
                "Device.DeviceInfo.Description",
                "Device.DeviceInfo.ProductClass",
                "Device.DeviceInfo.ManufacturerOEM",
                "Device.DeviceInfo.ModelNumber",
                "Device.DeviceInfo.HardwareVersion",
                "Device.DeviceInfo.SoftwareVersion",
                "Device.DeviceInfo.UpTime",
                "Device.DeviceInfo.FirstUseDate"
            ],
            "Device.SoftwareModules.": [
                "Device.SoftwareModules.ExecEnv.",
                "Device.SoftwareModules.DeploymentUnit.",
                "Device.SoftwareModules.ExecutionUnit."
            ],
            "Device.Ethernet.": [
                "Device.Ethernet.Interface.",
                "Device.Ethernet.Link.",
                "Device.Ethernet.VLANTermination."
            ],
            "Device.IP.": [
                "Device.IP.Interface.",
                "Device.IP.ActivePort.",
                "Device.IP.Diagnostics."
            ],
            "Device.WiFi.": [
                "Device.WiFi.Radio.",
                "Device.WiFi.SSID.",
                "Device.WiFi.AccessPoint.",
                "Device.WiFi.EndPoint."
            ]
        }
        
        return sub_objects_map.get(path, [])
    
    def get_test_parameters_for_path(self, path: str) -> List[str]:
        """Get specific test parameters for common large data models"""
        test_params_map = {
            "Device.DeviceInfo.": [
                "Device.DeviceInfo.SerialNumber",
                "Device.DeviceInfo.Manufacturer",
                "Device.DeviceInfo.ModelName"
            ],
            "Device.SoftwareModules.": [
                "Device.SoftwareModules.ExecEnvNumberOfEntries",
                "Device.SoftwareModules.DeploymentUnitNumberOfEntries"
            ],
            "Device.Ethernet.": [
                "Device.Ethernet.InterfaceNumberOfEntries",
                "Device.Ethernet.LinkNumberOfEntries"
            ],
            "Device.IP.": [
                "Device.IP.InterfaceNumberOfEntries",
                "Device.IP.ActivePortNumberOfEntries"
            ],
            "Device.Diagnostics.": [
                "Device.Diagnostics.IPPing.",
                "Device.Diagnostics.TraceRoute."
            ],
            "Device.WiFi.": [
                "Device.WiFi.RadioNumberOfEntries",
                "Device.WiFi.SSIDNumberOfEntries"
            ],
            "Device.Hosts.": [
                "Device.Hosts.HostNumberOfEntries"
            ]
        }
        
        return test_params_map.get(path, [path.rstrip('.') + ".Enable", path.rstrip('.') + ".Status"])
    
    def test_datamodel_accessibility(self, path: str) -> bool:
        """Test if a large data model is accessible using lightweight queries"""
        try:
            # Method 1: Try to get a specific common parameter
            test_params = self.get_test_parameters_for_path(path)
            
            for test_param in test_params:
                try:
                    result = self.usp_pa("get", test_param, True)
                    if result and len(result) > 0:
                        params = result[0].get('resultParams', {})
                        if params:
                            self.log(f"✓ Accessibility confirmed via {test_param}")
                            return True
                except Exception:
                    continue
            
            # Method 2: Try the object path with a short timeout
            try:
                result = self.usp_pa_with_timeout("get", path, True, 10)
                
                if result and len(result) > 0:
                    # Check if we got at least some parameters
                    total_params = sum(len(item.get('resultParams', {})) for item in result)
                    if total_params > 0:
                        self.log(f"✓ Large model accessible with {total_params} parameters")
                        return True
                
            except Exception as e:
                self.log(f"Large model test failed: {e}")
            
            return False
            
        except Exception as e:
            self.log(f"Error testing large data model accessibility: {e}")
            return False
    
    def get_dynamic_data_model_paths(self) -> List[str]:
        """Get available data model paths dynamically from the device"""
        dynamic_paths = []
        
        try:
            # Method 1: Try to use dmcli if available to get all Device.* paths
            #if self.dmcli_available:
                #self.log("Attempting dynamic path discovery via dmcli...")
                #output = self.execute_dmcli("getnames Device.", True)
                #if output:
                    #paths = self.parse_dmcli_names_output(output)
                    #if paths:
                        # Filter paths to only include object paths (ending with .)
                        #object_paths = [path for path in paths if path.endswith('.') and path != 'Device.']
                        #if object_paths:
                            #self.log(f"Found {len(object_paths)} object paths via dmcli")
                            #return object_paths
            
            # Method 2: Try USP get on Device. to discover top-level objects
            self.log("Attempting dynamic path discovery via USP Device. query...")
            try:
                result = self.usp_pa("get", "Device.", True)
                if result and len(result) > 0:
                    discovered_paths = set()
                    
                    for item in result:
                        resolved_path = item.get('resolvedPath', '')
                        if resolved_path and resolved_path != 'Device.':
                            # Extract the top-level object path
                            parts = resolved_path.strip('.').split('.')
                            if len(parts) >= 2:  # Device.Something
                                # Build the object path
                                object_path = f"{parts[0]}.{parts[1]}."
                                discovered_paths.add(object_path)
                    
                    if discovered_paths:
                        dynamic_paths = sorted(list(discovered_paths))
                        self.log(f"Found {len(dynamic_paths)} object paths via USP Device. query")
                        return dynamic_paths
            except Exception as e:
                self.log(f"USP Device. query failed: {e}")
            
            # Method 3: Use device-specific paths from dmcli output
            if hasattr(self, 'discovered_paths') and self.discovered_paths:
                self.log("Using previously discovered dmcli paths")
                return self.discovered_paths
            
            # Method 4: Use actual device paths from your dmcli output
            self.log("Using device-specific paths from dmcli output reference")
            return self.get_paths_from_dmcli_output()
            
        except Exception as e:
            self.log(f"Error in dynamic path discovery: {e}")
        
        return dynamic_paths
    
    def get_paths_from_dmcli_output(self) -> List[str]:
        """Extract paths from the dmcli output - based on actual device output"""
        device_paths = [
            "Device.CR.",
            "Device.X_RDK_Ethernet.", 
            "Device.DeviceInfo.",
            "Device.Cellular.",
            "Device.X_RDK_WanManager.",
            "Device.DHCPv4.",
            "Device.DHCPv6.",
            "Device.X_RDKCENTRAL-COM_DeviceControl.",
            "Device.X_RDKCENTRAL-COM_XPC.",
            "Device.DSLite.",
            "Device.GatewayInfo.",
            "Device.Time.",
            "Device.GRE.",
            "Device.UserInterface.",
            "Device.InterfaceStack.",
            "Device.Ethernet.",
            "Device.PPP.",
            "Device.IP.",
            "Device.Routing.",
            "Device.DNS.",
            "Device.Firewall.",
            "Device.NAT.",
            "Device.Users.",
            "Device.UPnP.",
            "Device.X_CISCO_COM_DDNS.",
            "Device.DynamicDNS.",
            "Device.X_CISCO_COM_Security.",
            "Device.X_CISCO_COM_DeviceControl.",
            "Device.Bridging.",
            "Device.RouterAdvertisement.",
            "Device.NeighborDiscovery.",
            "Device.IPv6rd.",
            "Device.X_CISCO_COM_MLD.",
            "Device.X_CISCO_COM_Diagnostics.",
            "Device.X_Comcast_com_ParentalControl.",
            "Device.X_CISCO_COM_MultiLAN.",
            "Device.X_COMCAST_COM_GRE.",
            "Device.X_COMCAST-COM_GRE.",
            "Device.X_CISCO_COM_GRE.",
            "Device.X_COMCAST-COM_Xcalibur.",
            "Device.X_RDKCENTRAL-COM_VideoService.",
            "Device.Hosts.",
            "Device.XHosts.",
            "Device.X_RDKCENTRAL-COM_Report.",
            "Device.ManagementServer.",
            "Device.X_RDKCENTRAL-COM_EthernetWAN.",
            "Device.NotifyComponent.",
            "Device.Diagnostics.",
            "Device.X_RDK_DNSInternet.",
            "Device.X_RDKCENTRAL-COM_XDNS.",
            "Device.X_RDK_Xmidt.",
            "Device.SelfHeal.",
            "Device.PowerManagement.",
            "Device.Thermal.",
            "Device.X_RDK_hwHealthTest.",
            "Device.QOS.",
            "Device.Webpa.",
            "Device.X_RDK_Webpa.",
            "Device.X_RDKCENTRAL-COM_Webpa.",
            "Device.X_RDK_WebConfig.",
            "Device.SoftwareModules."
        ]
        
        # Remove duplicates while preserving order
        unique_paths = []
        seen = set()
        for path in device_paths:
            if path not in seen:
                unique_paths.append(path)
                seen.add(path)
        
        self.log(f"Using device-specific paths from dmcli output: {len(unique_paths)} paths")
        return unique_paths
    
    def discover_supported_data_models_usp(self) -> bool:
        """Dynamically discover supported data models using USP - enhanced for large data models"""
        try:
            self.log("Discovering supported data models via USP...")
            
            # First, try to get available paths dynamically
            dynamic_paths = self.get_dynamic_data_model_paths()
            
            if dynamic_paths:
                self.log(f"Using {len(dynamic_paths)} dynamically discovered paths")
                test_paths = dynamic_paths
            else:
                self.log("Dynamic discovery failed, using fallback paths")
                # Fallback to essential paths only for initial testing
                test_paths = [
                    "Device.DeviceInfo.",
                    "Device.SoftwareModules.",
                    "Device.ManagementServer.",
                    "Device.Time.",
                    "Device.Ethernet.",
                    "Device.IP."
                ]
            
            working_paths = []
            
            # Test paths with lightweight queries first
            for path in test_paths:
                try:
                    self.log(f"Testing path: {path}")
                    
                    # For large data models, test with a lightweight query first
                    if self.is_potentially_large_datamodel(path):
                        # Try to get just one parameter to test accessibility
                        test_result = self.test_datamodel_accessibility(path)
                        if test_result:
                            working_paths.append(path)
                            self.log(f"✓ Large data model accessible: {path}")
                        else:
                            self.log(f"✗ Large data model not accessible: {path}")
                    else:
                        # For smaller data models, use the full query
                        result = self.usp_pa("get", path, True)
                        
                        if result and len(result) > 0:
                            has_params = any(item.get('resultParams', {}) for item in result)
                            if has_params:
                                working_paths.append(path)
                                self.log(f"✓ Found working path: {path}")
                            else:
                                self.log(f"✗ Path exists but no parameters: {path}")
                        else:
                            self.log(f"✗ Path not accessible: {path}")
                        
                except Exception as e:
                    self.log(f"✗ Error testing {path}: {e}")
                    continue
            
            if working_paths:
                self.discovered_paths = working_paths
                self.log(f"Discovered {len(working_paths)} working data model paths via USP:")
                for i, path in enumerate(working_paths):
                    self.log(f"  {i+1}. {path}")
                return True
            else:
                self.log("No working data model paths found via USP")
                return False
            
        except Exception as e:
            self.log(f"Error discovering supported data models via USP: {e}")
            return False
    
    def discover_supported_data_models_dmcli(self) -> bool:
        """Dynamically discover supported data models using dmcli"""
        try:
            self.log("Discovering supported data models via dmcli...")
            
            # Get all top-level objects under Device
            output = self.execute_dmcli("getnames Device.", True)
            
            if not output:
                self.log("Failed to get device names via dmcli")
                return False
            
            # Parse the output to extract parameter names
            paths = self.parse_dmcli_names_output(output)
            
            if not paths:
                self.log("No paths found in dmcli output")
                return False
            
            # Store discovered paths
            self.discovered_paths = paths
            self.log(f"Discovered {len(paths)} data model paths via dmcli:")
            for i, path in enumerate(paths[:10]):  # Log first 10
                self.log(f"  {i+1}. {path}")
            if len(paths) > 10:
                self.log(f"  ... and {len(paths) - 10} more")
            
            return True
            
        except Exception as e:
            self.log(f"Error discovering supported data models via dmcli: {e}")
            return False
    
    def parse_dmcli_names_output(self, output: str) -> List[str]:
        """Parse dmcli getnames output to extract parameter paths - enhanced version"""
        paths = []
        
        if not output:
            return paths
        
        lines = output.strip().split('\n')
        
        for line in lines:
            line = line.strip()
            
            # Skip header and footer lines
            if (not line or 
                line.startswith('CR component') or 
                line.startswith('subsystem_prefix') or 
                'Execution succeed' in line or
                line == 'Device.'):
                continue
            
            # Look for parameter lines (format: "Parameter    N name: Device.Something.")
            param_match = re.search(r'Parameter\s+\d+\s+name:\s+([^\s]+)', line)
            if param_match:
                param_name = param_match.group(1).strip()
                
                # Only include object paths (ending with .) and exclude duplicates
                if param_name.endswith('.') and param_name not in paths and param_name != 'Device.':
                    paths.append(param_name)
                    continue
            
            # Also check for direct parameter names that might be objects
            if line.startswith('Device.') and line.endswith('.') and line != 'Device.':
                if line not in paths:
                    paths.append(line)
        
        # Remove duplicates and sort
        unique_paths = sorted(list(set(paths)))
        
        # Filter out any remaining unwanted duplicates
        filtered_paths = []
        seen = set()
        
        for path in unique_paths:
            if path not in seen and path != 'Device.' and len(path.split('.')) >= 2:
                filtered_paths.append(path)
                seen.add(path)
        
        return filtered_paths
    
    def discover_data_model_usp_chunked(self) -> bool:
        """Discover data model using USP with chunked approach for large models"""
        try:
            paths_to_discover = self.discovered_paths if self.discovered_paths else [
                "Device.DeviceInfo.",
                "Device.SoftwareModules."
            ]
            
            self.log(f"Discovering data model via USP for {len(paths_to_discover)} paths (chunked)")
            
            hierarchical_model = {}
            total_params = 0
            successful_paths = 0
            
            for path in paths_to_discover:
                try:
                    self.log(f"Getting parameters for: {path}")
                    
                    if self.is_potentially_large_datamodel(path):
                        # Use chunked discovery for large models
                        path_params, chunk_count = self.discover_large_datamodel_chunked(path, hierarchical_model)
                        if path_params > 0:
                            successful_paths += 1
                            total_params += path_params
                            self.log(f"✓ Found {path_params} parameters in {path} ({chunk_count} chunks)")
                        else:
                            self.log(f"✗ No parameters found in large model {path}")
                    else:
                        # Use regular discovery for smaller models
                        result = self.usp_pa("get", path, True)
                        
                        if result and len(result) > 0:
                            path_params = 0
                            for item in result:
                                resolved_path = item.get('resolvedPath', '')
                                params = item.get('resultParams', {})
                                
                                if params:
                                    self.add_usp_to_hierarchical_model(hierarchical_model, resolved_path, params)
                                    path_params += len(params)
                                    total_params += len(params)
                            
                            if path_params > 0:
                                successful_paths += 1
                                self.log(f"✓ Found {path_params} parameters in {path}")
                            else:
                                self.log(f"✗ No parameters found in {path}")
                        else:
                            self.log(f"✗ No response for {path}")
                    
                except Exception as e:
                    self.log(f"✗ Failed to discover {path}: {e}")
                    continue
            
            # Merge with existing model if we have one
            if self.data_model:
                self.merge_data_models(self.data_model, hierarchical_model)
            else:
                self.data_model = hierarchical_model
            
            self.log(f"USP data model discovery completed:")
            self.log(f"- Successful paths: {successful_paths}/{len(paths_to_discover)}")
            self.log(f"- Total parameters found: {total_params}")
            
            return total_params > 0
            
        except Exception as e:
            self.log(f"USP data model discovery error: {e}")
            return False
    
    def discover_large_datamodel_chunked(self, path: str, hierarchical_model: Dict) -> tuple:
        """Discover a large data model using chunked approach"""
        try:
            total_params = 0
            chunk_count = 0
            
            # Try to get specific sub-objects first
            sub_objects = self.get_known_sub_objects(path)
            
            if sub_objects:
                self.log(f"Using {len(sub_objects)} known sub-objects for {path}")
                for sub_obj in sub_objects:
                    try:
                        result = self.usp_pa("get", sub_obj, True)
                        if result:
                            chunk_params = 0
                            for item in result:
                                resolved_path = item.get('resolvedPath', '')
                                params = item.get('resultParams', {})
                                if params:
                                    self.add_usp_to_hierarchical_model(hierarchical_model, resolved_path, params)
                                    chunk_params += len(params)
                            
                            if chunk_params > 0:
                                total_params += chunk_params
                                chunk_count += 1
                                self.log(f"  Chunk {chunk_count}: {chunk_params} params from {sub_obj}")
                    
                    except Exception as e:
                        self.log(f"  Error in sub-object {sub_obj}: {e}")
                        continue
            else:
                # Fallback: try the full path with longer timeout
                try:
                    result = self.usp_pa_with_timeout("get", path, True, 60)  # 60 second timeout
                    if result:
                        for item in result:
                            resolved_path = item.get('resolvedPath', '')
                            params = item.get('resultParams', {})
                            if params:
                                self.add_usp_to_hierarchical_model(hierarchical_model, resolved_path, params)
                                total_params += len(params)
                        chunk_count = 1
                        self.log(f"  Single chunk: {total_params} params from {path}")
                except Exception as e:
                    self.log(f"  Large model fallback failed: {e}")
            
            return total_params, chunk_count
            
        except Exception as e:
            self.log(f"Error in chunked discovery for {path}: {e}")
            return 0, 0
    
    def discover_data_model_dmcli_chunked(self) -> bool:
        """Discover data model using dmcli with chunked approach for large models"""
        try:
            if not self.discovered_paths:
                self.log("No discovered paths for dmcli data model discovery")
                return False
            
            self.log(f"Discovering data model via dmcli for {len(self.discovered_paths)} paths (chunked)")
            
            hierarchical_model = {}
            total_params = 0
            
            for path in self.discovered_paths:
                try:
                    if self.is_potentially_large_datamodel(path):
                        # For large models, try to get sub-objects first
                        sub_objects = self.get_known_sub_objects(path)
                        if sub_objects:
                            self.log(f"Processing large model {path} in {len(sub_objects)} chunks")
                            path_params = 0
                            
                            for sub_obj in sub_objects:
                                try:
                                    # Remove trailing dot for dmcli command
                                    dmcli_path = sub_obj.rstrip('.')
                                    output = self.execute_dmcli(f"getv {dmcli_path}", True)
                                    if output:
                                        parsed = self.parse_dmcli_output(output)
                                        if parsed:
                                            self.add_to_hierarchical_model(hierarchical_model, parsed)
                                            chunk_params = len(parsed)
                                            path_params += chunk_params
                                            self.log(f"  {sub_obj}: {chunk_params} parameters")
                                except Exception as e:
                                    self.log(f"  Failed to get {sub_obj}: {e}")
                                    continue
                            
                            total_params += path_params
                            if path_params > 0:
                                self.log(f"✓ Large model {path}: {path_params} total parameters")
                        else:
                            # Fallback to full path
                            output = self.execute_dmcli(f"getv {path}", True)
                            if output:
                                parsed = self.parse_dmcli_output(output)
                                if parsed:
                                    self.add_to_hierarchical_model(hierarchical_model, parsed)
                                    total_params += len(parsed)
                                    self.log(f"✓ {path}: {len(parsed)} parameters (full)")
                    else:
                        # Regular processing for smaller models
                        output = self.execute_dmcli(f"getv {path}", True)
                        if output:
                            parsed = self.parse_dmcli_output(output)
                            if parsed:
                                self.add_to_hierarchical_model(hierarchical_model, parsed)
                                total_params += len(parsed)
                                self.log(f"✓ {path}: {len(parsed)} parameters")
                                
                except Exception as e:
                    self.log(f"Failed to discover {path}: {e}")
                    continue
            
            self.data_model = hierarchical_model
            self.log(f"dmcli chunked data model discovery completed - {total_params} parameters")
            return True
            
        except Exception as e:
            self.log(f"dmcli chunked data model discovery error: {e}")
            return False
    
    def get_supported_data_models_for_ui(self) -> List[Dict[str, Any]]:
        """Get supported data models formatted for UI display"""
        models = []
        
        for path in self.discovered_paths:
            # Extract category and description from path
            parts = path.replace('Device.', '').rstrip('.').split('.')
            if not parts or not parts[0]:
                continue
                
            category = self.categorize_data_model(parts[0])
            description = self.get_data_model_description(parts[0])
            
            model_info = {
                'path': path,
                'name': parts[0],
                'category': category,
                'description': description,
                'full_path': path,
                'is_large': self.is_potentially_large_datamodel(path)
            }
            
            models.append(model_info)
        
        # Sort by category and name
        models.sort(key=lambda x: (x['category'], x['name']))
        return models
    
    def categorize_data_model(self, model_name: str) -> str:
        """Categorize data model based on name"""
        model_lower = model_name.lower()
        
        if any(x in model_lower for x in ['deviceinfo', 'gatewayinfo', 'time', 'thermal', 'power']):
            return 'Device Information'
        elif any(x in model_lower for x in ['wifi', 'ethernet', 'cellular', 'ip', 'routing', 'dns']):
            return 'Network Configuration'
        elif any(x in model_lower for x in ['firewall', 'nat', 'security', 'upnp']):
            return 'Security & Networking'
        elif any(x in model_lower for x in ['dhcp', 'ddns', 'management']):
            return 'Network Services'
        elif any(x in model_lower for x in ['users', 'interface', 'bridging']):
            return 'System Configuration'
        elif any(x in model_lower for x in ['diagnostics', 'selfheal', 'webpa']):
            return 'Diagnostics & Monitoring'
        elif any(x in model_lower for x in ['software', 'module']):
            return 'Software Management'
        elif model_lower.startswith('x_'):
            if 'cisco' in model_lower:
                return 'Cisco Extensions'
            elif 'comcast' in model_lower:
                return 'Comcast Extensions'
            elif 'rdk' in model_lower:
                return 'RDK Extensions'
            else:
                return 'Vendor Extensions'
        else:
            return 'Other'
    
    def get_data_model_description(self, model_name: str) -> str:
        """Get human-readable description for data model"""
        descriptions = {
            'DeviceInfo': 'Device identification and status information',
            'GatewayInfo': 'Gateway-specific configuration and status',
            'Time': 'System time and NTP configuration',
            'Thermal': 'Temperature monitoring and thermal management',
            'PowerManagement': 'Power management and energy efficiency',
            'Ethernet': 'Ethernet interface configuration and statistics',
            'WiFi': 'Wireless network configuration and management',
            'Cellular': 'Cellular/mobile network connectivity',
            'IP': 'IP network configuration and routing',
            'DNS': 'Domain Name System configuration',
            'Routing': 'Network routing tables and configuration',
            'Firewall': 'Firewall rules and security policies',
            'NAT': 'Network Address Translation configuration',
            'DHCPv4': 'DHCP version 4 server and client configuration',
            'DHCPv6': 'DHCP version 6 server and client configuration',
            'Users': 'User accounts and authentication',
            'ManagementServer': 'Remote management and TR-069 configuration',
            'UPnP': 'Universal Plug and Play configuration',
            'Bridging': 'Network bridging and VLAN configuration',
            'SoftwareModules': 'Software package and container management',
            'Diagnostics': 'Network and system diagnostic tools',
            'SelfHeal': 'Automatic system recovery and monitoring',
            'Webpa': 'Web Protocol Adapter for device management',
            'QOS': 'Quality of Service configuration',
            'Hosts': 'Connected device information and management'
        }
        
        # Check for exact match first
        if model_name in descriptions:
            return descriptions[model_name]
        
        # Check for partial matches
        model_lower = model_name.lower()
        for key, desc in descriptions.items():
            if key.lower() in model_lower or model_lower in key.lower():
                return desc
        
        # For vendor-specific extensions
        if model_name.startswith('X_'):
            if 'CISCO' in model_name:
                return f'Cisco-specific extension: {model_name}'
            elif 'COMCAST' in model_name:
                return f'Comcast-specific extension: {model_name}'
            elif 'RDK' in model_name:
                return f'RDK-specific extension: {model_name}'
            else:
                return f'Vendor-specific extension: {model_name}'
        
        return f'Data model object: {model_name}'
    
    def check_dmcli_availability(self) -> bool:
        """Check if dmcli command is available"""
        try:
            result = subprocess.run(
                ['which', 'dmcli'], 
                capture_output=True, 
                text=True, 
                timeout=5
            )
            
            if result.returncode == 0:
                self.dmcli_available = True
                self.log("dmcli command found and available")
                return True
            
            # Try common dmcli locations
            dmcli_paths = [
                '/usr/bin/dmcli',
                '/usr/ccsp/dmcli',
                '/usr/local/bin/dmcli',
                '/opt/dmcli'
            ]
            
            for path in dmcli_paths:
                if os.path.exists(path):
                    self.dmcli_config['command'] = path
                    self.dmcli_available = True
                    self.log(f"dmcli found at {path}")
                    return True
            
            self.dmcli_available = False
            self.log("dmcli command not found")
            return False
                
        except Exception as e:
            self.dmcli_available = False
            self.log(f"Error checking dmcli availability: {e}")
            return False
    
    def execute_dmcli(self, command: str, quiet: bool = False) -> Optional[str]:
        """Execute dmcli command"""
        if not quiet:
            self.log(f"Executing dmcli: {command}")
        
        try:
            dmcli_cmd = self.dmcli_config.get('command', 'dmcli')
            full_command = [
                dmcli_cmd, 
                self.dmcli_config['subsystem'], 
                command
            ]
            
            result = subprocess.run(
                full_command, 
                capture_output=True, 
                text=True, 
                timeout=30
            )
            
            if result.returncode != 0:
                if not quiet:
                    self.log(f"dmcli error (code {result.returncode}): {result.stderr}")
                return None
            
            return result.stdout
            
        except subprocess.TimeoutExpired:
            self.log("dmcli command timeout")
            return None
        except Exception as e:
            self.log(f"dmcli execution error: {e}")
            return None
    
    def parse_dmcli_output(self, output: str) -> Dict[str, Any]:
        """Parse dmcli output into structured data"""
        parsed_data = {}
        
        if not output:
            return parsed_data
        
        lines = output.strip().split('\n')
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith('CR has') or 'Execution succeed' in line:
                continue
            
            # Parse parameter lines (format: name: type: value)
            if ':' in line:
                parts = line.split(':', 2)
                if len(parts) >= 3:
                    param_name = parts[0].strip()
                    param_type = parts[1].strip()
                    param_value = parts[2].strip()
                    
                    parsed_data[param_name] = {
                        'name': param_name,
                        'type': param_type,
                        'value': param_value,
                        'access': 'readwrite',
                        'path': param_name
                    }
                elif len(parts) == 2:
                    param_name = parts[0].strip()
                    param_value = parts[1].strip()
                    
                    parsed_data[param_name] = {
                        'name': param_name,
                        'type': 'string',
                        'value': param_value,
                        'access': 'readwrite',
                        'path': param_name
                    }
        
        return parsed_data
    
    def add_to_hierarchical_model(self, model: Dict, flat_data: Dict):
        """Add flat dmcli data to hierarchical model"""
        for param_path, param_info in flat_data.items():
            parts = param_path.split('.')
            current = model
            
            # Navigate/create the hierarchy
            for i, part in enumerate(parts[:-1]):
                if part not in current:
                    current[part] = {
                        'type': 'object',
                        'children': {}
                    }
                
                if 'children' not in current[part]:
                    current[part]['children'] = {}
                
                current = current[part]['children']
            
            # Add the parameter
            param_name = parts[-1]
            current[param_name] = {
                'type': 'parameter',
                'access': param_info.get('access', 'readwrite'),
                'dataType': self.map_dmcli_type(param_info.get('type', 'string')),
                'value': param_info.get('value', ''),
                'path': param_path
            }
    
    def add_usp_to_hierarchical_model(self, model: Dict, path: str, params: Dict):
        """Add USP data to hierarchical model"""
        parts = path.strip('.').split('.')
        current = model
        
        for i, part in enumerate(parts[:-1]):
            if part not in current:
                current[part] = {
                    'type': 'object',
                    'children': {}
                }
            
            if 'children' not in current[part]:
                current[part]['children'] = {}
            
            current = current[part]['children']
        
        # Add parameters
        for param_name, value in params.items():
            current[param_name] = {
                'type': 'parameter',
                'access': 'readwrite',
                'dataType': self.guess_data_type(value),
                'value': value,
                'path': f"{path}.{param_name}" if not path.endswith('.') else f"{path}{param_name}"
            }
    
    def merge_data_models(self, existing: Dict, new: Dict):
        """Merge new data model into existing"""
        for key, value in new.items():
            if key in existing:
                if isinstance(value, dict) and isinstance(existing[key], dict):
                    if 'children' in value and 'children' in existing[key]:
                        self.merge_data_models(existing[key]['children'], value['children'])
            else:
                existing[key] = value
    
    def map_dmcli_type(self, dmcli_type: str) -> str:
        """Map dmcli parameter types to standard types"""
        type_mapping = {
            'string': 'string',
            'int': 'int',
            'uint': 'unsignedInt',
            'bool': 'boolean',
            'datetime': 'dateTime',
            'base64': 'base64'
        }
        return type_mapping.get(dmcli_type.lower(), 'string')
    
    def guess_data_type(self, value):
        """Guess parameter data type from value"""
        if isinstance(value, bool) or value in ['true', 'false', 'True', 'False']:
            return 'boolean'
        try:
            int(value)
            return 'int'
        except:
            try:
                float(value)
                return 'decimal'
            except:
                return 'string'
    
    def get_parameter(self, param_path: str) -> Dict[str, Any]:
        """Get parameter value - enhanced with chunking support"""
        return self.get_parameter_chunked(param_path, 10)
    
    def get_parameter_chunked(self, param_path: str, chunk_size: int = 10) -> Dict[str, Any]:
        """Get parameter value with chunking support for large objects"""
        try:
            # Check if this is a request for a large object
            if param_path.endswith('.') and self.is_potentially_large_datamodel(param_path):
                return self.get_large_object_chunked(param_path, chunk_size)
            
            # Regular parameter get
            if self.dmcli_available:
                # Try dmcli first
                output = self.execute_dmcli(f"getv {param_path}")
                if output:
                    parsed = self.parse_dmcli_output(output)
                    param_data = parsed.get(param_path)
                    if param_data:
                        return {
                            'success': True,
                            'data': {param_path.split('.')[-1]: param_data['value']},
                            'path': param_path
                        }
            
            # USP fallback
            result = self.usp_pa("get", param_path)
            if result and len(result) > 0:
                return {
                    'success': True,
                    'data': result[0].get("resultParams", {}),
                    'path': param_path
                }
            else:
                return {
                    'success': False,
                    'error': 'No data returned',
                    'path': param_path
                }
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'path': param_path
            }
    
    def get_large_object_chunked(self, object_path: str, chunk_size: int = 10) -> Dict[str, Any]:
        """Get large object parameters in chunks"""
        try:
            self.log(f"Getting large object {object_path} in chunks of {chunk_size}")
            
            all_params = {}
            chunk_count = 0
            total_params = 0
            
            # Get known sub-objects for chunking
            sub_objects = self.get_known_sub_objects(object_path)
            
            if sub_objects:
                # Process known sub-objects
                for i in range(0, len(sub_objects), chunk_size):
                    chunk = sub_objects[i:i + chunk_size]
                    chunk_count += 1
                    
                    self.log(f"Processing chunk {chunk_count}: {len(chunk)} sub-objects")
                    
                    for sub_obj in chunk:
                        try:
                            if self.dmcli_available:
                                # Try dmcli first
                                dmcli_path = sub_obj.rstrip('.')
                                output = self.execute_dmcli(f"getv {dmcli_path}", True)
                                if output:
                                    parsed = self.parse_dmcli_output(output)
                                    all_params.update(parsed)
                                    total_params += len(parsed)
                                    continue
                            
                            # Fallback to USP
                            result = self.usp_pa("get", sub_obj, True)
                            if result and len(result) > 0:
                                for item in result:
                                    params = item.get("resultParams", {})
                                    all_params.update(params)
                                    total_params += len(params)
                            
                        except Exception as e:
                            self.log(f"Error getting {sub_obj}: {e}")
                            continue
                    
                    # Add small delay between chunks to avoid overwhelming the device
                    time.sleep(0.1)
            else:
                # No known sub-objects, try direct approach with timeout
                try:
                    result = self.usp_pa_with_timeout("get", object_path, False, 60)
                    if result and len(result) > 0:
                        for item in result:
                            params = item.get("resultParams", {})
                            all_params.update(params)
                            total_params += len(params)
                        chunk_count = 1
                except Exception as e:
                    return {
                        'success': False,
                        'error': f'Large object access failed: {e}',
                        'path': object_path
                    }
            
            self.log(f"Large object retrieval completed: {total_params} parameters in {chunk_count} chunks")
            
            return {
                'success': True,
                'data': all_params,
                'path': object_path,
                'chunk_count': chunk_count,
                'total_parameters': total_params,
                'is_large_object': True
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'path': object_path
            }
    
    def set_parameter(self, param_path: str, value: str) -> Dict[str, Any]:
        """Set parameter value - matching your existing pattern"""
        try:
            # Use USP for setting (matching your existing approach)
            result = self.usp_pa("set", f"{param_path} {value}")
            
            if result:
                return {
                    'success': True,
                    'data': result,
                    'path': param_path,
                    'value': value
                }
            else:
                return {
                    'success': False,
                    'error': 'Set operation failed',
                    'path': param_path,
                    'value': value
                }
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'path': param_path,
                'value': value
            }
    
    def install_application(self, name: str, location: str, version: str) -> Dict[str, Any]:
        """Install DAC application - matching your existing pattern exactly"""
        try:
            self.log(f"Installing {name} from {location} (v{version})")
            
            # Repository configuration - exact match to your code
            repos = {
                "local": "file:///opt/resident-container-images/",
                "share": "file:///share/",
                "remote": "https://raw.githubusercontent.com/robvogelaar/robvogelaar.github.io/main/unlisted/dac-images/",
                "server": "http://10.26.60.86/"
            }
            
            # Validate inputs - matching your validation logic
            if location not in ["local", "remote", "server", "share"]:
                return {
                    'success': False,
                    'error': f'Invalid location: {location}. Must be one of: local, remote, server, share'
                }
            
            if name not in ["webui", "tictactoe", "opensync", "rbus", "openvpn", "busybox", "iperf3"]:
                return {
                    'success': False,
                    'error': f'Invalid application: {name}. Must be one of: webui, tictactoe, opensync, rbus, openvpn, busybox, iperf3'
                }
            
            if version not in ["1.0", "3.1", "4.4", "5.6"]:
                return {
                    'success': False,
                    'error': f'Invalid version: {version}. Must be one of: 1.0, 3.1, 4.4, 5.6'
                }
            
            # Get repo - exact match to your code
            repo = repos[location]
            
            # Set image name - exact match to your code
            image = name
            
            # Set version - exact match to your code
            ver = version
            
            # Determine architecture - exact match to your logic
            if self.connected_serial.startswith('00163E'):
                arch = 'i686'
            else:
                arch = 'arm'
            
            # Build URL - exact match to your pattern
            url = f"{repo}{name}.tar.gz"    
            self.log(f"Installing with URL: {url}")
            self.log(f"Architecture: {arch} (based on serial: {self.connected_serial})")
            
            # Execute install command - exact match to your pattern
            ee = "default"
            install_cmd = f"Device.SoftwareModules.InstallDU(ExecutionEnvRef={ee},UUID=sleepy,URL={url})"
            
            self.log(f"USP Install command: {install_cmd}")
            result = self.usp_pa("operate", install_cmd)
            
            # Match your timing
            time.sleep(2)
            
            if result:
                self.log(f"Installation command sent successfully for {name}")
                return {
                    'success': True,
                    'message': f'Installation initiated for {name}',
                    'data': result,
                    'url': url,
                    'command': install_cmd
                }
            else:
                return {
                    'success': False,
                    'error': 'Install operation failed - no response from USP',
                    'url': url,
                    'command': install_cmd
                }
                
        except Exception as e:
            error_msg = f"Install error: {e}"
            self.log(error_msg)
            return {
                'success': False,
                'error': error_msg
            }
    
    def uninstall_application(self, du_id: str) -> Dict[str, Any]:
        """Uninstall DAC application - exact match to your existing pattern"""
        try:
            self.log(f"Uninstalling deployment unit {du_id}")
            
            # Exact match to your USP command
            uninstall_cmd = f"Device.SoftwareModules.DeploymentUnit.{du_id}.Uninstall()"
            self.log(f"USP Uninstall command: {uninstall_cmd}")
            
            result = self.usp_pa("operate", uninstall_cmd)
            
            # Match your timing exactly
            time.sleep(2)
            
            if result:
                self.log(f"Uninstallation command sent successfully for DU {du_id}")
                return {
                    'success': True,
                    'message': f'Uninstallation initiated for DU {du_id}',
                    'data': result,
                    'command': uninstall_cmd
                }
            else:
                return {
                    'success': False,
                    'error': 'Uninstall operation failed - no response from USP',
                    'command': uninstall_cmd
                }
                
        except Exception as e:
            error_msg = f"Uninstall error: {e}"
            self.log(error_msg)
            return {
                'success': False,
                'error': error_msg
            }
    
    def set_execution_state(self, eu_id: str, state: str) -> Dict[str, Any]:
        """Set execution unit state - exact match to your existing pattern"""
        try:
            self.log(f"Setting execution unit {eu_id} to {state}")
            
            # Exact match to your USP command
            state_cmd = f"Device.SoftwareModules.ExecutionUnit.{eu_id}.SetRequestedState(RequestedState={state})"
            self.log(f"USP State command: {state_cmd}")
            
            result = self.usp_pa("operate", state_cmd)
            
            # Match your timing exactly
            time.sleep(2)
            
            if result:
                self.log(f"State change command sent successfully for EU {eu_id}")
                return {
                    'success': True,
                    'message': f'State change initiated for EU {eu_id}',
                    'data': result,
                    'command': state_cmd
                }
            else:
                return {
                    'success': False,
                    'error': 'State change operation failed - no response from USP',
                    'command': state_cmd
                }
                
        except Exception as e:
            error_msg = f"State change error: {e}"
            self.log(error_msg)
            return {
                'success': False,
                'error': error_msg
            }
    
    def get_software_modules(self) -> Dict[str, List[Dict]]:
        """Get software modules using USP - matching your existing pattern"""
        try:
            self.log("Discovering software modules...")
            
            ees, dus, eus = [], [], []
            
            # Get all software modules
            result = self.usp_pa("get", "Device.SoftwareModules.", True)
            if result:
                self.parse_software_modules(result, ees, dus, eus)
            
            # Try specific paths
            specific_paths = [
                "Device.SoftwareModules.ExecEnv.",
                "Device.SoftwareModules.DeploymentUnit.",
                "Device.SoftwareModules.ExecutionUnit."
            ]
            
            for path in specific_paths:
                try:
                    result = self.usp_pa("get", path, True)
                    if result:
                        self.parse_software_modules(result, ees, dus, eus)
                except Exception as e:
                    continue
            
            # Remove duplicates
            ees = self.deduplicate_modules(ees)
            dus = self.deduplicate_modules(dus)
            eus = self.deduplicate_modules(eus)
            
            self.log(f"Software modules found - EE: {len(ees)}, DU: {len(dus)}, EU: {len(eus)}")
            
            return {"ees": ees, "dus": dus, "eus": eus}
            
        except Exception as e:
            self.log(f"Error getting software modules: {e}")
            return {"ees": [], "dus": [], "eus": []}
    
    def parse_software_modules(self, result, ees, dus, eus):
        """Parse software module results"""
        for item in result:
            path = item.get('resolvedPath', '')
            params = item.get('resultParams', {})
            
            index_match = re.search(r'\.(\d+)\.', path)
            index = index_match.group(1) if index_match else None
            
            if 'ExecEnv' in path or 'ExecutionEnvironment' in path:
                ee_data = {
                    "Index": index,
                    "Name": params.get("Name", params.get("Alias", "")),
                    "Enable": params.get("Enable", ""),
                    "Status": params.get("Status", ""),
                    "InitialRunLevel": params.get("InitialRunLevel", ""),
                    "CurrentRunLevel": params.get("CurrentRunLevel", ""),
                    "Path": path
                }
                if ee_data not in ees:
                    ees.append(ee_data)
                    
            elif 'DeploymentUnit' in path:
                du_data = {
                    "Index": index,
                    "URL": params.get("URL", ""),
                    "Status": params.get("Status", ""),
                    "ExecutionEnvRef": params.get("ExecutionEnvRef", ""),
                    "ExecutionUnitList": params.get("ExecutionUnitList", ""),
                    "UUID": params.get("UUID", ""),
                    "Name": params.get("Name", params.get("Alias", "")),
                    "Path": path
                }
                if du_data not in dus:
                    dus.append(du_data)
                    
            elif 'ExecutionUnit' in path:
                eu_data = {
                    "Index": index,
                    "Name": params.get("Name", params.get("Alias", "")),
                    "Status": params.get("Status", ""),
                    "RequestedState": params.get("RequestedState", ""),
                    "ExecutionFaultCode": params.get("ExecutionFaultCode", ""),
                    "ExecutionFaultMessage": params.get("ExecutionFaultMessage", ""),
                    "AutoStart": params.get("AutoStart", ""),
                    "RunLevel": params.get("RunLevel", ""),
                    "Path": path
                }
                if eu_data not in eus:
                    eus.append(eu_data)
    
    def deduplicate_modules(self, modules):
        """Remove duplicate modules"""
        seen = set()
        unique_modules = []
        
        for module in modules:
            key = (module.get("Index"), module.get("Path", ""))
            if key not in seen:
                seen.add(key)
                unique_modules.append(module)
        
        try:
            unique_modules.sort(key=lambda x: int(x.get("Index", 0)) if x.get("Index") else 0)
        except:
            pass
            
        return unique_modules
    
    def force_execution_unit_discovery(self) -> Dict[str, Any]:
        """Force discovery of execution units"""
        try:
            self.log("Forcing execution unit discovery...")
            
            eus = []
            discovery_methods = [
                "Device.SoftwareModules.ExecutionUnit.",
                "Device.SoftwareModules.ExecEnv.1.ExecutionUnit.",
                "Device.SoftwareModules.ExecEnv.2.ExecutionUnit.",
                "Device.Container.",
                "Device.Container.Container."
            ]
            
            for method in discovery_methods:
                try:
                    result = self.usp_pa("get", method, True)
                    if result:
                        temp_eus = []
                        self.parse_software_modules(result, [], [], temp_eus)
                        if temp_eus:
                            eus.extend(temp_eus)
                            self.log(f"Found {len(temp_eus)} EUs with method: {method}")
                except Exception as e:
                    continue
            
            unique_eus = self.deduplicate_modules(eus)
            self.log(f"Total unique execution units found: {len(unique_eus)}")
            
            return {
                'success': True,
                'execution_units': unique_eus,
                'count': len(unique_eus)
            }
            
        except Exception as e:
            self.log(f"Force EU discovery error: {e}")
            return {
                'success': False,
                'error': str(e),
                'execution_units': [],
                'count': 0
            }
    
    def refresh_data_model_optimized(self):
        """Refresh data model with optimized approach for large models"""
        self.log("Refreshing data model (optimized for large models)...")
        
        # Store current model size for comparison
        old_param_count = count_data_model_parameters(self.data_model)
        
        # Re-discover supported data models first
        self.discovered_paths = []
        self.data_model = {}
        
        # Use chunked discovery methods
        if self.dmcli_available:
            self.discover_supported_data_models_dmcli()
            if self.discovered_paths:
                self.discover_data_model_dmcli_chunked()
        
        if self.connected:
            if not self.discovered_paths:
                self.discover_supported_data_models_usp()
            self.discover_data_model_usp_chunked()
        
        # Log the results
        new_param_count = count_data_model_parameters(self.data_model)
        self.log(f"Data model refresh completed:")
        self.log(f"- Old parameter count: {old_param_count}")
        self.log(f"- New parameter count: {new_param_count}")
        self.log(f"- Discovered paths: {len(self.discovered_paths)}")
    
    def refresh_data_model(self):
        """Refresh data model discovery - use optimized version"""
        self.refresh_data_model_optimized()
    
    def get_data_model_summary(self) -> Dict[str, Any]:
        """Get a summary of the data model for large model handling"""
        try:
            total_objects = 0
            total_parameters = 0
            large_models = []
            
            def count_model_items(model_dict, prefix=""):
                nonlocal total_objects, total_parameters
                
                for key, value in model_dict.items():
                    current_path = f"{prefix}.{key}" if prefix else key
                    
                    if isinstance(value, dict):
                        if value.get('type') == 'parameter':
                            total_parameters += 1
                        elif value.get('type') == 'object' and 'children' in value:
                            total_objects += 1
                            child_count = len(value['children'])
                            
                            # Consider it a large model if it has many children
                            if child_count > 20:
                                large_models.append({
                                    'path': current_path,
                                    'children_count': child_count
                                })
                            
                            count_model_items(value['children'], current_path)
            
            count_model_items(self.data_model)
            
            return {
                'total_objects': total_objects,
                'total_parameters': total_parameters,
                'large_models': large_models,
                'discovered_paths_count': len(self.discovered_paths)
            }
            
        except Exception as e:
            self.log(f"Error getting data model summary: {e}")
            return {
                'total_objects': 0,
                'total_parameters': 0,
                'large_models': [],
                'discovered_paths_count': 0
            }
    
    def log(self, message: str):
        """Add log message"""
        timestamp = time.strftime('%H:%M:%S')
        log_entry = f"[{timestamp}] {message}"
        self.logs.append(log_entry)
        logger.info(message)
        
        # Keep only last 100 log entries
        if len(self.logs) > 100:
            self.logs = self.logs[-100:]

# Global controller instance
controller = USPController()

def count_data_model_parameters(data_model, count=0):
    """Count total parameters in hierarchical data model"""
    for key, value in data_model.items():
        if isinstance(value, dict):
            if value.get('type') == 'parameter':
                count += 1
            elif 'children' in value:
                count = count_data_model_parameters(value['children'], count)
    return count

def _js_str(path):
    """Escape a path for safe use inside a single-quoted JS string literal in an HTML attribute."""
    # Escape backslashes first, then single quotes
    return path.replace('\\', '\\\\').replace("'", "\\'")

def render_data_model(data_model, prefix="", level=0):
    """Render data model as HTML tree with interactive features"""
    html = ""

    for key, value in data_model.items():
        if isinstance(value, dict):
            if value.get('type') == 'parameter':
                path = value.get('path', f"{prefix}.{key}".lstrip('.'))
                param_value = html_escape(str(value.get("value", "N/A")))
                param_type = html_escape(value.get("dataType", "unknown"))
                access = value.get("access", "readwrite")
                safe_id = html_escape(path.replace('.', '-').replace(' ', '_'))
                access_icon = '🔒' if access == 'readonly' else '✏️'
                type_class = f"type-{param_type.lower().replace(' ', '-')}"
                js_path = _js_str(path)
                attr_path = html_escape(path)

                html += f'<div class="tree-node parameter" data-path="{attr_path}" data-access="{access}" onclick="selectParameter(\'{js_path}\')" title="Click to select this parameter">'
                html += f'<span class="access-icon" title="{access}">{access_icon}</span>'
                html += f'<span class="param-name">{html_escape(key)}</span>'
                html += f'<span class="param-value" id="val-{safe_id}">{param_value}</span>'
                html += f'<span class="param-type-badge {type_class}">{param_type}</span>'
                html += f'<button class="btn-refresh-param" onclick="event.stopPropagation(); refreshParam(\'{js_path}\')" title="Refresh value">↻</button>'
                if access != 'readonly':
                    html += f'<button class="btn-edit-param" onclick="event.stopPropagation(); editParam(\'{js_path}\')" title="Edit value">✎</button>'
                html += f'<button class="btn-copy-path" onclick="event.stopPropagation(); copyPath(\'{js_path}\')" title="Copy path">📋</button>'
                html += '</div>'

            elif value.get('type') == 'object' and 'children' in value:
                child_count = len(value['children'])
                is_large = child_count > 20
                icon = "📁" if not is_large else "📂"
                size_info = f" ({child_count} items)" if child_count > 5 else ""
                large_indicator = " <span class='large-model'>LARGE</span>" if is_large else ""
                full_path = f"{prefix}.{key}".lstrip('.')
                category = controller.categorize_data_model(key) if level == 0 else ""
                js_full_path = _js_str(full_path)
                attr_full_path = html_escape(full_path)

                html += f'<div class="tree-node object" data-path="{attr_full_path}" data-category="{html_escape(category)}">'
                html += f'<span class="node-toggle" onclick="event.stopPropagation(); toggleNode(this)">▶</span>'
                html += f'<span class="node-label">{icon} <strong>{html_escape(key)}/</strong>{size_info}{large_indicator}</span>'
                html += f'<button class="btn-copy-path" onclick="event.stopPropagation(); copyPath(\'{js_full_path}\')" title="Copy path">📋</button>'
                html += '</div>'

                html += '<div class="node-children" style="display:none;">'
                if not is_large or level < 2:
                    html += render_data_model(value['children'], full_path, level + 1)
                else:
                    large_path = f"{full_path}."
                    js_large_path = _js_str(large_path)
                    html += f'<div class="tree-node collapsed large-placeholder" data-path="{attr_full_path}" onclick="expandLargeModel(\'{js_large_path}\', this)">'
                    html += f'⟳ Click to load {child_count} items from {html_escape(full_path)}...'
                    html += '</div>'
                html += '</div>'

    return html

# Flask Routes
@app.route('/')
def index():
    """Main dashboard with dynamic data model info and large model support"""
    # Get current software modules
    software_modules = controller.get_software_modules()
    
    # Count data model parameters
    data_model_count = count_data_model_parameters(controller.data_model)
    
    # Get supported data models for UI
    supported_models = controller.get_supported_data_models_for_ui()
    
    # Get data model summary
    model_summary = controller.get_data_model_summary()
    
    # Prepare template data
    template_data = {
        'connected': controller.connected,
        'device_serial': controller.connected_serial,
        'config': controller.config,
        'dmcli_available': controller.dmcli_available,
        'data_model_count': data_model_count,
        'software_modules': software_modules,
        'logs': controller.logs[-20:],
        'data_model': controller.data_model,
        'supported_models': supported_models,
        'discovered_paths_count': len(controller.discovered_paths),
        'model_summary': model_summary,
        'message': None,
        'param_result': None,
        'render_data_model': render_data_model
    }
    
    return render_template('index.html', **template_data)

@app.route('/api/supported_models')
def api_supported_models():
    """API endpoint to get supported data models"""
    return jsonify({
        'models': controller.get_supported_data_models_for_ui(),
        'discovered_paths': controller.discovered_paths,
        'total_count': len(controller.discovered_paths)
    })

@app.route('/api/data_model_summary')
def api_data_model_summary():
    """API endpoint for data model summary including large model info"""
    summary = controller.get_data_model_summary()
    return jsonify(summary)

@app.route('/api/get_parameter_ajax')
def api_get_parameter_ajax():
    """AJAX endpoint to fetch a live parameter value"""
    path = request.args.get('path', '').strip()
    if not path:
        return jsonify({'success': False, 'error': 'No path provided'})
    try:
        result = controller.get_parameter_chunked(path)
        if result.get('success'):
            return jsonify(result)
        # Log the real error server-side but return a safe message to the client
        controller.log(f"get_parameter_ajax failed for {path}: {result.get('error', 'unknown')}")
        return jsonify({'success': False, 'error': 'Parameter fetch failed', 'path': path})
    except Exception as exc:
        controller.log(f"get_parameter_ajax exception for {path}: {exc}")
        return jsonify({'success': False, 'error': 'Parameter fetch failed'})

@app.route('/api/set_parameter_ajax', methods=['POST'])
def api_set_parameter_ajax():
    """AJAX endpoint to set a parameter value"""
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No JSON body'})
    path = data.get('path', '').strip()
    value = data.get('value', '')
    if not path:
        return jsonify({'success': False, 'error': 'Missing path'})
    try:
        result = controller.set_parameter(path, str(value))
        if result.get('success'):
            return jsonify(result)
        controller.log(f"set_parameter_ajax failed for {path}: {result.get('error', 'unknown')}")
        return jsonify({'success': False, 'error': 'Parameter set failed', 'path': path})
    except Exception as exc:
        controller.log(f"set_parameter_ajax exception for {path}: {exc}")
        return jsonify({'success': False, 'error': 'Parameter set failed'})

@app.route('/api/expand_model')
def api_expand_model():
    """AJAX endpoint to lazy-load a large model sub-tree"""
    path = request.args.get('path', '').strip()
    if not path:
        return jsonify({'success': False, 'error': 'No path provided'})
    try:
        result = controller.get_large_object_chunked(path)
        if result.get('success'):
            mini_model = {}
            for param_name, value in result.get('data', {}).items():
                controller.add_usp_to_hierarchical_model(mini_model, path.rstrip('.'), {param_name: value})
            html_content = render_data_model(mini_model)
            return jsonify({'success': True, 'html': html_content})
        controller.log(f"expand_model failed for {path}: {result.get('error', 'unknown')}")
        return jsonify({'success': False, 'error': 'Model expansion failed'})
    except Exception as exc:
        controller.log(f"expand_model exception for {path}: {exc}")
        return jsonify({'success': False, 'error': 'Model expansion failed'})

@app.route('/rediscover', methods=['POST'])
def rediscover_data_models():
    """Force rediscovery of supported data models"""
    try:
        controller.log("Force rediscovering supported data models...")
        controller.refresh_data_model_optimized()
        return redirect(url_for('index'))
    except Exception as e:
        controller.log(f"Rediscovery error: {e}")
        return redirect(url_for('index'))

@app.route('/config', methods=['POST'])
def update_config():
    """Update controller configuration"""
    broker = request.form.get('broker', '').strip()
    broker_port = request.form.get('broker_port', '').strip()
    to_id = request.form.get('to_id', '').strip()
    
    if broker:
        controller.config['broker'] = broker
    if broker_port:
        controller.config['broker_port'] = broker_port
    if to_id:
        controller.config['to_id'] = to_id
    
    controller.log("Configuration updated")
    controller.test_usp_connection()
    
    return redirect(url_for('index'))

@app.route('/refresh')
def refresh():
    """Refresh connection and data"""
    controller.test_usp_connection()
    controller.refresh_data_model_optimized()
    controller.log("Connection and data model refreshed")
    return redirect(url_for('index'))

@app.route('/refresh_optimized')
def refresh_optimized():
    """Refresh with optimization for large models"""
    controller.refresh_data_model_optimized()
    controller.log("Optimized refresh completed")
    return redirect(url_for('index'))

@app.route('/discover')
def discover():
    """Discover data model"""
    try:
        controller.log("Starting data model discovery...")
        controller.refresh_data_model_optimized()
        controller.log("Data model discovery completed")
        return redirect(url_for('index'))
    except Exception as e:
        controller.log(f"Discovery error: {e}")
        return redirect(url_for('index'))

@app.route('/get_parameter', methods=['POST'])
def get_parameter():
    """Get parameter value with chunking support"""
    param_path = request.form.get('param_path', '').strip()
    
    if not param_path:
        return redirect(url_for('index'))
    
    result = controller.get_parameter_chunked(param_path)
    controller.log(f"Get parameter {param_path}: {'Success' if result['success'] else 'Failed'}")
    
    # Render with result
    software_modules = controller.get_software_modules()
    data_model_count = count_data_model_parameters(controller.data_model)
    supported_models = controller.get_supported_data_models_for_ui()
    model_summary = controller.get_data_model_summary()
    
    template_data = {
        'connected': controller.connected,
        'device_serial': controller.connected_serial,
        'config': controller.config,
        'dmcli_available': controller.dmcli_available,
        'data_model_count': data_model_count,
        'software_modules': software_modules,
        'logs': controller.logs[-20:],
        'data_model': controller.data_model,
        'supported_models': supported_models,
        'discovered_paths_count': len(controller.discovered_paths),
        'model_summary': model_summary,
        'message': None,
        'param_result': result,
        'render_data_model': render_data_model
    }
    
    return render_template('index.html', **template_data)

@app.route('/get_large_parameter', methods=['POST'])
def get_large_parameter():
    """Get large parameter/object with chunking support"""
    param_path = request.form.get('param_path', '').strip()
    chunk_size = int(request.form.get('chunk_size', 10))
    
    if not param_path:
        return redirect(url_for('index'))
    
    result = controller.get_parameter_chunked(param_path, chunk_size)
    controller.log(f"Get large parameter {param_path}: {'Success' if result['success'] else 'Failed'}")
    
    # Render with result
    software_modules = controller.get_software_modules()
    data_model_count = count_data_model_parameters(controller.data_model)
    supported_models = controller.get_supported_data_models_for_ui()
    model_summary = controller.get_data_model_summary()
    
    template_data = {
        'connected': controller.connected,
        'device_serial': controller.connected_serial,
        'config': controller.config,
        'dmcli_available': controller.dmcli_available,
        'data_model_count': data_model_count,
        'software_modules': software_modules,
        'logs': controller.logs[-20:],
        'data_model': controller.data_model,
        'supported_models': supported_models,
        'discovered_paths_count': len(controller.discovered_paths),
        'model_summary': model_summary,
        'message': None,
        'param_result': result,
        'render_data_model': render_data_model
    }
    
    return render_template('index.html', **template_data)

@app.route('/set_parameter', methods=['POST'])
def set_parameter():
    """Set parameter value"""
    param_path = request.form.get('param_path', '').strip()
    param_value = request.form.get('param_value', '').strip()
    
    if not param_path or not param_value:
        return redirect(url_for('index'))
    
    result = controller.set_parameter(param_path, param_value)
    controller.log(f"Set parameter {param_path} = {param_value}: {'Success' if result['success'] else 'Failed'}")
    
    # Render with result
    software_modules = controller.get_software_modules()
    data_model_count = count_data_model_parameters(controller.data_model)
    supported_models = controller.get_supported_data_models_for_ui()
    model_summary = controller.get_data_model_summary()
    
    template_data = {
        'connected': controller.connected,
        'device_serial': controller.connected_serial,
        'config': controller.config,
        'dmcli_available': controller.dmcli_available,
        'data_model_count': data_model_count,
        'software_modules': software_modules,
        'logs': controller.logs[-20:],
        'data_model': controller.data_model,
        'supported_models': supported_models,
        'discovered_paths_count': len(controller.discovered_paths),
        'model_summary': model_summary,
        'message': {
            'type': 'success' if result['success'] else 'error',
            'text': f"Parameter {'set successfully' if result['success'] else 'set failed'}"
        },
        'param_result': result,
        'render_data_model': render_data_model
    }
    
    return render_template('index.html', **template_data)

@app.route('/install', methods=['POST'])
def install():
    """Install DAC application"""
    name = request.form.get('name', '').strip()
    location = request.form.get('location', '').strip()
    version = request.form.get('version', '').strip()
    
    if not name or not location or not version:
        return redirect(url_for('index'))
    
    result = controller.install_application(name, location, version)
    return redirect(url_for('index'))

@app.route('/uninstall/<du_id>')
def uninstall(du_id):
    """Uninstall deployment unit"""
    result = controller.uninstall_application(du_id)
    return redirect(url_for('index'))

@app.route('/set_state/<eu_id>/<state>')
def set_state(eu_id, state):
    """Set execution unit state"""
    result = controller.set_execution_state(eu_id, state)
    return redirect(url_for('index'))

@app.route('/restart_eu/<eu_id>')
def restart_eu(eu_id):
    """Restart execution unit"""
    try:
        controller.log(f"Restarting execution unit {eu_id}")
        
        # Stop then start
        stop_result = controller.set_execution_state(eu_id, "Idle")
        if stop_result['success']:
            time.sleep(2)
            start_result = controller.set_execution_state(eu_id, "Active")
            if start_result['success']:
                controller.log(f"Successfully restarted EU {eu_id}")
            else:
                controller.log(f"Failed to start EU {eu_id} after stop")
        else:
            controller.log(f"Failed to stop EU {eu_id}")
            
    except Exception as e:
        controller.log(f"Error restarting EU {eu_id}: {e}")
    
    return redirect(url_for('index'))

@app.route('/refresh_modules')
def refresh_modules():
    """Refresh software modules only"""
    controller.log("Refreshing software modules...")
    time.sleep(1)
    return redirect(url_for('index'))

@app.route('/force_eu_discovery')
def force_eu_discovery():
    """Force execution unit discovery"""
    try:
        result = controller.force_execution_unit_discovery()
        if result['success']:
            controller.log(f"Forced EU discovery found {result['count']} execution units")
        else:
            controller.log("Forced EU discovery failed")
    except Exception as e:
        controller.log(f"Error in forced EU discovery: {e}")
    
    return redirect(url_for('index'))

@app.route('/api/status')
def api_status():
    """API endpoint for status"""
    return jsonify({
        'connected': controller.connected,
        'device_serial': controller.connected_serial,
        'dmcli_available': controller.dmcli_available,
        'config': controller.config,
        'logs': controller.logs[-10:],
        'discovered_paths': controller.discovered_paths,
        'discovered_paths_count': len(controller.discovered_paths)
    })

@app.route('/api/software_modules')
def api_software_modules():
    """API endpoint for software modules"""
    return jsonify(controller.get_software_modules())

@app.route('/test_path/<path:test_path>')
def test_path(test_path):
    """Test a specific USP path"""
    try:
        controller.log(f"Testing path: {test_path}")
        result = controller.usp_pa("get", test_path, False)
        
        if result:
            return jsonify({
                'success': True,
                'path': test_path,
                'result': result,
                'param_count': sum(len(item.get('resultParams', {})) for item in result)
            })
        else:
            return jsonify({
                'success': False,
                'path': test_path,
                'error': 'No result returned'
            })
            
    except Exception as e:
        return jsonify({
            'success': False,
            'path': test_path,
            'error': str(e)
        })

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Starting Enhanced Flask USP Controller with Large Data Model Support")
    print("=" * 60)
    print(f"📡 Server: http://0.0.0.0:8119")
    print(f"🔧 dmcli Available: {controller.dmcli_available}")
    print(f"🔧 Config: {controller.config}")
    print(f"📱 Device: {controller.connected_serial if controller.connected else 'Not connected'}")
    print(f"📊 Discovered Paths: {len(controller.discovered_paths)}")
    print(f"📊 Data Model: {count_data_model_parameters(controller.data_model)} parameters")
    
    # Show large model info
    model_summary = controller.get_data_model_summary()
    if model_summary['large_models']:
        print(f"📂 Large Models: {len(model_summary['large_models'])} detected")
        for large_model in model_summary['large_models'][:3]:  # Show first 3
            print(f"   - {large_model['path']}: {large_model['children_count']} children")
    
    print("=" * 60)
    
    # Run Flask server
    app.run(
        host='0.0.0.0',
        port=8119,
        debug=False,
        threaded=True
    )
