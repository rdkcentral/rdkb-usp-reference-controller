/*
 * If not stated otherwise in this file or this component's LICENSE
 * file the following copyright and licenses apply:
 *
 * Copyright 2024 RDK Management
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Global state management
const USPController = {
    state: {
        autoRefresh: false,
        autoScroll: true,
        advancedMode: false,
        lastUpdate: new Date(),
        parameterHistory: [],
        searchResults: [],
        expandedNodes: new Set(),
        currentView: 'table'
    },
    
    config: {
        refreshInterval: 30000, // 30 seconds
        maxHistoryItems: 50,
        animationDuration: 300,
        searchDebounceDelay: 500
    }
};

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeApplication();
    setupEventListeners();
    startPeriodicUpdates();
});

/**
 * Initialize the application
 */
function initializeApplication() {
    console.log('🚀 Initializing USP Controller...');
    
    // Update last update time
    updateLastUpdateTime();
    
    // Initialize tooltips
    initializeTooltips();
    
    // Setup keyboard shortcuts
    setupKeyboardShortcuts();
    
    // Restore user preferences
    restoreUserPreferences();
    
    // Initialize search functionality
    initializeSearch();
    
    console.log('✅ USP Controller initialized');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Form submissions with loading states
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            showLoading();
            // Allow form to submit naturally
        });
    });
    
    // Parameter path selection enhancements
    const paramSelects = document.querySelectorAll('select[name="param_path"]');
    paramSelects.forEach(select => {
        select.addEventListener('change', function() {
            updateParameterSuggestions(this.value);
        });
    });
    
    // Real-time search for data model
    const searchInput = document.getElementById('model-search');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                filterDataModel(this.value);
            }, USPController.config.searchDebounceDelay);
        });
    }
    
    // Auto-dismiss messages
    const messages = document.querySelectorAll('.message');
    messages.forEach(message => {
        setTimeout(() => {
            if (message.parentElement) {
                fadeOut(message);
            }
        }, 5000);
    });
}

/**
 * Enhanced parameter selection with history and suggestions
 */
function selectParameter(path) {
    console.log(`📋 Selected parameter: ${path}`);
    
    // Update both get and set parameter dropdowns
    updateParameterDropdown('get-param-path', path);
    updateParameterDropdown('set-param-path', path);
    
    // Add to history
    addToParameterHistory(path);
    
    // Show parameter suggestions
    showParameterSuggestions(path);
    
    // Highlight in tree
    highlightTreeNode(path);
}

/**
 * Update parameter dropdown with new option
 */
function updateParameterDropdown(selectId, path) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // Check if option already exists
    let optionExists = false;
    for (let option of select.options) {
        if (option.value === path) {
            option.selected = true;
            optionExists = true;
            break;
        }
    }
    
    // Create new option if it doesn't exist
    if (!optionExists) {
        const option = document.createElement('option');
        option.value = path;
        option.text = path;
        option.selected = true;
        
        // Add to appropriate optgroup or create "Custom" group
        let customGroup = select.querySelector('optgroup[label="Custom Parameters"]');
        if (!customGroup) {
            customGroup = document.createElement('optgroup');
            customGroup.label = 'Custom Parameters';
            select.appendChild(customGroup);
        }
        customGroup.appendChild(option);
    }
    
    // Trigger change event
    select.dispatchEvent(new Event('change'));
}

/**
 * Add parameter to history
 */
function addToParameterHistory(path) {
    const history = USPController.state.parameterHistory;
    
    // Remove if already exists
    const existingIndex = history.indexOf(path);
    if (existingIndex > -1) {
        history.splice(existingIndex, 1);
    }
    
    // Add to beginning
    history.unshift(path);
    
    // Limit history size
    if (history.length > USPController.config.maxHistoryItems) {
        history.splice(USPController.config.maxHistoryItems);
    }
    
    // Save to localStorage
    localStorage.setItem('usp_parameter_history', JSON.stringify(history));
}

/**
 * Quick action functions
 */
function getDeviceInfo() {
    console.log('📱 Getting device information...');
    showLoading('Getting device information...');
    
    const deviceParams = [
        'Device.DeviceInfo.SerialNumber',
        'Device.DeviceInfo.Manufacturer',
        'Device.DeviceInfo.ModelName',
        'Device.DeviceInfo.SoftwareVersion',
        'Device.DeviceInfo.HardwareVersion'
    ];
    
    // Simulate getting multiple parameters
    fetchMultipleParameters(deviceParams, 'Device Information');
}

function getWiFiStatus() {
    console.log('📶 Getting WiFi status...');
    showLoading('Getting WiFi status...');
    
    const wifiParams = [
        'Device.WiFi.Radio.1.Enable',
        'Device.WiFi.SSID.1.SSID',
        'Device.WiFi.SSID.1.Enable',
        'Device.WiFi.Radio.1.Channel'
    ];
    
    fetchMultipleParameters(wifiParams, 'WiFi Status');
}

function getSystemStats() {
    console.log('📊 Getting system statistics...');
    showLoading('Getting system statistics...');
    
    const statsParams = [
        'Device.DeviceInfo.UpTime',
        'Device.DeviceInfo.MemoryStatus.Total',
        'Device.DeviceInfo.MemoryStatus.Free',
        'Device.DeviceInfo.ProcessorUsage'
    ];
    
    fetchMultipleParameters(statsParams, 'System Statistics');
}

/**
 * Fetch multiple parameters (simulated for demo)
 */
function fetchMultipleParameters(params, title) {
    // In a real implementation, this would make API calls
    setTimeout(() => {
        hideLoading();
        showNotification(`${title} retrieved successfully`, 'success');
    }, 2000);
}

/**
 * Advanced configuration functions
 */
function toggleAdvancedMode() {
    USPController.state.advancedMode = !USPController.state.advancedMode;
    const button = event.target.closest('button');
    
    if (USPController.state.advancedMode) {
        button.innerHTML = '<i class="fas fa-tools"></i> Basic';
        showAdvancedConfig();
    } else {
        button.innerHTML = '<i class="fas fa-tools"></i> Advanced';
        hideAdvancedConfig();
    }
    
    console.log(`🔧 Advanced mode: ${USPController.state.advancedMode ? 'ON' : 'OFF'}`);
}

function showAdvancedConfig() {
    // Add advanced configuration options
    const configForm = document.querySelector('.config-form');
    if (!configForm.querySelector('.advanced-config')) {
        const advancedDiv = document.createElement('div');
        advancedDiv.className = 'advanced-config';
        advancedDiv.innerHTML = `
            <div class="config-group">
                <label for="retry-count">Retry Count</label>
                <input type="number" id="retry-count" name="retry_count" value="3" class="config-input" min="1" max="10">
            </div>
            <div class="config-group">
                <label for="log-level">Log Level</label>
                <select id="log-level" name="log_level" class="config-input">
                    <option value="INFO">INFO</option>
                    <option value="DEBUG">DEBUG</option>
                    <option value="WARNING">WARNING</option>
                    <option value="ERROR">ERROR</option>
                </select>
            </div>
        `;
        configForm.insertBefore(advancedDiv, configForm.querySelector('.config-actions'));
        slideDown(advancedDiv);
    }
}

function hideAdvancedConfig() {
    const advancedDiv = document.querySelector('.advanced-config');
    if (advancedDiv) {
        slideUp(advancedDiv, () => advancedDiv.remove());
    }
}

/**
 * Application management functions
 */
function updateAppDescription() {
    const appSelect = document.getElementById('app-name');
    const descDiv = document.getElementById('app-description');
    const selectedOption = appSelect.options[appSelect.selectedIndex];
    
    if (selectedOption && selectedOption.dataset.desc) {
        descDiv.innerHTML = `
            <i class="fas fa-info-circle"></i>
            <strong>${selectedOption.text}:</strong> ${selectedOption.dataset.desc}
        `;
        descDiv.className = 'app-description active';
    } else {
        descDiv.innerHTML = 'Select an application to see its description';
        descDiv.className = 'app-description';
    }
}

function updateLocationInfo() {
    const locationSelect = document.getElementById('app-location');
    const selectedOption = locationSelect.options[locationSelect.selectedIndex];
    
    if (selectedOption && selectedOption.dataset.desc) {
        console.log(`📍 Location: ${selectedOption.text} - ${selectedOption.dataset.desc}`);
    }
}

function validateInstallation() {
    const name = document.getElementById('app-name').value;
    const location = document.getElementById('app-location').value;
    const version = document.getElementById('app-version').value;
    
    if (!name || !location || !version) {
        showNotification('Please select application, location, and version', 'warning');
        return false;
    }
    
    showNotification('Installation parameters validated successfully', 'success');
    return true;
}

function refreshApplicationList() {
    console.log('🔄 Refreshing application list...');
    showLoading('Refreshing application list...');
    
    // Simulate refresh
    setTimeout(() => {
        hideLoading();
        showNotification('Application list refreshed', 'success');
    }, 1500);
}

/**
 * Module management functions
 */
function showEEDetails(index) {
    console.log(`ℹ️ Showing EE details for index: ${index}`);
    showModal('Execution Environment Details', `Details for EE ${index} would be shown here.`);
}

function showDUDetails(index) {
    console.log(`ℹ️ Showing DU details for index: ${index}`);
    showModal('Deployment Unit Details', `Details for DU ${index} would be shown here.`);
}

function showEUDetails(index) {
    console.log(`ℹ️ Showing EU details for index: ${index}`);
    showModal('Execution Unit Details', `Details for EU ${index} would be shown here.`);
}

function confirmUninstall(name) {
    return confirm(`Are you sure you want to uninstall "${name}"?\n\nThis action cannot be undone.`);
}

function exportModuleData() {
    console.log('📊 Exporting module data...');
    showLoading('Preparing export...');
    
    // Simulate data preparation
    setTimeout(() => {
        hideLoading();
        
        // Create mock data
        const data = {
            timestamp: new Date().toISOString(),
            modules: {
                executionEnvironments: [],
                deploymentUnits: [],
                executionUnits: []
            }
        };
        
        downloadJSON(data, 'usp-modules-export.json');
        showNotification('Module data exported successfully', 'success');
    }, 2000);
}

function toggleModuleView() {
    USPController.state.currentView = USPController.state.currentView === 'table' ? 'grid' : 'table';
    console.log(`🔄 Switched to ${USPController.state.currentView} view`);
    
    // Update button text
    const button = event.target.closest('button');
    button.innerHTML = USPController.state.currentView === 'table' ? 
        '<i class="fas fa-th"></i> Grid View' : 
        '<i class="fas fa-th-list"></i> Table View';
}

/**
 * Data model functions
 */
function expandAllNodes() {
    console.log('📂 Expanding all data model nodes...');
    const nodes = document.querySelectorAll('.tree-node.object');
    nodes.forEach(node => {
        USPController.state.expandedNodes.add(node.dataset.path);
        node.classList.add('expanded');
    });
    showNotification('All nodes expanded', 'info');
}

function collapseAllNodes() {
    console.log('📁 Collapsing all data model nodes...');
    const nodes = document.querySelectorAll('.tree-node.object');
    nodes.forEach(node => {
        USPController.state.expandedNodes.delete(node.dataset.path);
        node.classList.remove('expanded');
    });
    showNotification('All nodes collapsed', 'info');
}

function searchDataModel() {
    const searchTerm = prompt('Enter search term for data model:');
    if (searchTerm) {
        filterDataModel(searchTerm);
    }
}

function filterDataModel(searchTerm) {
    const tree = document.getElementById('data-model-tree');
    if (!tree) return;
    
    const nodes = tree.querySelectorAll('.tree-node');
    let visibleCount = 0;
    
    nodes.forEach(node => {
        const text = node.textContent.toLowerCase();
        const matches = !searchTerm || text.includes(searchTerm.toLowerCase());
        
        if (matches) {
            node.style.display = '';
            visibleCount++;
        } else {
            node.style.display = 'none';
        }
    });
    
    console.log(`🔍 Search "${searchTerm}" found ${visibleCount} matches`);
    
    if (searchTerm && visibleCount === 0) {
        showNotification('No matches found', 'warning');
    }
}

function highlightTreeNode(path) {
    // Remove previous highlights
    document.querySelectorAll('.tree-node.highlighted').forEach(node => {
        node.classList.remove('highlighted');
    });
    
    // Add highlight to selected node
    const node = document.querySelector(`[data-path="${path}"]`);
    if (node) {
        node.classList.add('highlighted');
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * Logging functions
 */
function refreshLogs() {
    console.log('📄 Refreshing logs...');
    showLoading('Refreshing logs...');
    
    // In a real implementation, this would fetch new logs
    setTimeout(() => {
        hideLoading();
        showNotification('Logs refreshed', 'success');
        updateLastUpdateTime();
    }, 1000);
}

function clearLogs() {
    if (confirm('Are you sure you want to clear all logs?')) {
        const logsContainer = document.getElementById('system-logs');
        if (logsContainer) {
            logsContainer.innerHTML = '<div class="log-entry">Logs cleared by user</div>';
            showNotification('Logs cleared', 'info');
        }
    }
}

function downloadLogs() {
    console.log('💾 Downloading logs...');
    const logs = document.querySelectorAll('.log-entry');
    const logText = Array.from(logs).map(log => log.textContent).join('\n');
    
    downloadText(logText, 'usp-controller-logs.txt');
    showNotification('Logs downloaded', 'success');
}

function toggleAutoScroll() {
    USPController.state.autoScroll = !USPController.state.autoScroll;
    const button = event.target.closest('button');
    
    if (USPController.state.autoScroll) {
        button.innerHTML = '<i class="fas fa-pause"></i> Pause Scroll';
        button.classList.remove('btn-primary');
        button.classList.add('btn-warning');
    } else {
        button.innerHTML = '<i class="fas fa-arrows-alt-v"></i> Auto Scroll';
        button.classList.remove('btn-warning');
        button.classList.add('btn-primary');
    }
    
    console.log(`📜 Auto scroll: ${USPController.state.autoScroll ? 'ON' : 'OFF'}`);
}

/**
 * Utility functions
 */
function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loading-overlay');
    const text = overlay.querySelector('.loading-text');
    
    if (text) text.textContent = message;
    overlay.style.display = 'flex';
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'none';
    
    // Restore body scroll
    document.body.style.overflow = '';
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas ${getNotificationIcon(type)}"></i>
        <span>${message}</span>
        <button type="button" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            fadeOut(notification, () => notification.remove());
        }
    }, 5000);
    
    console.log(`🔔 Notification (${type}): ${message}`);
}

function getNotificationIcon(type) {
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    return icons[type] || 'fa-info-circle';
}

function showModal(title, content) {
    // Create modal (simplified version)
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title}</h3>
                <button onclick="this.closest('.modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

function updateLastUpdateTime() {
    USPController.state.lastUpdate = new Date();
    const element = document.getElementById('last-update');
    if (element) {
        element.textContent = USPController.state.lastUpdate.toLocaleTimeString();
    }
}

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filename);
}

function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Animation utilities
 */
function fadeOut(element, callback) {
    element.style.opacity = '1';
    element.style.transition = `opacity ${USPController.config.animationDuration}ms ease-out`;
    element.style.opacity = '0';
    
    setTimeout(() => {
        if (callback) callback();
    }, USPController.config.animationDuration);
}

function slideDown(element) {
    element.style.height = '0';
    element.style.overflow = 'hidden';
    element.style.transition = `height ${USPController.config.animationDuration}ms ease-out`;
    
    setTimeout(() => {
        element.style.height = element.scrollHeight + 'px';
        setTimeout(() => {
            element.style.height = '';
            element.style.overflow = '';
        }, USPController.config.animationDuration);
    }, 10);
}

function slideUp(element, callback) {
    element.style.height = element.scrollHeight + 'px';
    element.style.overflow = 'hidden';
    element.style.transition = `height ${USPController.config.animationDuration}ms ease-out`;
    
    setTimeout(() => {
        element.style.height = '0';
        setTimeout(() => {
            if (callback) callback();
        }, USPController.config.animationDuration);
    }, 10);
}

/**
 * Periodic updates and auto-refresh
 */
function startPeriodicUpdates() {
    setInterval(() => {
        if (USPController.state.autoRefresh) {
            updateLastUpdateTime();
            // In a real implementation, refresh data here
        }
    }, USPController.config.refreshInterval);
}

/**
 * User preferences management
 */
function saveUserPreferences() {
    const preferences = {
        autoRefresh: USPController.state.autoRefresh,
        autoScroll: USPController.state.autoScroll,
        advancedMode: USPController.state.advancedMode,
        currentView: USPController.state.currentView,
        expandedNodes: Array.from(USPController.state.expandedNodes)
    };
    
    localStorage.setItem('usp_controller_preferences', JSON.stringify(preferences));
}

function restoreUserPreferences() {
    try {
        const saved = localStorage.getItem('usp_controller_preferences');
        if (saved) {
            const preferences = JSON.parse(saved);
            Object.assign(USPController.state, preferences);
            USPController.state.expandedNodes = new Set(preferences.expandedNodes || []);
        }
    } catch (error) {
        console.warn('Failed to restore user preferences:', error);
    }
}

/**
 * Keyboard shortcuts
 */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // Ctrl/Cmd + R: Refresh
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            window.location.reload();
        }
        
        // Ctrl/Cmd + F: Search data model
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            const searchInput = document.getElementById('model-search');
            if (searchInput) {
                searchInput.focus();
            }
        }
        
        // Escape: Close modals
        if (e.key === 'Escape') {
            const modals = document.querySelectorAll('.modal-overlay');
            modals.forEach(modal => modal.remove());
        }
    });
}

/**
 * Initialize tooltips (simplified)
 */
function initializeTooltips() {
    const tooltipElements = document.querySelectorAll('[title]');
    tooltipElements.forEach(element => {
        element.addEventListener('mouseenter', showTooltip);
        element.addEventListener('mouseleave', hideTooltip);
    });
}

function showTooltip(e) {
    // Simplified tooltip implementation
    console.log(`💡 Tooltip: ${e.target.title}`);
}

function hideTooltip(e) {
    // Hide tooltip implementation
}

/**
 * Initialize search functionality
 */
function initializeSearch() {
    // Setup search functionality for different components
    console.log('🔍 Search functionality initialized');
}

/**
 * Copy result to clipboard
 */
function copyResult() {
    const resultContent = document.querySelector('.result-content');
    if (resultContent) {
        navigator.clipboard.writeText(resultContent.textContent).then(() => {
            showNotification('Result copied to clipboard', 'success');
        }).catch(() => {
            showNotification('Failed to copy result', 'error');
        });
    }
}

/**
 * Legacy compatibility functions
 */
function toggleParameterHistory() {
    console.log('📋 Parameter history feature not yet implemented');
    showNotification('Parameter history feature coming soon', 'info');
}

function refreshParameterList() {
    console.log('🔄 Refreshing parameter list...');
    showNotification('Parameter list refreshed', 'success');
}

function updateParameterSuggestions(path) {
    // Provide suggestions based on selected parameter
    if (path) {
        console.log(`💡 Suggestions for: ${path}`);
    }
}

function showParameterSuggestions(path) {
    // Show contextual suggestions
    console.log(`💡 Showing suggestions for: ${path}`);
}

// Save preferences before page unload
window.addEventListener('beforeunload', saveUserPreferences);

// Export global functions for backward compatibility
window.selectParameter = selectParameter;
window.toggleAdvancedMode = toggleAdvancedMode;
window.updateAppDescription = updateAppDescription;
window.updateLocationInfo = updateLocationInfo;
window.validateInstallation = validateInstallation;
window.refreshApplicationList = refreshApplicationList;
window.showEEDetails = showEEDetails;
window.showDUDetails = showDUDetails;
window.showEUDetails = showEUDetails;
window.confirmUninstall = confirmUninstall;
window.exportModuleData = exportModuleData;
window.toggleModuleView = toggleModuleView;
window.expandAllNodes = expandAllNodes;
window.collapseAllNodes = collapseAllNodes;
window.searchDataModel = searchDataModel;
window.refreshLogs = refreshLogs;
window.clearLogs = clearLogs;
window.downloadLogs = downloadLogs;
window.toggleAutoScroll = toggleAutoScroll;
window.copyResult = copyResult;
window.toggleParameterHistory = toggleParameterHistory;
window.refreshParameterList = refreshParameterList;

console.log('🎯 Enhanced USP Controller JavaScript loaded successfully');
